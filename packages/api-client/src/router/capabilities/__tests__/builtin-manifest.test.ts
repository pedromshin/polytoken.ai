/**
 * builtin-manifest.test.ts — pins the static mirror's honesty guarantees.
 *
 * The mirror module hand-copies each capability's manifest entry from its declaring source
 * (daemon TS registry / email-listener Python registry). No test can reach across those process
 * boundaries from here (importing `apps/daemon` into this package is banned — it would leak
 * daemon code toward the web bundle), so what IS pinned:
 *
 *   1. the frozen id SET — a rename/removal at a source registry must trip this file so the
 *      mirror gets re-synced by hand (the drift alarm the mirror design accepts);
 *   2. structural validity of every entry against the frozen manifest vocabulary
 *      (risk/cost/source/trust enums, non-empty describe);
 *   3. id uniqueness — the registry substrate treats a duplicate id as a permission bug
 *      (INV-2), and the allowlist panel keys toggles on id;
 *   4. today's constants: everything shipped in-repo is builtin/first-party (INV-3).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BUILTIN_CAPABILITY_MANIFEST } from "../builtin-manifest";

/** The frozen manifest vocabulary — mirrors `@polytoken/capabilities` capability.ts 1:1. */
const manifestEntrySchema = z
  .object({
    id: z.string().min(1),
    describe: z.string().min(1),
    risk: z.enum(["read", "write", "exec"]),
    cost: z.enum(["free", "cheap", "moderate", "expensive"]),
    source: z.enum(["builtin", "external"]),
    trust: z.enum(["first-party", "verified", "claimed", "unvetted"]),
    origin: z.enum(["daemon", "chat"]),
  })
  .strict();

describe("BUILTIN_CAPABILITY_MANIFEST", () => {
  it("mirrors exactly the frozen builtin id set (5 daemon + 4 chat tools + deep_research)", () => {
    expect([...BUILTIN_CAPABILITY_MANIFEST].map((e) => e.id).sort()).toEqual(
      [
        // daemon (apps/daemon/src/tools/capabilities.ts BUILTIN_CAPABILITIES)
        "fs.read",
        "fs.write",
        "fs.list",
        "terminal.exec",
        "git",
        // chat (email-listener container.py registry wiring)
        "lookup_entity",
        "search_emails",
        "search_knowledge",
        "web_search",
        "deep_research",
      ].sort(),
    );
  });

  it("every entry conforms to the frozen manifest vocabulary", () => {
    for (const entry of BUILTIN_CAPABILITY_MANIFEST) {
      expect(() => manifestEntrySchema.parse(entry)).not.toThrow();
    }
  });

  it("ids are unique — a duplicate id is a permission bug waiting to happen (INV-2)", () => {
    const ids = BUILTIN_CAPABILITY_MANIFEST.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("everything shipped in-repo is builtin/first-party today (INV-3)", () => {
    for (const entry of BUILTIN_CAPABILITY_MANIFEST) {
      expect(entry.source).toBe("builtin");
      expect(entry.trust).toBe("first-party");
    }
  });

  it("pins the risk/cost declarations copied from the declaring sources", () => {
    const byId = new Map(BUILTIN_CAPABILITY_MANIFEST.map((e) => [e.id, e]));
    // The load-bearing ones for the panel's risk grouping:
    expect(byId.get("terminal.exec")).toMatchObject({ risk: "exec", cost: "moderate" });
    expect(byId.get("fs.write")).toMatchObject({ risk: "write", cost: "cheap" });
    expect(byId.get("git")).toMatchObject({ risk: "write", cost: "cheap" });
    expect(byId.get("deep_research")).toMatchObject({ risk: "read", cost: "expensive" });
    expect(byId.get("web_search")).toMatchObject({ risk: "read", cost: "moderate" });
  });
});
