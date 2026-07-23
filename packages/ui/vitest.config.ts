import { defineConfig } from "vitest/config";

export default defineConfig({
  // Automatic JSX runtime (react/jsx-runtime) — this repo's tsconfig says
  // "jsx": "preserve", so esbuild would otherwise fall back to the classic
  // React.createElement transform and throw "React is not defined" for JSX
  // that does not import React (mirrors packages/genui/vitest.config.ts).
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
