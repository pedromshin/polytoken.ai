/**
 * bundle.mjs — produce a RUNNABLE single-file dist for the expose-only MCP server (77-R2).
 *
 * ## Why plain `tsc` output is not runnable
 *
 * `npm run build` (tsc) emits dist/index.js that still says `import "@polytoken/api-client"`.
 * The workspace packages' `exports` maps resolve `default` → `./src/index.ts` — TypeScript
 * SOURCE — so Node crashes at runtime with ERR_UNKNOWN_FILE_EXTENSION the moment the compiled
 * entrypoint touches a workspace import. This script inlines every workspace package (and the
 * pure-JS third-party deps they pull) into ONE `dist/index.js`, so
 * `node apps/mcp-server/dist/index.js` boots from a plain checkout.
 *
 * ## Externals
 *
 *   - Node builtins       — automatically external (platform: "node");
 *   - postgres / pg       — the DB drivers stay external (pg optionally require()s the
 *     native `pg-native` addon; postgres-js is left beside it for symmetry). Both resolve
 *     from the hoisted root node_modules at runtime, which is where this server runs.
 *
 * Everything else — the @polytoken/* workspace TS, the MCP SDK server side, tRPC, Zod,
 * drizzle-orm, superjson, … — is pure JS and is inlined. The `createRequire` banner is the
 * standard shim for inlined CJS deps that call `require()` dynamically inside ESM output.
 *
 * esbuild is resolved from the hoisted root node_modules (vitest → vite ships it); the
 * import is guarded so a missing binary fails with an actionable message, not a bare stack.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    throw new Error(
      "[mcp-server/bundle] esbuild is not resolvable — it normally arrives hoisted via " +
        "vitest→vite. Run `npm install` at the repo root (or add esbuild as a devDependency).",
    );
  }
}

async function main() {
  const { build } = await loadEsbuild();
  const result = await build({
    entryPoints: [join(PKG_DIR, "src", "index.ts")],
    outfile: join(PKG_DIR, "dist", "index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: ["pg", "pg-native", "postgres"],
    banner: {
      js:
        'import { createRequire as __bundleCreateRequire } from "node:module";\n' +
        "const require = __bundleCreateRequire(import.meta.url);",
    },
    logLevel: "info",
  });
  if (result.errors.length > 0) {
    // logLevel:"info" already printed the diagnostics; make the exit code honest too.
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[mcp-server/bundle] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
