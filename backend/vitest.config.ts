import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
    },
  },
});
