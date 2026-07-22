/**
 * OpenTelemetry bootstrap — traces, metrics, and logs (ADR 0004, ADR 0008).
 *
 * Instrumentation is vendor-neutral; the backend is an exporter choice selected
 * in server.yaml: console (dev), OTLP (generic collector), and/or Azure Monitor
 * (Application Insights). Best-effort — a telemetry failure never stops the proxy.
 *
 * Targets the OTel JS 2.x API: resources are built with `resourceFromAttributes`
 * and processors are passed to the provider constructors (the old
 * `addSpanProcessor` / `addLogRecordProcessor` mutators were removed).
 */

import { metrics } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { resourceFromAttributes, type Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { AppConfig } from "./config.js";

let configured = false;

/** Derive a sibling OTLP signal endpoint from the configured traces endpoint. */
export function otlpEndpoint(tracesEndpoint: string, signal: "metrics" | "logs"): string {
  return tracesEndpoint.replace(/\/v1\/traces\/?$/, `/v1/${signal}`);
}

function azureConnectionString(): string | undefined {
  return process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
}

// Traces, metrics, and logs are set up concurrently and all three need the same
// Azure exporter package. Memoise the import so it is loaded once rather than
// three times in parallel.
let azureExportersPromise:
  | Promise<typeof import("@azure/monitor-opentelemetry-exporter")>
  | undefined;

function azureExporters() {
  azureExportersPromise ??= import("@azure/monitor-opentelemetry-exporter");
  return azureExportersPromise;
}

// Pass the signal name as a separate argument rather than interpolating it into
// the format string (keeps static analysers happy and logs structured).
const warn = (what: string) => (err: unknown) =>
  console.warn("telemetry setup failed, continuing:", what, (err as Error).message);

export function setupTelemetry(config: AppConfig): void {
  if (configured) return;
  configured = true;

  const tel = config.server.telemetry;
  const resource = resourceFromAttributes({ [ATTR_SERVICE_NAME]: tel.service_name });
  const azureConn = azureConnectionString();
  const azureOn = tel.azure_monitor.enabled && Boolean(azureConn);
  if (tel.azure_monitor.enabled && !azureConn) {
    console.warn("azure_monitor enabled but APPLICATIONINSIGHTS_CONNECTION_STRING is unset");
  }

  setupTraces(resource, tel, azureOn, azureConn).catch(warn("traces"));
  if (tel.metrics.enabled) setupMetrics(resource, tel, azureOn, azureConn).catch(warn("metrics"));
  if (tel.logs.enabled) setupLogs(resource, tel, azureOn, azureConn).catch(warn("logs"));
}

async function setupTraces(
  resource: Resource,
  tel: AppConfig["server"]["telemetry"],
  azureOn: boolean,
  azureConn?: string,
): Promise<void> {
  const spanProcessors: SpanProcessor[] = [];
  if (tel.console_export) {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }
  if (tel.otlp.enabled) {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    spanProcessors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: tel.otlp.endpoint })));
  }
  if (azureOn) {
    const { AzureMonitorTraceExporter } = await azureExporters();
    // Cast bridges a bundled-OTel version skew between the Azure exporter and our SDK.
    const exporter = new AzureMonitorTraceExporter({
      connectionString: azureConn,
    }) as unknown as SpanExporter;
    spanProcessors.push(new BatchSpanProcessor(exporter));
  }
  new NodeTracerProvider({ resource, spanProcessors }).register();
}

async function setupMetrics(
  resource: Resource,
  tel: AppConfig["server"]["telemetry"],
  azureOn: boolean,
  azureConn?: string,
): Promise<void> {
  const readers: PeriodicExportingMetricReader[] = [];
  if (tel.console_export) {
    readers.push(new PeriodicExportingMetricReader({ exporter: new ConsoleMetricExporter() }));
  }
  if (tel.otlp.enabled) {
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: otlpEndpoint(tel.otlp.endpoint, "metrics") }),
      }),
    );
  }
  if (azureOn) {
    const { AzureMonitorMetricExporter } = await azureExporters();
    const exporter = new AzureMonitorMetricExporter({
      connectionString: azureConn,
    }) as unknown as PushMetricExporter;
    readers.push(new PeriodicExportingMetricReader({ exporter }));
  }
  metrics.setGlobalMeterProvider(new MeterProvider({ resource, readers }));
}

async function setupLogs(
  resource: Resource,
  tel: AppConfig["server"]["telemetry"],
  azureOn: boolean,
  azureConn?: string,
): Promise<void> {
  const processors: LogRecordProcessor[] = [];
  if (tel.console_export) {
    processors.push(new SimpleLogRecordProcessor({ exporter: new ConsoleLogRecordExporter() }));
  }
  if (tel.otlp.enabled) {
    const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http");
    processors.push(
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: otlpEndpoint(tel.otlp.endpoint, "logs") }),
      }),
    );
  }
  if (azureOn) {
    const { AzureMonitorLogExporter } = await azureExporters();
    const exporter = new AzureMonitorLogExporter({
      connectionString: azureConn,
    }) as unknown as LogRecordExporter;
    processors.push(new BatchLogRecordProcessor({ exporter }));
  }
  logs.setGlobalLoggerProvider(new LoggerProvider({ resource, processors }));
}
