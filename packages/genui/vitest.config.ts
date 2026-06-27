import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom", // catalog entries reference React components (D-20)
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
