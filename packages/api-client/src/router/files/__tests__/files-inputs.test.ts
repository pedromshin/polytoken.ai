/**
 * files-inputs.test.ts — a SOURCE-level gate over `router/files/*.ts`
 * (Phase 66 Plan 02 Task 2), mirroring `role-hue-ban.test.ts`'s line-reading
 * mechanics.
 *
 * WHY A SECOND GATE, WHEN `files-tenancy.test.ts` ALREADY PROVES THE BEHAVIOUR:
 * because they fail on different mistakes. The behavioural test proves what
 * today's code DOES; this one proves what the code IS ALLOWED TO SAY. A
 * refactor that keeps every test green while quietly swapping one procedure to
 * `publicProcedure` is caught here; conversely, a subtle wiring bug that leaves
 * the source looking perfect is caught there. The plan's negative proof #2
 * requires BOTH to fire on one mistake, and they do.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SELF-INVALIDATING-GATE TRAP — LIVE IN THIS FILE, NOT HYPOTHETICAL
 * ────────────────────────────────────────────────────────────────────────────
 * This gate walks `router/files/`. Its own prose — the paragraph you are
 * reading — names every token it bans, and `index.ts`'s header legitimately
 * spells out `userId`, `key`, `bucket` and `prefix` while explaining the rule
 * that forbids them as INPUT FIELDS. A naive line count would flag the very
 * comments that document the law.
 *
 * Two defences, both deliberate:
 *   (a) COMMENT LINES ARE STRIPPED before matching (see `stripComments`);
 *   (b) `__tests__/` is excluded from the walk — this file and its sibling
 *       assert on the banned tokens by name, and are not shipped code.
 * The exclusions are stated rather than silent, because an unexplained
 * exclusion is how a gate gets widened into meaninglessness a month later.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** `packages/api-client/src/router/files` */
const FILES_ROUTER_DIR = path.resolve(__dirname, "..");

/**
 * Shipped source only. `__tests__/` is excluded because these suites name the
 * banned tokens as assertions — see the header. Everything else under
 * `router/files/` IS in scope, including any file added later.
 */
function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" ? [] : collectSourceFiles(full);
    }
    return entry.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Drop comment lines. Line-based and therefore imperfect — it does not
 * understand a trailing `// ...` after code, nor a block comment opened
 * mid-line. That is acceptable HERE and worth being explicit about: erring
 * toward keeping a line means erring toward a FALSE POSITIVE (a gate that
 * complains too loudly), never a false negative (a violation that slips
 * through). A gate should fail in the safe direction.
 */
function stripComments(source: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;

  source.split("\n").forEach((raw, index) => {
    const trimmed = raw.trim();

    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return;
    }
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (trimmed.length === 0) return;

    out.push({ line: index + 1, text: raw });
  });

  return out;
}

/** Tokens assembled from parts, never written out — role-hue-ban's convention. */
const CTX_USER_ID = ["ctx", "user", "id"].join(".");
const INPUT_USER_ID = ["input", "userId"].join(".");
const PUBLIC_PROCEDURE = ["public", "Procedure"].join("");

type SourceFile = { rel: string; lines: { line: number; text: string }[] };

function loadSources(): SourceFile[] {
  return collectSourceFiles(FILES_ROUTER_DIR).map((abs) => ({
    rel: path.relative(FILES_ROUTER_DIR, abs).split(path.sep).join("/"),
    lines: stripComments(readFileSync(abs, "utf-8")),
  }));
}

describe("files router source gate (T-66-02 / T-66-04)", () => {
  it("walks real files — the gate cannot be made vacuous by a rename", () => {
    // A gate that inspects nothing passes everything.
    const sources = loadSources();
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.map((s) => s.rel)).toContain("index.ts");
  });

  it("every procedure takes its acting user from the auth context", () => {
    const index = loadSources().find((s) => s.rel === "index.ts");
    expect(index).toBeDefined();

    const hits = index!.lines.filter((l) => l.text.includes(CTX_USER_ID));

    // Five procedures, each passing ctx.user.id to the adapter. Counting
    // rather than merely checking presence: "at least one procedure is
    // scoped" is not the claim — every one of them is.
    expect(
      hits.length,
      `expected 5 procedures to reference the auth context, found ${hits.length}`,
    ).toBeGreaterThanOrEqual(5);
  });

  it("no shipped file reads a user id out of procedure input", () => {
    const violations = loadSources().flatMap((s) =>
      s.lines
        .filter((l) => l.text.includes(INPUT_USER_ID))
        .map((l) => `${s.rel}:${l.line} -> ${l.text.trim()}`),
    );

    expect(
      violations,
      `The acting user must come from the auth context, never from input:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  it("no procedure under router/files is public", () => {
    const violations = loadSources().flatMap((s) =>
      s.lines
        .filter((l) => l.text.includes(PUBLIC_PROCEDURE))
        .map((l) => `${s.rel}:${l.line} -> ${l.text.trim()}`),
    );

    expect(
      violations,
      `Every vault procedure reaches service-role storage credentials. There is no ` +
        `public one, and there is no case for one:\n${violations.join("\n")}`,
    ).toHaveLength(0);
  });

  it("the gate strips comments — its own documentation does not trip it", () => {
    // Proves defence (a) directly rather than trusting it. `index.ts`'s header
    // spells out the banned input-field names while explaining the rule; if
    // comment-stripping regressed, the tests above would go red on prose and
    // the obvious "fix" would be to delete the rule.
    const stripped = stripComments(
      [
        "/**",
        ` * ${INPUT_USER_ID} and ${PUBLIC_PROCEDURE} named in a header comment.`,
        " */",
        `// ${INPUT_USER_ID} in a line comment`,
        "const real = 1;",
      ].join("\n"),
    );

    expect(stripped).toEqual([{ line: 5, text: "const real = 1;" }]);
  });
});
