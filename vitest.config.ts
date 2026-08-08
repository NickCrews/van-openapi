import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.behavior.ts"],
    // Every behavior hits the live sandbox. Serial files keep the whole suite
    // under one shared request rate rather than one-per-worker.
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
