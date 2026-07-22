import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      // Excluded: the process entrypoint (boots the server; exercised by the
      // container boot check, not unit tests) and the demo page, which is a
      // static HTML/JS string rather than logic under test.
      exclude: ["src/index.ts", "src/demo.ts"],
      // Floors set at the measured baseline so CI fails on a regression. Ratchet
      // these up as coverage improves — never down to make a build pass.
      thresholds: {
        statements: 78,
        branches: 58,
        functions: 83,
        lines: 80,
      },
    },
  },
  // Source uses NodeESM-style ".js" import specifiers (correct for tsx/Node at
  // runtime). Map them to the ".ts" sources when the bundler resolves.
  plugins: [
    {
      name: "js-to-ts-resolver",
      enforce: "pre",
      async resolveId(source, importer) {
        if (importer && source.startsWith(".") && source.endsWith(".js")) {
          const resolved = await this.resolve(source.slice(0, -3) + ".ts", importer, {
            skipSelf: true,
          });
          if (resolved) return resolved;
        }
        return null;
      },
    },
  ],
});
