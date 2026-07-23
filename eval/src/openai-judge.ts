/**
 * Real OpenAI-backed ModelCaller + Judge for the live (spending) eval lenses —
 * shared by judge-run (difficulty ground truth) and baseline-run (--judge).
 * Requires OPENAI_API_KEY. Judge/model choices come from the environment.
 */

import OpenAI from "openai";
import { getConfig } from "../../src/config.js";
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
