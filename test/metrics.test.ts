/**
 * Metrics recording (ADR 0008) — verify a routing decision produces the
 * expected instruments, using an in-memory exporter.
 */

import { metrics } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { afterAll, describe, expect, it } from "vitest";
import { recordDecision, recordUpstream, resetMetricsForTest } from "../src/metrics.js";

describe("router metrics", () => {
  afterAll(() => metrics.disable());

  it("records decision + upstream instruments", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 1e9 });
    const provider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(provider);
    resetMetricsForTest();

    recordDecision({
      strategy: "cost",
      model: "gpt-4.1-nano",
      provider: "openai",
      bypassed: false,
      degraded: true,
      durationMs: 5,
      estimatedCost: 0.01,
    });
    recordUpstream({ provider: "openai", status: 200, durationMs: 42 });

    await provider.forceFlush();
    const names = exporter
      .getMetrics()
      .flatMap((rm) => rm.scopeMetrics)
      .flatMap((sm) => sm.metrics)
      .map((m) => m.descriptor.name);

    expect(names).toContain("router.requests");
    expect(names).toContain("router.classifier.degraded");
    expect(names).toContain("router.estimated_cost");
    expect(names).toContain("router.upstream.requests");
    expect(names).toContain("router.upstream.duration");
  });
});
