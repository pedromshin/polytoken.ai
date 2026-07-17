import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `apps/daemon` is not a workspace tonight (R-09), so there is no
 * `node_modules/@polytoken/daemon-protocol` symlink to resolve through. `tsc` and `tsx` honor the
 * tsconfig `paths` mapping, but Vite/vitest does NOT read tsconfig paths — without this alias the
 * suite cannot even load the module under test.
 *
 * ORCHESTRATOR: this alias stays correct after `apps/daemon` joins the root `workspaces` glob (it
 * simply points at the same source the symlink would). Safe to keep; safe to delete once the
 * workspace link exists. Deleting it is NOT required at merge.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@polytoken/daemon-protocol": fileURLToPath(
        new URL("../../packages/daemon-protocol/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    // These suites do real filesystem work (junctions, atomic renames) — no jsdom, no globals.
    include: ["src/**/*.test.ts"],
  },
});
