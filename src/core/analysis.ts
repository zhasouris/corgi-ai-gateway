/**
 * Stage 1 — request analysis (ADR 0003).
 *
 * Counts input tokens deterministically and obtains the subjective signal from
 * a pluggable SignalProvider (ADR 0006), then runs the extractors to build the
 * shared RequestAnalysis every feature rule reads.
 */

import { trace } from "@opentelemetry/api";
import type { RequestAnalysis, RoutingRequest } from "../types.js";
import { countInputTokens } from "./detect.js";
import { ALL_RULES } from "./extractors/rules.js";
import type { SignalProvider } from "./signal.js";

const tracer = trace.getTracer("router.analysis");

export type AnalyzeFn = (req: RoutingRequest) => Promise<RequestAnalysis>;

/** Build an analyze function bound to a signal provider. */
export function makeAnalyze(provider: SignalProvider): AnalyzeFn {
  return (req) =>
    tracer.startActiveSpan("router.analyze", async (span) => {
      const inputTokens = countInputTokens(req.body);
      const classifier = await provider.analyze(req);

      const analysis: RequestAnalysis = { inputTokens, classifier, features: {} };
      for (const rule of ALL_RULES) {
        analysis.features[rule.name] = rule.extract(req, analysis);
      }

      span.setAttribute("router.input_tokens", inputTokens);
      span.setAttribute("router.signal.provider", provider.name);
      span.setAttribute("router.classifier.degraded", classifier.degraded);
      span.setAttribute("router.classifier.task_type", classifier.taskType);
      span.setAttribute("router.classifier.complexity", classifier.complexity);
      span.end();
      return analysis;
    });
}
