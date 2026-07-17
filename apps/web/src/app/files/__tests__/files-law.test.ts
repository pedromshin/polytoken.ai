/**
 * files-law.test.ts — the /files surface's own scoped law gate
 * (Phase 66 Plan 04 Task 3, D-66-06).
 *
 * Mirrors `apps/web/src/app/__tests__/role-hue-ban.test.ts`'s line-reading
 * mechanics. Read that file's header before touching this one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS GATE EXISTS SEPARATELY FROM THE RATCHET
 * ────────────────────────────────────────────────────────────────────────────
 * `role-hue-ban.test.ts`'s `SCOPED_DIRS` is Lane A's file and this lane does
 * not edit it (LANE-CONTRACTS). So the vault ships its own gate, scoped to
 * itself, and the SUMMARY asks the orchestrator to append `files` to
 * SCOPED_DIRS post-merge.
 *
 * That order is deliberate and it is role-hue-ban's own rule: **the append is
 * the LAST step of a sweep, never the first.** A root appended while red is how
 * a ratchet gets "allowlisted into meaninglessness within a week". This surface
 * is born clean; this gate is what earns the append.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE SELF-INVALIDATING-GATE TRAP — LIVE HERE, NOT HYPOTHETICAL
 * ────────────────────────────────────────────────────────────────────────────
 * This gate walks `files/**`, and it LIVES in `files/__tests__/`. It will read
 * its own source and its sibling `vault-write.test.tsx` — both of which
 * legitimately name every token it bans, because that is what an assertion
 * about a banned token looks like. Written naively, this gate goes RED on
 * arrival and the "obvious fix" is to delete the rule.
 *
 * Three defences, all deliberate, all stated (an unexplained exclusion is how
 * a gate gets widened into meaninglessness a month later):
 *
 *   (a) EVERY PATTERN IS BUILT FROM PARTS, never written out as a literal.
 *       The strings below are assembled at runtime precisely so this file's
 *       own source does not contain them.
 *   (b) COMMENT LINES ARE STRIPPED before matching. This paragraph names the
 *       bans; the matcher never sees it.
 *   (c) `__tests__/` IS EXCLUDED — but ONLY from the checks whose tokens a
 *       test must legitimately name (the madder count, and the class bans that
 *       tests assert on). The structural bans that no test has any reason to
 *       contain are checked EVERYWHERE under `files/`, tests included.
 *
 * Defence (c) is the one worth arguing about, so: excluding tests wholesale
 * would let a test file quietly become the place a violation lives. Excluding
 * nothing would make the gate red on arrival. The split is the honest middle,
 * and the `stripComments` self-test at the bottom proves (b) actually works.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** `apps/web/src/app/files` */
const FILES_DIR = path.resolve(__dirname, "..");

const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

type SourceLine = { readonly line: number; readonly text: string };
type SourceFile = { readonly rel: string; readonly lines: readonly SourceLine[] };

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return collectFiles(full);
    return FILE_EXTENSIONS.has(path.extname(entry)) ? [full] : [];
  });
}

/**
 * Drop comment lines.
 *
 * `{/*` IS HANDLED, AND IT IS NOT AN EDGE CASE — IT IS THE FIRST THING THAT
 * BROKE THIS GATE. A JSX comment opens with `{` before the `/*`, so a stripper
 * that only recognizes `/*` sails straight past it. On the first run this gate
 * reported a `dangerouslySetInnerHTML` violation in `vault-row.tsx` — which
 * was its own JSX comment EXPLAINING that names are never rendered that way.
 * Exactly the self-invalidating outcome this file's header warns about, via a
 * form the header did not anticipate. `.tsx` files are most of this surface;
 * `{/* … *\/}` is how they carry inline prose.
 *
 * Line-based, and therefore still imperfect: it does not understand a trailing
 * `// …` after code. That errs toward KEEPING a line, i.e. toward a false
 * positive (a gate that complains too loudly) rather than a false negative (a
 * violation that slips through). A gate should fail in the safe direction.
 */
function stripComments(source: string): SourceLine[] {
  const out: SourceLine[] = [];
  let inBlock = false;

  source.split("\n").forEach((raw, index) => {
    const trimmed = raw.trim();

    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return;
    }
    // `/*` (a normal block/JSDoc) and `{/*` (a JSX comment) both open a block.
    if (trimmed.startsWith("/*") || trimmed.startsWith("{/*")) {
      if (!trimmed.includes("*/")) inBlock = true;
      return;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (trimmed.length === 0) return;

    out.push({ line: index + 1, text: raw });
  });

  return out;
}

