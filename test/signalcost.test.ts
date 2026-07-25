/**
 * Signal-cost attribution — what MAKING the routing decision cost (the classifier
 * call), distinct from the projected cost of running the chosen model.
 */

import { describe, expect, it, vi } from "vitest";

// Mock the OpenAI SDK so the classifier "call" returns a fixed body + usage.
vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  complexity: 0.5,
                  expected_output_tokens: 100,
                  reasoning_depth: 0.2,
                  task_type: "coding",
                  data_sensitivity: 0,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 200, completion_tokens: 50 },
        }),
      },
    };
  },
}));

import { HeuristicSignalProvider, LlmClassifierProvider } from "../src/core/signal.js";
import type { AppConfig } from "../src/config.js";
import { makeModel, makeRequest } from "./helpers.js";

describe("signal cost attribution", () => {
  it("heuristic decisions are free (no LLM call)", async () => {
    const r = await new HeuristicSignalProvider().analyze(
      makeRequest({ body: { messages: [{ role: "user", content: "hi" }] } }),
    );
    expect(r.signalCost).toEqual({ usd: 0, latencyMs: 0 });
  });

  it("prices the LLM classifier call from its token usage × the model rate", async () => {
    // Rates are USD per 1,000,000 tokens (legacy field names).
    const config = {
      catalog: [makeModel("nano", { costIn: 0.1, costOut: 0.4 })],
      secrets: { classifierApiKey: "test-key" },
      resolveApiKey: () => "test-key",
      server: {
        classifier: {
          enabled: true,
          provider: "openai",
          model: "nano",
          timeout_seconds: 8,
          max_input_chars: 8000,
        },
        providers: { openai: { base_url: "https://example.test", api_key_env: "OPENAI_API_KEY" } },
      },
    } as unknown as AppConfig;

    const r = await new LlmClassifierProvider(config).analyze(
      makeRequest({ body: { messages: [{ role: "user", content: "Write a function" }] } }),
    );

    expect(r.degraded).toBe(false);
    expect(r.taskType).toBe("coding");
    expect(r.signalCost?.inputTokens).toBe(200);
    expect(r.signalCost?.outputTokens).toBe(50);
    // 200/1e6 * 0.1 + 50/1e6 * 0.4 = 0.00004
    expect(r.signalCost?.usd).toBeCloseTo(0.00004, 10);
    expect(r.signalCost?.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
