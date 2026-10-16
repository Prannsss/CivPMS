import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/domain/**/*.ts"],
      exclude: ["src/lib/domain/**/*.test.ts", "src/lib/domain/index.ts", "src/lib/domain/test-fixtures.ts"],
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 95,
      },
    },
  },
});