function loadSources(opts: { includeTests: boolean }): SourceFile[] {
  return collectFiles(FILES_DIR)
    .filter((abs) => {
      const rel = path.relative(FILES_DIR, abs).split(path.sep).join("/");
      if (rel === "__tests__/files-law.test.ts") return false; // (c): never itself
      if (!opts.includeTests && rel.includes("__tests__/")) return false;
      return true;
    })
    .map((abs) => ({
      rel: path.relative(FILES_DIR, abs).split(path.sep).join("/"),
      lines: stripComments(readFileSync(abs, "utf-8")),
    }));
}

// ---------------------------------------------------------------------------
// (a) Tokens assembled from parts — never written out
// ---------------------------------------------------------------------------

/**
 * THE MADDER TOKEN ITSELF, not one syntactic spelling of it.
 *
 * The first draft of this gate looked for the JSX attribute form of the madder
 * variant and matched NOTHING, while `delete-dialog.tsx` was sitting right there
 * using the object form (`buttonVariants({ variant: … })`). A gate looking for
 * one spelling of a rule is a gate that reports safety on every other spelling:
 * the bg- utility, the text- utility, and the object form all paint madder, and
 * all would have passed.
 *
 * So: match the token, in any form. Every one of those spellings paints madder,
 * and on this surface exactly one file is allowed to.
 *
 * NOTE — the literals are DESCRIBED here, never written. The repo-wide ratchet
 * (`app/__tests__/role-hue-ban.test.ts`) walks this directory, so a comment that
 * spells a banned utility turns the ratchet red on its own documentation. That
 * is not hypothetical: it happened on this exact docblock the moment `files`
 * joined SCOPED_DIRS, and 61-06 hit it four times before that. Build patterns
 * from parts; describe examples in prose.
 */
const MADDER_TOKEN = ["destruc", "tive"].join("");
const SERIF = ["font", "serif"].join("-");
const EVIDENCE_ATTR = ["data", "evidence"].join("-");
const PMARK = ["p", "mark"].join("");
const DANGER_HTML = ["dangerously", "SetInnerHTML"].join("");
const RING = ["ring", "-"].join("");
const RING_OFFSET = ["ring", "offset"].join("-");
const OUTLINE_NONE = ["focus-visible:outline", "none"].join("-");
const BREAK_WORDS = ["break", "words"].join("-");
const SCROLL_AREA = ["Scroll", "Area"].join("");
const SERVICE_ROLE = ["SERVICE", "ROLE"].join("_");
const CHIP_CLASS = ['"', "chip", '"'].join("");

type Violation = { file: string; line: number; match: string };

function scan(
  sources: readonly SourceFile[],
  predicate: (text: string) => string | null,
): Violation[] {
  return sources.flatMap((source) =>
    source.lines.flatMap((line) => {
      const match = predicate(line.text);
      return match ? [{ file: source.rel, line: line.line, match }] : [];
    }),
  );
}

const report = (violations: readonly Violation[]) =>
  violations.map((v) => `  ${v.file}:${v.line} -> "${v.match}"`).join("\n");

const contains = (token: string) => (text: string) =>
  text.includes(token) ? token : null;

// ---------------------------------------------------------------------------

