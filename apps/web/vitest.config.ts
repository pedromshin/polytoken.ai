import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's `"~/*": ["./src/*"]` path alias — without this,
// vitest/vite (which does not read tsconfig `paths` on its own) cannot
// resolve any module under test that imports "~/..." (e.g. "~/trpc/react"),
// failing with "Failed to resolve import" even though `tsc`/`next build`
// both resolve it fine via tsconfig.
export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // The app + @polytoken/ui use the React 17+ automatic JSX runtime (Next's
  // default; tsconfig `jsx: "preserve"` hands the transform to the bundler).
  // Many @polytoken/ui components (e.g. spreadsheet-grid) never `import React`,
  // so a component test that mounts them must transform with the automatic
  // runtime too — otherwise the classic transform emits bare `React.*` and
  // throws "React is not defined" from inside the vendored component.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    env: {
      // Mirrors packages/api-client/vitest.config.ts's convention: bypasses
      // src/lib/env.ts's module-level fail-fast so test runs never need
      // real Supabase/email-listener credentials just to import a module
      // that reads from it.
      SKIP_ENV_VALIDATION: "true",
    },
  },
});
