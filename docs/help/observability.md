# Observability — Telemetry & Application Insights

The proxy emits OpenTelemetry **traces**, **metrics**, and **logs**. Instrumentation is
vendor-neutral; you pick the backend in `config/server.yaml`. This guide covers what's
emitted and how to send it to the console, an OTLP collector, or Azure Application Insights.

## What's emitted

**Traces** — one span tree per request:
- `router.analyze` (signal extraction; attrs: input tokens, provider, degraded, task type, complexity)
- `router.score` (chosen model, provider, strategy, candidate count)
- `router.forward` (upstream provider, URL, HTTP status, stream flag)

**Metrics**:

| Metric | Type | Attributes | What it answers |
|---|---|---|---|
| `router.requests` | counter | strategy, model, provider, bypassed | route distribution, per-model volume |
| `router.decision.duration` | histogram (ms) | strategy | routing overhead |
| `router.classifier.degraded` | counter | provider | signal reliability |
| `router.estimated_cost` | histogram (usd) | model | estimated spend, cost per model |
| `router.upstream.requests` | counter | provider, status | upstream error rates |
| `router.upstream.duration` | histogram (ms) | provider | upstream latency |

**Logs** — structured records (e.g. classifier degraded, sidecar fallback), stamped with
the active trace/span id so they correlate with the trace in the backend.

## Configuration (`config/server.yaml`)

```yaml
telemetry:
  service_name: llm-model-router
  console_export: true          # print traces/metrics/logs to stdout (dev)
  otlp:
    enabled: false              # send to an OTLP collector
    endpoint: http://localhost:4318/v1/traces   # base; /v1/metrics and /v1/logs are derived
  azure_monitor:
    enabled: false              # send to Application Insights
  metrics: { enabled: true }
  logs:    { enabled: true }
```

Each enabled signal exports to **every** enabled backend. Telemetry setup is best-effort —
if an exporter can't load, the proxy keeps running.

## Backends

### 1. Console (default, local dev)
`console_export: true` — spans, metric batches, and log records print to stdout. Nothing
else to configure.

### 2. OTLP collector (Jaeger, Tempo, Grafana, etc.)
```yaml
otlp: { enabled: true, endpoint: http://<collector>:4318/v1/traces }
```
Point it at any OTLP/HTTP collector. Metrics and logs go to the sibling `/v1/metrics` and
`/v1/logs` paths on the same host.

### 3. Azure Application Insights
1. In the Azure Portal, open your Application Insights resource → **Overview** → copy the
   **Connection String**.
2. Put it in `.env` (it is a secret — gitignored):
   ```
   APPLICATIONINSIGHTS_CONNECTION_STRING=InstrumentationKey=...;IngestionEndpoint=...
   ```
3. Enable it in `config/server.yaml`:
   ```yaml
   azure_monitor: { enabled: true }
   ```
4. Restart. If enabled without a connection string, the proxy logs a warning and skips it.

**What you'll see in App Insights:**
- **Transaction search / Application map** — each request as an end-to-end transaction:
  `router.analyze → router.score → router.forward`, with the upstream call as a dependency.
- **Logs (KQL)** — traces and log records, correlated by `operation_Id`. Example:
  ```kql
  traces
  | where message has "classifier degraded"
  | project timestamp, message, operation_Id, customDimensions
  ```
  Route distribution from the metric:
  ```kql
  customMetrics
  | where name == "router.requests"
  | summarize count() by tostring(customDimensions.model)
  ```
- **Metrics explorer** — chart `router.estimated_cost`, `router.upstream.duration`, etc.,
  split by their attributes (model, provider, strategy).

## Docker

`docker compose up` already passes `.env` into the container, so
`APPLICATIONINSIGHTS_CONNECTION_STRING` flows through. Just set `azure_monitor.enabled:
true` (the config volume is mounted, so no rebuild needed).

## Security

- The connection string is a **secret** — keep it in `.env` (gitignored), never in YAML.
- Logs and span attributes **never include API keys or raw request bodies** by design; keep
  it that way when adding new telemetry (attributes are a whitelist of safe fields).

## Related
- [ADR 0008 — Observability](../decisions/0008-observability.md)
- [ADR 0004 — Stack & Project Layout](../decisions/0004-stack-and-project-layout.md)
