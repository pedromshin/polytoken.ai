import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    // The graphile integration test needs a real Postgres (WORKER_TEST_DATABASE_URL);
    // it self-skips when that is absent, so the default run is hermetic. The generous
    // timeouts cover the harness's connect + migrate + poll-drain in beforeAll/runOnce.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
