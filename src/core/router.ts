/**
 * Routing orchestrator — the pipeline from ADR 0003.
 *
 *   detect -> (bypass?) -> analyze -> filter -> score -> decision
 *
 * `decide()` returns the decision plus the analysis trace (used by the eval
 * harness for costing); `route()` is the thin wrapper the API uses.
 */

import { trace } from "@opentelemetry/api";
import type { AppConfig } from "../config.js";
import { recordDecision } from "../metrics.js";
import type {
  ClassifierResult,
  FeatureScore,
  ModelDescriptor,
  RequestAnalysis,
  RoutingDecision,
  RoutingRequest,
  ScoredModel,
  Strategy,
} from "../types.js";
import { makeAnalyze, type AnalyzeFn } from "./analysis.js";
import { ALL_CONSTRAINTS } from "./constraints.js";
import { detectRequirements } from "./detect.js";
import { ALL_RULES } from "./extractors/rules.js";
import { filterCandidates, scoreModels, topReason } from "./scoring.js";
import { LlmClassifierProvider } from "./signal.js";

const tracer = trace.getTracer("router.core");

export class NoEligibleModelError extends Error {}

/** Decision plus the analysis that produced it (analysis absent when bypassed). */
export interface RouteTrace {
  decision: RoutingDecision;
  analysis?: RequestAnalysis;
}

export class Router {
  private readonly catalog: ModelDescriptor[];
  private readonly byId: Map<string, ModelDescriptor>;
  private readonly analyzeFn: AnalyzeFn;

  constructor(
    private readonly config: AppConfig,
    analyzeFn?: AnalyzeFn,
    // Per-strategy signal-provider overrides (ADR 0012). A strategy absent here
    // uses the default `analyzeFn`. This is how `latency` gets a fast signal
    // (heuristic or RouteLLM, ~0–250ms) instead of the ~1s LLM classifier whose
    // output it barely weights. Empty by default, so existing callers and every
    // test that passes a single analyze fn are unaffected.
    private readonly analyzeByStrategy: Partial<Record<Strategy, AnalyzeFn>> = {},
  ) {
    this.catalog = config.catalog;
    this.byId = new Map(this.catalog.map((m) => [m.id, m]));
    this.analyzeFn = analyzeFn ?? makeAnalyze(new LlmClassifierProvider(config));
  }

  private pickAnalyze(strategy: Strategy): AnalyzeFn {
    return this.analyzeByStrategy[strategy] ?? this.analyzeFn;
  }

  private providerFor(modelId: string): string {
    const model = this.byId.get(modelId);
    if (model) return model.provider;
    return modelId.startsWith("claude") ? "anthropic" : "openai";
  }

  /** Can this deployment actually authenticate to the model (ADR 0007)? */
  private isRoutable(model: ModelDescriptor): boolean {
    return Boolean(this.config.resolveApiKey(model.provider, model.id));
  }

  /**
   * Pick the best model we can actually reach.
   *
   * Credentials are deliberately not a hard constraint: the catalog stays
   * complete so an inspector-only deployment (no provider keys at all) can
   * still rank and explain every model. So instead of filtering, walk the
   * ranked list and take the first routable entry, reporting anything skipped
   * on the way as a fallback — that keeps the answer useful *and* honest about
   * what the raw scoring preferred.
   */
  private pickRoutable(ranked: ScoredModel[], strategy: Strategy): {
    top: ScoredModel;
    reason: string;
    warnings: string[];
  } {
    const idx = ranked.findIndex((s) => this.isRoutable(s.model));
    const warnings: string[] = [];

    // Nothing is reachable — an inspector-only deployment. Rank normally and
    // say so rather than pretending the top pick could be called.
    if (idx < 0) {
      const top = ranked[0]!;
      warnings.push("no API key is configured for any eligible model; nothing could be forwarded");
      return {
        top,
        // Reasons are emitted as an HTTP header (X-Router-Reason), so keep them
        // plain ASCII rather than relying on the header-safety fold.
        reason: `${topReason(top, strategy)} - unroutable: no API key for ${top.model.provider}`,
        warnings,
      };
    }

    const top = ranked[idx]!;
    if (idx === 0) return { top, reason: topReason(top, strategy), warnings };

    const skipped = ranked.slice(0, idx);
    const best = skipped[0]!;
    const providers = [...new Set(skipped.map((s) => s.model.provider))].join(", ");
    warnings.push(
      `skipped ${skipped.length} higher-scoring model(s) with no API key: ${skipped
        .map((s) => `${s.model.id} (${s.model.provider})`)
        .join(", ")}`,
    );
    return {
      top,
      reason:
        `${topReason(top, strategy)} - best routable; ` +
        `${best.model.id} scored higher (${best.score.toFixed(2)}) but no API key for ${providers}`,
      warnings,
    };
  }

