/**
 * Entrypoint — configure telemetry, build the app, serve it.
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getConfig } from "./config.js";
import { setupTelemetry } from "./telemetry.js";

// Config is validated here — startup fails fast on misconfiguration (#18).
const config = getConfig();
setupTelemetry(config);

const app = createApp();
const port = Number(process.env.PORT ?? 8000);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`corgi-ai-gateway listening on :${info.port}`);
});
