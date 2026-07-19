/**
 * OpenTelemetry bootstrap (ADR 0004).
 *
 * Console exporter for local dev plus an optional OTLP exporter, both selectable
 * via server.yaml. Best-effort: a telemetry setup failure never stops the proxy.
 */

import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { AppConfig } from "./config.js";

let configured = false;

export function setupTelemetry(config: AppConfig): void {
  if (configured) return;
  configured = true;

  try {
    const tel = config.server.telemetry;
    const provider = new NodeTracerProvider({
      resource: new Resource({ [ATTR_SERVICE_NAME]: tel.service_name }),
    });

    if (tel.console_export) {
      provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }

    if (tel.otlp.enabled) {
      // Imported lazily so a missing/incompatible exporter doesn't break startup.
      import("@opentelemetry/exporter-trace-otlp-http")
        .then(({ OTLPTraceExporter }) => {
          provider.addSpanProcessor(
            new BatchSpanProcessor(new OTLPTraceExporter({ url: tel.otlp.endpoint })),
          );
        })
        .catch((err) => console.warn("OTLP exporter unavailable:", (err as Error).message));
    }

    provider.register();
  } catch (err) {
    console.warn("telemetry setup failed, continuing without it:", (err as Error).message);
  }
}
