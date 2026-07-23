/**
 * Structured logging bridged to OpenTelemetry Logs (ADR 0008).
 *
 * Emits OTel LogRecords (which pick up the active trace/span context, so logs
 * correlate with traces in the backend) and also mirrors to the console for
 * local dev. Without a LoggerProvider the OTel API is a no-op, so it's always
 * safe to call.
 *
 * NEVER pass secrets (API keys) or raw request bodies as attributes.
 */

import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type Attrs = Record<string, string | number | boolean | undefined>;

function emit(
  severityNumber: SeverityNumber,
  severityText: string,
  message: string,
  attributes?: Attrs,
): void {
  const clean: Attrs = {};
  if (attributes) {
    for (const [k, v] of Object.entries(attributes)) if (v !== undefined) clean[k] = v;
  }
  logs.getLogger("corgi-ai-gateway").emit({
    severityNumber,
    severityText,
    body: message,
    attributes: clean,
  });
}

export function logInfo(message: string, attributes?: Attrs): void {
  emit(SeverityNumber.INFO, "INFO", message, attributes);
  console.info(message, attributes ?? "");
}

export function logWarn(message: string, attributes?: Attrs): void {
  emit(SeverityNumber.WARN, "WARN", message, attributes);
  console.warn(message, attributes ?? "");
}

export function logError(message: string, attributes?: Attrs): void {
  emit(SeverityNumber.ERROR, "ERROR", message, attributes);
  console.error(message, attributes ?? "");
}