describe("files surface law gate (D-66-06)", () => {
  it("walks real files — the gate cannot be made vacuous by a rename", () => {
    // A gate that inspects nothing passes everything.
    expect(existsSync(FILES_DIR)).toBe(true);
    const sources = loadSources({ includeTests: true });
    expect(sources.length).toBeGreaterThan(8);
    expect(sources.map((s) => s.rel)).toContain("_components/vault-row.tsx");
  });

  it("does not execute itself — comment stripping works, JSX comments included", () => {
    // Defence (b), proven rather than trusted. If comment-stripping regressed,
    // every check below would go red on this file's own prose and the obvious
    // "fix" would be to delete the rules.
    const stripped = stripComments(
      [
        "/**",
        ` * ${MADDER_TOKEN} ${SERIF} ${DANGER_HTML}`,
        " */",
        `// ${PMARK}`,
        // The JSX forms — the ones that actually broke this gate on its first
        // run. Pinned so the regression cannot come back quietly.
        `{/* ${DANGER_HTML} ${SERIF} */}`,
        "{/* a multi-line JSX comment",
        `    still naming ${MADDER_TOKEN} */}`,
        "const real = 1;",
      ].join("\n"),
    );
    expect(stripped).toEqual([{ line: 8, text: "const real = 1;" }]);
  });

  // ── LAW 1: madder is for the irreversible, and it lives in ONE file ───────

  it("THE SHARPEST ASSERTION: madder appears in EXACTLY ONE file", () => {
    // This encodes "madder is for the irreversible only" as a COUNTABLE fact.
    // It is what stops the next contributor reaching for the destructive
    // variant on an upload error at 2am — and it is checkable in a screenshot,
    // which is the point: the surface tells one story about itself.
    //
    // Tests excluded (c): they assert on the token by name.
    const owners = loadSources({ includeTests: false })
      .filter((s) => s.lines.some((l) => l.text.includes(MADDER_TOKEN)))
      .map((s) => s.rel);

    expect(
      owners,
      `Madder means "irreversible — this cannot be undone" (D-58-01 law 1). On this ` +
        `surface exactly ONE act qualifies: the delete confirm. Errors, warnings, and ` +
        `statuses are ink on a rule with a glyph carrying the role.\nFound in: ${owners.join(", ")}`,
    ).toEqual(["_components/delete-dialog.tsx"]);
  });

  // ── LAW 2: this surface displays NO evidence ─────────────────────────────

  it("no serif, no provenance mark, no evidence attribute — nothing here is evidence", () => {
    // D-66-05: nothing on this surface came out of the user's mail. File names
    // are METADATA/chrome, so they are sans.
    //
    // THIS TEST IS A TRIPWIRE, NOT A STYLE RULE: the day someone adds a
    // text-file preview, it goes red and FORCES the re-decision — rather than
    // letting serif drift onto chrome silently, which is law 2's tell.
    const sources = loadSources({ includeTests: false });
    const violations = [
      ...scan(sources, contains(SERIF)),
      ...scan(sources, contains(EVIDENCE_ATTR)),
      ...scan(sources, contains(PMARK)),
      ...scan(sources, contains(CHIP_CLASS)),
    ];

    expect(
      violations,
      `Law 2: serif is for the user's own material; this surface has none.\n${report(violations)}`,
    ).toHaveLength(0);
  });

  // ── The traps, made unrepeatable ─────────────────────────────────────────

  it("no ring — focus is an outline (the white-halo-in-dark trap)", () => {
    // `--tw-ring-offset-color` defaults to #fff, which paints a halo in dark
    // (D-61-03-F; globals.css says so in its own words).
    //
    // SCOPE, STATED HONESTLY: this bans what THIS SURFACE WRITES. The kit's
    // `Button` base carries `ring-1 ring-ring` and the four kit Buttons here
    // inherit it — that is out of this gate's reach, and it is acceptable
    // because `--ring: var(--ink)` (hueless) and the Button base sets no
    // ring-offset, so the halo trap is absent. Fixing button.tsx is Lane A's.
    const sources = loadSources({ includeTests: false });
    const violations = [
      ...scan(sources, contains(RING_OFFSET)),
      ...scan(sources, (text) => {
        // `ring-` as a utility, not the word inside e.g. "during-".
        const m = /(^|\s|")ring-[a-z0-9[]/.exec(text);
        return m ? m[0] : null;
      }),
    ];

    expect(violations, `Use OUTLINE, never ring:\n${report(violations)}`).toHaveLength(0);
  });

  it("no focus-visible:outline-none — it survives tailwind-merge and kills outline-2", () => {
    const violations = scan(loadSources({ includeTests: false }), contains(OUTLINE_NONE));
    expect(
      violations,
      `Evict it with \`outline-solid\`; do not re-introduce it.\n${report(violations)}`,
    ).toHaveLength(0);
  });

  it("no break-words — it is v3 syntax and emits NOTHING in v4", () => {
    // The nastiest kind of dead style: it looks right in the source, reviews
    // clean, and renders nothing at all.
    const violations = scan(loadSources({ includeTests: false }), contains(BREAK_WORDS));
    expect(
      violations,
      `Use \`wrap-break-word\` (or truncate).\n${report(violations)}`,
    ).toHaveLength(0);
  });

  it("no Radix ScrollArea — its Viewport shrink-wraps via display:table", () => {
    // D-66-05 sidesteps the D-61-06 trap by construction rather than managing
    // it: this page scrolls, and the listing is a block list.
    const violations = scan(loadSources({ includeTests: false }), contains(SCROLL_AREA));
    expect(violations, `The page scrolls.\n${report(violations)}`).toHaveLength(0);
  });

  // ── Security, checked EVERYWHERE including tests ─────────────────────────

  it("no dangerouslySetInnerHTML anywhere under files/ — tests included", () => {
    // T-66-06. File names are attacker-controlled strings. No test has any
    // legitimate reason to contain this, so it is checked everywhere: a test
    // file must never become the place a violation lives.
    const violations = scan(loadSources({ includeTests: true }), contains(DANGER_HTML));
    expect(
      violations,
      `Names render as React text children — escaped by default.\n${report(violations)}`,
    ).toHaveLength(0);
  });

  it("no service-role credential in client code anywhere under files/ — tests included", () => {
    // T-66-11. The client never constructs a storage key, never names a
    // bucket, and never holds a credential.
    const violations = scan(loadSources({ includeTests: true }), contains(SERVICE_ROLE));
    expect(
      violations,
      `Service-role credentials never leave the server.\n${report(violations)}`,
    ).toHaveLength(0);
  });
});
