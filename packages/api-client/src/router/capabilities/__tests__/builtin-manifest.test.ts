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

import { CANVAS_CAPABILITIES, createCapabilityRegistry } from "@polytoken/capabilities";

import { BUILTIN_CAPABILITY_MANIFEST } from "../builtin-manifest";

/** The frozen manifest vocabulary — mirrors `@polytoken/capabilities` capability.ts 1:1. */
const manifestEntrySchema = z
  .object({
    id: z.string().min(1),
    describe: z.string().min(1),
    risk: z.enum(["read", "write", "exec"]),
    // Additive (§5.2): optional; present only on the irreversible confirm class.
    reversibility: z.enum(["reversible", "irreversible"]).optional(),
    cost: z.enum(["free", "cheap", "moderate", "expensive"]),
    source: z.enum(["builtin", "external"]),
    trust: z.enum(["first-party", "verified", "claimed", "unvetted"]),
    origin: z.enum(["daemon", "chat", "control-plane"]),
  })
  .strict();

describe("BUILTIN_CAPABILITY_MANIFEST", () => {
  it("mirrors exactly the frozen builtin id set (13 daemon + 4 desktop + 3 canvas + 4 chat tools + deep_research)", () => {
    expect([...BUILTIN_CAPABILITY_MANIFEST].map((e) => e.id).sort()).toEqual(
      [
        // daemon builtins (apps/daemon/src/tools/capabilities.ts BUILTIN_CAPABILITIES)
        "fs.read",
        "fs.write",
        "fs.list",
        "terminal.exec",
        "git",
        // daemon browser session (apps/daemon/src/tools/browser.ts)
        "browser.open",
        "browser.navigate",
        "browser.screenshot",
        "browser.click",
        "browser.type",
        "browser.close",
        // daemon directory tree (apps/daemon/src/tools/dir.ts)
        "dir.list_tree",
        "dir.sync_manifest",
        // control-plane Cloud Desktop (packages/capabilities/src/desktop.ts)
        "desktop.spawn",
        "desktop.destroy",
        "desktop.hibernate",
        "desktop.attach",
        // control-plane canvas mutation (packages/capabilities/src/canvas.ts, AI-01)
        "canvas.addNode",
        "canvas.connect",
        "canvas.removeNode",
        // chat (email-listener container.py registry wiring)
        "lookup_entity",
        "search_emails",
        "search_knowledge",
        "web_search",
        "deep_research",
      ].sort(),
    );
  });

  it("the irreversible desktop verbs carry reversibility as data (§5.2 confirm-modal trigger)", () => {
    const byId = new Map(BUILTIN_CAPABILITY_MANIFEST.map((e) => [e.id, e]));
    expect(byId.get("desktop.spawn")).toMatchObject({ reversibility: "irreversible", risk: "exec", cost: "expensive" });
    expect(byId.get("desktop.destroy")).toMatchObject({ reversibility: "irreversible", risk: "exec" });
    // The reversible verbs declare no reversibility key (absent ⇒ reversible).
    expect(byId.get("desktop.attach")).not.toHaveProperty("reversibility");
    expect(byId.get("desktop.hibernate")).not.toHaveProperty("reversibility");
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
    // The new daemon session/dir rows — browser.open is the highest-consequence one.
    expect(byId.get("browser.open")).toMatchObject({ risk: "exec", cost: "expensive" });
    expect(byId.get("browser.navigate")).toMatchObject({ risk: "write", cost: "moderate" });
    expect(byId.get("browser.screenshot")).toMatchObject({ risk: "read", cost: "moderate" });
    expect(byId.get("dir.list_tree")).toMatchObject({ risk: "read", cost: "cheap" });
  });

  it("the canvas triple mirrors its declaring source (canvas.ts): write/free, removeNode explicitly reversible", () => {
    const byId = new Map(BUILTIN_CAPABILITY_MANIFEST.map((e) => [e.id, e]));
    expect(byId.get("canvas.addNode")).toMatchObject({ risk: "write", cost: "free", origin: "control-plane" });
    expect(byId.get("canvas.connect")).toMatchObject({ risk: "write", cost: "free", origin: "control-plane" });
    // Reversible-with-undo is declared AS DATA at the source and mirrored here (INV-4).
    expect(byId.get("canvas.removeNode")).toMatchObject({
      risk: "write",
      cost: "free",
      reversibility: "reversible",
      origin: "control-plane",
    });
    expect(byId.get("canvas.addNode")).not.toHaveProperty("reversibility");
    expect(byId.get("canvas.connect")).not.toHaveProperty("reversibility");
  });

  it("the canvas mirror rows are BYTE-IDENTICAL to the declaring registry's own projection (no drift possible)", () => {
    // Unlike the daemon/chat sources (unreachable process boundaries), canvas.ts is an importable
    // dependency — so this mirror gets a REAL drift alarm, not just an id pin.
    const projected = createCapabilityRegistry(CANVAS_CAPABILITIES).list();
    const mirrored = BUILTIN_CAPABILITY_MANIFEST.filter((e) => e.id.startsWith("canvas."));
    expect(mirrored.map(({ origin: _origin, ...rest }) => rest)).toEqual([...projected]);
    for (const entry of mirrored) expect(entry.origin).toBe("control-plane");
  });
});
