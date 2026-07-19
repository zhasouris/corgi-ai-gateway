import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
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
