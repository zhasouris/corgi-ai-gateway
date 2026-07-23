/**
 * Real OpenAI-backed ModelCaller + Judge for the live (spending) eval lenses —
 * shared by judge-run (difficulty ground truth) and baseline-run (--judge).
 * Requires OPENAI_API_KEY. Judge/model choices come from the environment.
 */

import OpenAI from "openai";
import { getConfig, type AppConfig } from "../../src/config.js";
import { Forwarder } from "../../src/providers/forwarder.js";
import type { Judge, ModelCaller } from "./judge.js";

export const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gpt-4.1-mini";

function client(): OpenAI {
  const config = getConfig();
  const provider = config.server.providers["openai"]!;
  return new OpenAI({
    baseURL: provider.base_url,
    apiKey: config.providerApiKey("openai") ?? "missing",
    maxRetries: 1,
  });
}

/**
 * A ModelCaller that forwards through the gateway's own adapter layer, so it can
 * call ANY provider the deployment has a key for (not just OpenAI) and always
 * gets an OpenAI-shaped response back (adapter.parseResponse). Returns "" on a
 * non-200 (e.g. missing key) so the judge step can skip it.
 */
export function forwarderCaller(config: AppConfig = getConfig()): ModelCaller {
  const forwarder = new Forwarder(config);
  const byId = new Map(config.catalog.map((m) => [m.id, m]));
  return {
    async complete(model, prompt) {
      const m = byId.get(model);
      if (!m) return "";
      const resp = await forwarder.forward({
        provider: m.provider,
        model,
        body: { model, messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0 },
        incomingHeaders: {},
        stream: false,
      });
      if (resp.status >= 400 || !resp.body) return "";
      try {
        const d = JSON.parse(resp.body) as { choices?: { message?: { content?: string } }[] };
        return d.choices?.[0]?.message?.content ?? "";
      } catch {
        return "";
      }
    },
  };
}

export function openaiCaller(oa: OpenAI = client()): ModelCaller {
  return {
    async complete(model, prompt) {
      const r = await oa.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0,
      });
      return r.choices[0]?.message?.content ?? "";
    },
  };
}

export function openaiJudge(oa: OpenAI = client()): Judge {
  return {
    async strongBetter(prompt, weak, strong) {
      const r = await oa.chat.completions.create({
        model: JUDGE_MODEL,
        messages: [
          {
            role: "system",
            content:
              "Compare two AI answers to the same prompt. Decide if Answer B is " +
              "MEANINGFULLY better than Answer A — in correctness/completeness/" +
              "usefulness, not just style. Respond with a single JSON object: " +
              '{"strongBetter": boolean, "margin": number between 0 and 1}.',
          },
          { role: "user", content: `PROMPT:\n${prompt}\n\nAnswer A:\n${weak}\n\nAnswer B:\n${strong}` },
        ],
        response_format: { type: "json_object" },
        max_tokens: 150,
        temperature: 0,
      });
      const data = JSON.parse(r.choices[0]?.message?.content ?? "{}") as {
        strongBetter?: boolean;
        margin?: number;
      };
      return { strongBetter: Boolean(data.strongBetter), margin: Number(data.margin ?? 0) };
    },
  };
}
