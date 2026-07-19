/**
 * Stage 1 — request analysis (ADR 0003).
 *
 * Runs the deterministic extractors and a single classifier call, assembling
 * the shared RequestAnalysis every feature rule reads. The classifier call is
 * guarded: on any failure the analysis degrades to deterministic defaults and
 * the request is still served (testing invariant #16).
 */

import { trace } from "@opentelemetry/api";
import OpenAI from "openai";
import type { AppConfig } from "../config.js";
import {
  defaultClassifierResult,
  type ChatMessage,
  type ClassifierResult,
  type RequestAnalysis,
  type RoutingRequest,
} from "../types.js";
import { countInputTokens } from "./detect.js";
import { ALL_RULES } from "./extractors/rules.js";

const tracer = trace.getTracer("router.analysis");

const CLASSIFIER_SYSTEM =
  "You are a routing classifier. Analyze the user's request and respond with a " +
  "single JSON object and nothing else, with keys: complexity (0..1 float), " +
  "expected_output_tokens (int), reasoning_depth (0..1 float), task_type (one of: " +
  "coding, math, reasoning, analysis, summarization, extraction, creative, " +
  "translation, conversation), data_sensitivity (0..1 float). No explanations.";

function promptText(req: RoutingRequest, maxChars: number): string {
  const parts: string[] = [];
  for (const msg of (req.body.messages ?? []) as ChatMessage[]) {
    if (typeof msg.content === "string") parts.push(msg.content);
    else if (Array.isArray(msg.content)) {
      for (const p of msg.content) if (typeof p.text === "string") parts.push(p.text);
    }
  }
  return parts.join("\n").slice(0, maxChars);
}

function parseClassifier(raw: string): ClassifierResult {
  const data = JSON.parse(raw) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  return {
    complexity: num(data.complexity, 0.5),
    expectedOutputTokens: Math.round(num(data.expected_output_tokens, 512)),
    reasoningDepth: num(data.reasoning_depth, 0.0),
    taskType: typeof data.task_type === "string" ? data.task_type : "conversation",
    dataSensitivity: num(data.data_sensitivity, 0.0),
    degraded: false,
  };
}

async function classify(req: RoutingRequest, config: AppConfig): Promise<ClassifierResult> {
  const cfg = config.server.classifier;
  if (!cfg.enabled) return defaultClassifierResult(true);

  const provider = config.server.providers[cfg.provider];
  if (!provider) return defaultClassifierResult(true);

  const apiKey = config.secrets.classifierApiKey ?? config.providerApiKey(cfg.provider);
  const client = new OpenAI({
    baseURL: provider.base_url,
    apiKey: apiKey ?? "missing",
    timeout: cfg.timeout_seconds * 1000,
    maxRetries: 0,
  });

  try {
    const resp = await client.chat.completions.create({
      model: cfg.model,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM },
        { role: "user", content: promptText(req, cfg.max_input_chars) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    return parseClassifier(resp.choices[0]?.message?.content ?? "{}");
  } catch (err) {
    console.warn("classifier failed, degrading to defaults:", (err as Error).message);
    return defaultClassifierResult(true);
  }
}

export async function analyze(req: RoutingRequest, config: AppConfig): Promise<RequestAnalysis> {
  return tracer.startActiveSpan("router.analyze", async (span) => {
    const inputTokens = countInputTokens(req.body);
    const classifier = await classify(req, config);

    const analysis: RequestAnalysis = { inputTokens, classifier, features: {} };
    for (const rule of ALL_RULES) {
      analysis.features[rule.name] = rule.extract(req, analysis);
    }

    span.setAttribute("router.input_tokens", inputTokens);
    span.setAttribute("router.classifier.degraded", classifier.degraded);
    span.setAttribute("router.classifier.task_type", classifier.taskType);
    span.setAttribute("router.classifier.complexity", classifier.complexity);
    span.end();
    return analysis;
  });
}
