/**
 * Routing orchestrator — the pipeline from ADR 0003.
 *
 *   detect -> (bypass?) -> analyze -> filter -> score -> decision
 */

import { trace } from "@opentelemetry/api";
import type { AppConfig } from "../config.js";
import type {
  ModelDescriptor,
  RequestAnalysis,
  RoutingDecision,
  RoutingRequest,
} from "../types.js";
import { analyze as defaultAnalyze } from "./analysis.js";
import { ALL_CONSTRAINTS } from "./constraints.js";
import { detectRequirements } from "./detect.js";
import { ALL_RULES } from "./extractors/rules.js";
import { filterCandidates, scoreModels, topReason } from "./scoring.js";

const tracer = trace.getTracer("router.core");

export class NoEligibleModelError extends Error {}

type AnalyzeFn = (req: RoutingRequest, config: AppConfig) => Promise<RequestAnalysis>;

export class Router {
  private readonly catalog: ModelDescriptor[];
  private readonly byId: Map<string, ModelDescriptor>;

  constructor(
    private readonly config: AppConfig,
    private readonly analyzeFn: AnalyzeFn = defaultAnalyze,
  ) {
    this.catalog = config.catalog;
    this.byId = new Map(this.catalog.map((m) => [m.id, m]));
  }

  private providerFor(modelId: string): string {
    const model = this.byId.get(modelId);
    if (model) return model.provider;
    // Unknown model (bypass to something outside the catalog): guess by prefix.
    return modelId.startsWith("claude") ? "anthropic" : "openai";
  }

  async route(req: RoutingRequest): Promise<RoutingDecision> {
    Object.assign(req, detectRequirements(req.body));

    if (req.options.bypass) {
      const modelId = req.body.model ?? "";
      return {
        modelId,
        provider: this.providerFor(modelId),
        reason: "bypass",
        strategy: req.options.strategy,
        bypassed: true,
        ranked: [],
        warnings: req.options.warnings,
      };
    }

    const analysis = await this.analyzeFn(req, this.config);

    return tracer.startActiveSpan("router.score", (span) => {
      let candidates = filterCandidates(this.catalog, ALL_CONSTRAINTS, req, analysis);
      if (req.options.maxCost != null) {
        const ceiling = req.options.maxCost;
        candidates = candidates.filter(
          (m) => m.costPer1kInput + m.costPer1kOutput <= ceiling,
        );
      }

      if (candidates.length === 0) {
        span.end();
        throw new NoEligibleModelError(
          "no model satisfies the request's capability/context constraints",
        );
      }

      const weights = this.config.strategies[req.options.strategy] ?? {};
      const ranked = scoreModels(candidates, ALL_RULES, analysis.features, weights);
      const top = ranked[0]!;

      const warnings = [...req.options.warnings];
      if (analysis.classifier.degraded) {
        warnings.push("classifier degraded; used deterministic defaults");
      }

      span.setAttribute("router.model", top.model.id);
      span.setAttribute("router.provider", top.model.provider);
      span.setAttribute("router.strategy", req.options.strategy);
      span.setAttribute("router.candidates", candidates.length);
      span.end();

      return {
        modelId: top.model.id,
        provider: top.model.provider,
        reason: topReason(top, req.options.strategy),
        strategy: req.options.strategy,
        bypassed: false,
        ranked,
        warnings,
      };
    });
  }
}