  async decide(req: RoutingRequest): Promise<RouteTrace> {
    const started = Date.now();
    Object.assign(req, detectRequirements(req.body));

    if (req.options.bypass) {
      const modelId = req.body.model ?? "";
      const provider = this.providerFor(modelId);
      recordDecision({
        strategy: req.options.strategy,
        model: modelId,
        provider,
        bypassed: true,
        degraded: false,
        durationMs: Date.now() - started,
      });
      return {
        decision: {
          modelId,
          provider,
          reason: "bypass",
          strategy: req.options.strategy,
          bypassed: true,
          ranked: [],
          warnings: req.options.warnings,
          routingMs: Date.now() - started,
        },
      };
    }

    const analysis = await this.pickAnalyze(req.options.strategy)(req);

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
      const picked = this.pickRoutable(ranked, req.options.strategy);
      const top = picked.top;

      const warnings = [...req.options.warnings, ...picked.warnings];
      if (analysis.classifier.degraded) {
        warnings.push("classifier degraded; used deterministic defaults");
      }

      span.setAttribute("router.model", top.model.id);
      span.setAttribute("router.provider", top.model.provider);
      span.setAttribute("router.strategy", req.options.strategy);
      span.setAttribute("router.candidates", candidates.length);
      span.end();

      const estimatedCost =
        (analysis.inputTokens / 1000) * top.model.costPer1kInput +
        (analysis.classifier.expectedOutputTokens / 1000) * top.model.costPer1kOutput;
      const routingMs = Date.now() - started;
      recordDecision({
        strategy: req.options.strategy,
        model: top.model.id,
        provider: top.model.provider,
        bypassed: false,
        degraded: analysis.classifier.degraded,
        durationMs: routingMs,
        estimatedCost,
      });

      return {
        decision: {
          modelId: top.model.id,
          provider: top.model.provider,
          reason: picked.reason,
          strategy: req.options.strategy,
          bypassed: false,
          ranked,
          warnings,
          routingMs,
        },
        analysis,
      };
    });
  }

  async route(req: RoutingRequest): Promise<RoutingDecision> {
    return (await this.decide(req)).decision;
  }

  /**
   * Run the full pipeline for inspection WITHOUT forwarding — returns every
   * intermediate the router determined (detected requirements, signals, which
   * models were eligible/excluded and why, the ranked scores, and the pick).
   * Powers the /demo decision-inspector page.
   */
  async explain(req: RoutingRequest): Promise<ExplainResult> {
    const started = Date.now();
    Object.assign(req, detectRequirements(req.body));
    const detected = {
      requiresVision: req.requiresVision,
      requiresTools: req.requiresTools,
      requiresStructuredOutput: req.requiresStructuredOutput,
      requiresAudio: req.requiresAudio,
    };

    // Forced model: bypass routing entirely and report the chosen model.
    if (req.options.bypass) {
      const modelId = req.body.model ?? "";
      return {
        strategy: req.options.strategy,
        bypassed: true,
        detected,
        inputTokens: 0,
        classifier: null,
        features: {},
        eligible: [],
        excluded: [],
        ranked: [],
        decision: modelId
          ? {
              model: modelId,
              provider: this.providerFor(modelId),
              reason: "forced (bypass — routing skipped)",
            }
          : null,
        warnings: req.options.warnings,
        routingMs: Date.now() - started,
      };
    }

    const analysis = await this.pickAnalyze(req.options.strategy)(req);

    const eligibleModels = filterCandidates(this.catalog, ALL_CONSTRAINTS, req, analysis);
    const eligibleSet = new Set(eligibleModels.map((m) => m.id));
    const excluded = this.catalog
      .filter((m) => !eligibleSet.has(m.id))
      .map((m) => ({
        model: m.id,
        failedConstraints: ALL_CONSTRAINTS.filter((c) => !c.admits(m, req, analysis)).map(
          (c) => c.name,
        ),
      }));

    const weights = this.config.strategies[req.options.strategy] ?? {};
    const scored = scoreModels(eligibleModels, ALL_RULES, analysis.features, weights);
    const outTokens = analysis.classifier.expectedOutputTokens;
    const ranked = scored.map((s) => ({
      model: s.model.id,
      provider: s.model.provider,
      tier: s.model.tier,
      score: Number(s.score.toFixed(4)),
      breakdown: s.breakdown,
      estimatedCost: Number(
        (
          (analysis.inputTokens / 1000) * s.model.costPer1kInput +
          (outTokens / 1000) * s.model.costPer1kOutput
        ).toFixed(6),
      ),
    }));

    // Same choice the forwarding path would make, so the inspector reports the
    // model that would really be called — while `ranked` still lists everything,
    // including the higher-scoring entries that were skipped for want of a key.
    const picked = scored.length ? this.pickRoutable(scored, req.options.strategy) : null;

    const warnings = [...req.options.warnings, ...(picked?.warnings ?? [])];
    if (analysis.classifier.degraded) {
      warnings.push("signal degraded; used deterministic defaults");
    }

    return {
      strategy: req.options.strategy,
      bypassed: false,
      detected,
      inputTokens: analysis.inputTokens,
      classifier: analysis.classifier,
      signalProvider: analysis.signalProvider,
      features: analysis.features,
      eligible: eligibleModels.map((m) => m.id),
      excluded,
      ranked,
      decision: picked
        ? {
            model: picked.top.model.id,
            provider: picked.top.model.provider,
            reason: picked.reason,
          }
        : null,
      warnings,
      routingMs: Date.now() - started,
    };
  }
}

export interface ExplainResult {
  strategy: Strategy;
  /** True when a model was forced via bypass (routing skipped). */
  bypassed: boolean;
  detected: {
    requiresVision: boolean;
    requiresTools: boolean;
    requiresStructuredOutput: boolean;
    requiresAudio: boolean;
  };
  inputTokens: number;
  classifier: ClassifierResult | null;
  /** Which signal provider ran (heuristic / llm-classifier / routellm). */
  signalProvider?: string;
  features: Record<string, FeatureScore>;
  eligible: string[];
  excluded: { model: string; failedConstraints: string[] }[];
  ranked: {
    model: string;
    provider: string;
    tier: number;
    score: number;
    breakdown: Record<string, number>;
    estimatedCost: number;
  }[];
  decision: { model: string; provider: string; reason: string } | null;
  warnings: string[];
  /** Wall-clock ms spent deciding (no upstream call is made here). */
  routingMs: number;
}
