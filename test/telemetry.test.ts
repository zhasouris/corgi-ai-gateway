/**
 * Telemetry bootstrap wiring (ADR 0008).
 *
 * The OTel SDK is mocked wholesale: nothing here exports a real span, so what is
 * under test is the *wiring decision* — which exporters get constructed for a
 * given config, and what they are pointed at. The load-bearing case is that the
 * Azure Monitor exporter is never constructed without a connection string, since
 * that exporter is an egress path for telemetry out of the trust boundary
 * (ADR 0008; ADR 0009 §7).
 *
 * `setupTelemetry` latches a module-level `configured` flag, so every case
 * re-imports the module through `freshSetup()` to get a clean one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";

const h = vi.hoisted(() => ({
  spanExporters: [] as string[],
  metricExporters: [] as string[],
  logExporters: [] as string[],
  otlpUrls: {} as Record<string, string>,
  azureConnStrings: [] as (string | undefined)[],
  registered: [] as string[],
  resources: [] as Record<string, unknown>[],
  processorCounts: {} as Record<string, number>,
  tracerProviderThrows: false,
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attrs: Record<string, unknown>) => {
    h.resources.push(attrs);
    return { attrs };
  },
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({ ATTR_SERVICE_NAME: "service.name" }));

vi.mock("@opentelemetry/sdk-trace-base", () => ({
  ConsoleSpanExporter: class {
    kind = "console";
  },
  SimpleSpanProcessor: class {
    constructor(exporter: { kind: string }) {
      h.spanExporters.push(exporter.kind);
    }
  },
  BatchSpanProcessor: class {
    constructor(exporter: { kind: string }) {
      h.spanExporters.push(exporter.kind);
    }
  },
}));

vi.mock("@opentelemetry/sdk-trace-node", () => ({
  NodeTracerProvider: class {
    constructor(opts: { resource: unknown; spanProcessors: unknown[] }) {
      if (h.tracerProviderThrows) throw new Error("boom");
      h.processorCounts.traces = opts.spanProcessors.length;
    }
    register() {
      h.registered.push("traces");
    }
  },
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
  ConsoleMetricExporter: class {
    kind = "console";
  },
  PeriodicExportingMetricReader: class {
    constructor(opts: { exporter: { kind: string } }) {
      h.metricExporters.push(opts.exporter.kind);
    }
  },
  MeterProvider: class {
    constructor(opts: { readers: unknown[] }) {
      h.processorCounts.metrics = opts.readers.length;
    }
  },
}));

vi.mock("@opentelemetry/sdk-logs", () => ({
  ConsoleLogRecordExporter: class {
    kind = "console";
  },
  SimpleLogRecordProcessor: class {
    constructor(opts: { exporter: { kind: string } }) {
      h.logExporters.push(opts.exporter.kind);
    }
  },
  BatchLogRecordProcessor: class {
    constructor(opts: { exporter: { kind: string } }) {
      h.logExporters.push(opts.exporter.kind);
    }
  },
  LoggerProvider: class {
    constructor(opts: { processors: unknown[] }) {
      h.processorCounts.logs = opts.processors.length;
    }
  },
}));

vi.mock("@opentelemetry/api", () => ({
  metrics: { setGlobalMeterProvider: () => h.registered.push("metrics") },
}));

vi.mock("@opentelemetry/api-logs", () => ({
  logs: { setGlobalLoggerProvider: () => h.registered.push("logs") },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class {
    kind = "otlp";
    constructor(opts: { url: string }) {
      h.otlpUrls.traces = opts.url;
    }
  },
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: class {
    kind = "otlp";
    constructor(opts: { url: string }) {
      h.otlpUrls.metrics = opts.url;
    }
  },
}));

vi.mock("@opentelemetry/exporter-logs-otlp-http", () => ({
  OTLPLogExporter: class {
    kind = "otlp";
    constructor(opts: { url: string }) {
      h.otlpUrls.logs = opts.url;
    }
  },
}));

vi.mock("@azure/monitor-opentelemetry-exporter", () => {
  class AzureExporter {
    kind = "azure";
    constructor(opts: { connectionString?: string }) {
      h.azureConnStrings.push(opts.connectionString);
    }
  }
  return {
    AzureMonitorTraceExporter: AzureExporter,
    AzureMonitorMetricExporter: AzureExporter,
    AzureMonitorLogExporter: AzureExporter,
  };
});

type TelemetryConfig = AppConfig["server"]["telemetry"];

function cfg(overrides: Partial<TelemetryConfig> = {}): AppConfig {
  const telemetry: TelemetryConfig = {
    service_name: "test-router",
    console_export: false,
    otlp: { enabled: false, endpoint: "http://collector:4318/v1/traces" },
    azure_monitor: { enabled: false },
    metrics: { enabled: false },
    logs: { enabled: false },
    ...overrides,
  };
  return { server: { telemetry } } as unknown as AppConfig;
}

/** Fresh module instance — `setupTelemetry` latches after its first call. */
async function freshSetup() {
  vi.resetModules();
  return (await import("../src/telemetry.js")).setupTelemetry;
}

