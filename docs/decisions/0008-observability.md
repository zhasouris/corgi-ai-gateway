# ADR 0008 — Observability: Metrics, Logs, and Azure Monitor

- **Status:** Accepted
- **Date:** 2026-07-20
- **Context repo:** `llm-model-router`

## Context

ADR 0004 established OpenTelemetry **tracing** with console + OTLP exporters. We now want
full observability — **metrics** and **logs** too — and a first-class **Azure Application
Insights** backend, without coupling the code to any vendor.

## Decision

**Instrument once with vendor-neutral OpenTelemetry; the backend is an exporter choice.**

- **Three signals**, all configured in `server.yaml.telemetry`:
  - *Traces* (already present) — `router.analyze` / `router.score` / `router.forward`.
  - *Metrics* — `router.requests`, `router.decision.duration`, `router.classifier.degraded`,
    `router.estimated_cost`, `router.upstream.requests`, `router.upstream.duration`
    (see `src/metrics.ts`; instruments created lazily so they bind to the registered
    MeterProvider, and are safe no-ops when none is set — e.g. in tests).
  - *Logs* — a structured logger (`src/logger.ts`) bridged to OTel Logs, so records carry
    trace context and correlate with spans. Replaces ad-hoc `console.warn`.
- **Backends are additive and config-gated:** console (dev), OTLP (generic collector), and
  **Azure Monitor** (Application Insights) via `@azure/monitor-opentelemetry-exporter`.
  Each enabled signal exports to each enabled backend.
- **Azure connection string is a secret** — `APPLICATIONINSIGHTS_CONNECTION_STRING` in
  `.env`, never in YAML (consistent with ADR 0004 / 0007 key handling).
- **Best-effort:** exporters are lazily imported and setup is wrapped so a telemetry
  failure never stops the proxy.

## Consequences

**Positive**
- End-to-end correlated transactions (request → decision → upstream) with metrics and logs,
  viewable in App Insights, an OTLP backend, or the console — switchable by config alone.
- Per-model cost and volume metrics complement the per-model keys (ADR 0007).
- No vendor lock-in in code; adding another backend is another exporter.

**Negative / accepted tradeoffs**
- More OTel dependencies (metrics/logs SDKs + the Azure exporter); the OTel logs SDK is
  still experimental (0.x).
- Telemetry attributes must be curated to avoid leaking secrets/PII — enforced by
  convention (whitelist safe fields), not by the type system.

## Related
- [ADR 0004 — Stack & Project Layout](0004-stack-and-project-layout.md)
- [ADR 0007 — Per-Model API Keys](0007-per-model-api-keys.md)
- [Observability help guide](../help/observability.md)
