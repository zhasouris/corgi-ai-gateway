/**
 * Router metrics (ADR 0008). Instruments are created lazily on first use so they
 * bind to the MeterProvider registered by setupTelemetry(). Without a provider,
 * the OTel API returns no-op instruments — so recording is always safe (e.g. in
 * tests), it just goes nowhere.
 */

import { metrics, type Counter, type Histogram } from "@opentelemetry/api";

interface Instruments {
  requests: Counter;
  decisionDuration: Histogram;
  classifierDegraded: Counter;
  upstream: Counter;
  upstreamDuration: Histogram;
  estimatedCost: Histogram;
}

let instruments: Instruments | undefined;

function get(): Instruments {
  if (!instruments) {
    const meter = metrics.getMeter("llm-model-router");
    instruments = {
      requests: meter.createCounter("router.requests", {
        description: "Routed requests by strategy/model/provider",
      }),
      decisionDuration: meter.createHistogram("router.decision.duration", {
        unit: "ms",
        description: "Time to make a routing decision",
      }),
      classifierDegraded: meter.createCounter("router.classifier.degraded", {
        description: "Requests where the signal provider degraded to defaults",
      }),
      upstream: meter.createCounter("router.upstream.requests", {
        description: "Upstream calls by provider/status",
      }),
      upstreamDuration: meter.createHistogram("router.upstream.duration", {
        unit: "ms",
        description: "Upstream call latency",
      }),
      estimatedCost: meter.createHistogram("router.estimated_cost", {
        unit: "usd",
        description: "Estimated request cost from catalog pricing",
      }),
    };
  }
  return instruments;
}

export function recordDecision(args: {
  strategy: string;
  model: string;
  provider: string;
  bypassed: boolean;
  degraded: boolean;
  durationMs: number;
  estimatedCost?: number;
}): void {
  const attrs = {
    strategy: args.strategy,
    model: args.model,
    provider: args.provider,
    bypassed: args.bypassed,
  };
  const i = get();
  i.requests.add(1, attrs);
  i.decisionDuration.record(args.durationMs, { strategy: args.strategy });
  if (args.degraded) i.classifierDegraded.add(1, { provider: args.provider });
  if (args.estimatedCost != null) {
    i.estimatedCost.record(args.estimatedCost, { model: args.model });
  }
}

export function recordUpstream(args: {
  provider: string;
  status: number;
  durationMs: number;
}): void {
  const i = get();
  i.upstream.add(1, { provider: args.provider, status: args.status });
  i.upstreamDuration.record(args.durationMs, { provider: args.provider });
}

/** Test helper — drop memoized instruments so a fresh MeterProvider binds. */
export function resetMetricsForTest(): void {
  instruments = undefined;
}
