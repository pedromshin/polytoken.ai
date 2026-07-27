import path from "path";
import { defineConfig } from "vitest/config";

/**
 * vitest config for the expose-only MCP server.
 *
 * The catalogue + dispatch + principal modules are PURE (no @modelcontextprotocol/sdk
 * import), so this suite runs green WITHOUT the SDK installed — the SDK-dependent
 * `src/index.ts` stdio wiring is never imported by a test. Importing
 * `@polytoken/api-client` pulls in the full appRouter graph; we mirror api-client's own
 * vitest here: SKIP_ENV_VALIDATION so `@polytoken/db/client` exports its undefined
 * placeholder instead of trying to connect, and the genui schema-only alias so no JSX
 * renderer is dragged into this server-only package.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@polytoken/genui/schema": path.resolve(
        __dirname,
        "../../packages/genui/src/schema/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    env: {
      SKIP_ENV_VALIDATION: "true",
    },
  },
});