/**
 * The setup* functions are fired without await (best-effort, so a telemetry
 * failure never blocks startup) and each awaits a dynamic exporter import, so
 * draining takes several turns of the loop rather than one.
 */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  h.spanExporters.length = 0;
  h.metricExporters.length = 0;
  h.logExporters.length = 0;
  h.azureConnStrings.length = 0;
  h.registered.length = 0;
  h.resources.length = 0;
  h.otlpUrls = {};
  h.processorCounts = {};
  h.tracerProviderThrows = false;
  vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("otlpEndpoint", () => {
  it("derives sibling signal endpoints from the traces endpoint", async () => {
    const { otlpEndpoint } = await import("../src/telemetry.js");
    expect(otlpEndpoint("http://c:4318/v1/traces", "metrics")).toBe("http://c:4318/v1/metrics");
    expect(otlpEndpoint("http://c:4318/v1/traces", "logs")).toBe("http://c:4318/v1/logs");
  });

  it("tolerates a trailing slash", async () => {
    const { otlpEndpoint } = await import("../src/telemetry.js");
    expect(otlpEndpoint("http://c:4318/v1/traces/", "logs")).toBe("http://c:4318/v1/logs");
  });

  it("leaves a non-standard endpoint alone rather than guessing", async () => {
    const { otlpEndpoint } = await import("../src/telemetry.js");
    expect(otlpEndpoint("http://c:4318/ingest", "metrics")).toBe("http://c:4318/ingest");
  });
});

describe("setupTelemetry — signal toggles", () => {
  it("registers traces only when metrics and logs are disabled", async () => {
    const setup = await freshSetup();
    setup(cfg({ console_export: true }));
    await settle();

    expect(h.registered).toEqual(["traces"]);
    expect(h.spanExporters).toEqual(["console"]);
    expect(h.metricExporters).toEqual([]);
    expect(h.logExporters).toEqual([]);
  });

  it("registers all three providers when every signal is enabled", async () => {
    const setup = await freshSetup();
    setup(cfg({ console_export: true, metrics: { enabled: true }, logs: { enabled: true } }));
    await settle();

    expect(h.registered.sort()).toEqual(["logs", "metrics", "traces"]);
    expect(h.spanExporters).toEqual(["console"]);
    expect(h.metricExporters).toEqual(["console"]);
    expect(h.logExporters).toEqual(["console"]);
  });

  it("wires no exporters at all when every backend is off", async () => {
    const setup = await freshSetup();
    setup(cfg({ metrics: { enabled: true }, logs: { enabled: true } }));
    await settle();

    expect(h.spanExporters).toEqual([]);
    // The providers still register — just with nothing attached.
    expect(h.processorCounts).toEqual({ traces: 0, metrics: 0, logs: 0 });
  });

  it("tags every resource with the configured service name", async () => {
    const setup = await freshSetup();
    setup(cfg({ service_name: "custom-name", metrics: { enabled: true } }));
    await settle();

    expect(h.resources[0]).toEqual({ "service.name": "custom-name" });
  });
});

describe("setupTelemetry — OTLP", () => {
  it("points each signal at its own derived collector endpoint", async () => {
    const setup = await freshSetup();
    setup(
      cfg({
        otlp: { enabled: true, endpoint: "http://collector:4318/v1/traces" },
        metrics: { enabled: true },
        logs: { enabled: true },
      }),
    );
    await settle();

    expect(h.otlpUrls).toEqual({
      traces: "http://collector:4318/v1/traces",
      metrics: "http://collector:4318/v1/metrics",
      logs: "http://collector:4318/v1/logs",
    });
    expect(h.spanExporters).toEqual(["otlp"]);
  });

  it("stacks console and OTLP exporters when both are on", async () => {
    const setup = await freshSetup();
    setup(
      cfg({
        console_export: true,
        otlp: { enabled: true, endpoint: "http://collector:4318/v1/traces" },
      }),
    );
    await settle();

    expect(h.spanExporters).toEqual(["console", "otlp"]);
    expect(h.processorCounts.traces).toBe(2);
  });
});

describe("setupTelemetry — Azure Monitor egress guard", () => {
  it("does NOT construct the Azure exporter when the connection string is unset", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setup = await freshSetup();
    setup(cfg({ azure_monitor: { enabled: true }, metrics: { enabled: true }, logs: { enabled: true } }));
    await settle();

    expect(h.azureConnStrings).toEqual([]);
    expect(h.spanExporters).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "azure_monitor enabled but APPLICATIONINSIGHTS_CONNECTION_STRING is unset",
    );
  });

  it("does NOT construct the Azure exporter when the connection string is present but the flag is off", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=abc");
    const setup = await freshSetup();
    setup(cfg({ metrics: { enabled: true }, logs: { enabled: true } }));
    await settle();

    expect(h.azureConnStrings).toEqual([]);
  });

  it("wires all three signals to Azure when enabled with a connection string", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=abc");
    const setup = await freshSetup();
    setup(cfg({ azure_monitor: { enabled: true }, metrics: { enabled: true }, logs: { enabled: true } }));
    await settle();

    expect(h.azureConnStrings).toEqual([
      "InstrumentationKey=abc",
      "InstrumentationKey=abc",
      "InstrumentationKey=abc",
    ]);
    expect(h.spanExporters).toEqual(["azure"]);
    expect(h.metricExporters).toEqual(["azure"]);
    expect(h.logExporters).toEqual(["azure"]);
  });
});

describe("setupTelemetry — resilience", () => {
  it("is idempotent: a second call is a no-op", async () => {
    const setup = await freshSetup();
    setup(cfg({ console_export: true }));
    await settle();
    setup(cfg({ console_export: true }));
    await settle();

    expect(h.registered).toEqual(["traces"]);
    expect(h.spanExporters).toEqual(["console"]);
  });

  it("warns and keeps serving when a provider fails to construct", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.tracerProviderThrows = true;
    const setup = await freshSetup();

    expect(() => setup(cfg({ console_export: true, metrics: { enabled: true } }))).not.toThrow();
    await settle();

    expect(warn).toHaveBeenCalledWith("telemetry setup failed, continuing:", "traces", "boom");
    // The failure is contained: metrics still came up.
    expect(h.registered).toEqual(["metrics"]);
  });
});
