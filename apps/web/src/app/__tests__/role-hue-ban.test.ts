import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Committed law-1 / law-3 source gate for Phase 60's two surfaces
 * (60-06-PLAN.md Task 3). Mirrors `palette-ban.test.ts`'s walk idiom.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS GATE IS SCOPED, NOT GLOBAL. THE SCOPE IS THE POINT.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Phase 60 swept role-as-hue out of the inbox and the email-detail view;
 * Phase 61 swept the chat surface and its canvas. The banned tokens are NOT
 * dead: they are still registered in `globals.css`, they still autocomplete,
 * and they are still legitimately in use on the knowledge surfaces
 * (`knowledge/`, `entities/`), which Phase 62 owns and has not swept yet. A
 * global ban would be red on arrival and would be deleted or allowlisted into
 * meaninglessness within a week.
 *
 * So the ban is scoped to the roots that ARE swept, and it is a RATCHET:
 * **each of Phases 61-63 ADDS its own root to `SCOPED_DIRS` as it sweeps.**
 * The banned area only ever grows. Without this, the next phase to touch
 * these files reintroduces a role hue in an afternoon and nothing objects.
 *
 * `SCOPED_DIRS` is exported and asserted on below precisely so the scope
 * cannot be quietly NARROWED to make a future violation pass: shrinking it
 * is now a visible, test-breaking act rather than a one-word diff.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ON WRITING LITERALS IN THIS FILE
 * ────────────────────────────────────────────────────────────────────────
 *
 * `palette-ban.test.ts` warns that it walks its own source, so a literal
 * example in it would match itself. This file's honest position is narrower:
 * it lives in `app/__tests__/`, which is outside both scoped roots, so it
 * does NOT currently walk itself. That immunity is an accident of where the
 * file happens to sit, and `SCOPED_DIRS` is designed to GROW — so the
 * patterns below are still constructed from parts, never written out.
 *
 * The trap that IS live here: the walk DOES cover the `__tests__/`
 * directories inside the scoped roots, and the sibling gates there
 * (`region-vocabulary.test.ts`, `region-overlay-law.test.tsx`,
 * `extraction-summary-structure.test.tsx`) legitimately assert on the banned
 * family by name. They survive because `ROLE_HUE_PATTERN` requires a
 * colour-utility PREFIX: a bare mention of the family is prose or an
 * assertion, while the same family behind a fill/text/border prefix is a
 * rendered hue. That distinction is load-bearing — widen the pattern to a
 * bare family match and this gate will execute its own siblings.
 *
 * The same applies to product comments: this gate reads LINES, not prose,
 * and cannot tell a citation from a class. Files under the scoped roots
 * therefore describe the retired tokens rather than naming them. That is the
 * correct trade — a commented-out violation is one paste away from live.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** apps/web/src/app — the roots below are resolved against this. */
const APP_DIR = path.resolve(__dirname, "..");

/**
 * THE RATCHET. Roots swept clean of role-as-hue, relative to `apps/web/src/app`.
 *
 *   - `_components`  — the inbox surface        (Phase 60, swept)
 *   - `emails/[id]`  — the email-detail surface (Phase 60, swept)
 *   - `chat`         — the chat surface AND its canvas (Phase 61, swept:
 *                      61-06 cleared `_canvas/`, 61-08 cleared `_components/`)
 *   - `_vocabulary`  — the shared tier vocabulary (Phase 61, born clean)
 *
 * Resolved as exact paths under APP_DIR, so `_components` here means the
 * INBOX's `_components` only — `knowledge/_components` and its siblings are
 * untouched by this gate until their own phase adds them. `chat`, by contrast,
 * is the whole subtree: `chat/_components`, `chat/_canvas`, `chat/_hooks` and
 * every `__tests__` inside them.
 *
 * WHAT IT COST TO ADD `chat` (61-08), because "just append it" was never the
 * job: the root was RED ON ARRIVAL with 11 violations — 10 madder-on-a-state
 * across five files (both inline error cards, the widget error row, the WebGPU
 * warning) and one retired role hue. Every one was a state talking, not an
 * irreversible action, so every one was swept rather than allowlisted. A root
 * appended while red is how a ratchet gets "allowlisted into meaninglessness
 * within a week" — this file's own header names that failure mode, and the
 * append is the LAST step of a sweep, never the first.
 *
 * PHASE 62: `knowledge/` swept and appended below (SURF-03/04 — the node
 * chrome moved onto the canvas card language, kind now lives on the
 * left-rule weight axis, and the tier-filter's verdigris selection fill was
 * re-inked). `studio/`, `settings/` and `login/` were swept in the same
 * pass (SURF-05): every madder-on-a-state error banner in the studio
 * islands became ink-on-a-rule. `entities/` remains for its own sweep —
 * append it here when it happens. Do not remove one.
 */
export const SCOPED_DIRS: readonly string[] = [
  "_components",
  "emails/[id]",
  "chat",
  "_vocabulary",
  // Phase 66 (files vault) — earned on arrival: the lane's own scoped law gate was green
  // before merge, so the ratchet grows without a sweep. The banned area only ever grows.
  "files",
  // Phase 62 (SURF-03/04/05) — swept in the identity redesign pass:
  "knowledge",
  "studio",
  "settings",
  "login",
];

/** Structurally excluded from the walk (§E, same set as palette-ban.test.ts). */
const EXCLUDED_DIR_SEGMENTS = new Set(["dev", "node_modules", ".next"]);

const FILE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * LAW 3 / LAW 1 — role-as-hue.
 *
 * The retired family encoded a node's ROLE (entity / email-component /
 * email) in a colour. Law 3 gives type and role to SHAPE, because shape
 * survives greyscale and colour-blindness; law 1 then lets tier own the
 * colour budget outright. Post-59 these tokens had collapsed into
 * near-identical greys anyway (see `globals.css`) — they had stopped
 * distinguishing anything, while still teaching a colour key that exists
 * nowhere on the document.
 *
 * Family name and prefixes are assembled at runtime, never written out.
 */
const ROLE_HUE_FAMILY = ["gra", "ph"].join("");

const COLOR_UTILITY_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "decoration",
  "outline",
  "divide",
  "placeholder",
  "caret",
  "accent",
  "shadow",
] as const;

/**
 * Matches a colour-bearing utility prefix + the retired role family + a token
 * name — i.e. the family actually PAINTING something. A bare mention of the
 * family (prose, or a sibling gate asserting its absence) is deliberately not
 * matched; see the header note.
 */
const ROLE_HUE_PATTERN = new RegExp(
  `\\b(?:${COLOR_UTILITY_PREFIXES.join("|")})-${ROLE_HUE_FAMILY}-[a-z][a-z0-9-]*`,
  "g",
);

/**
 * LAW 1 — madder is an ACTION's colour, never a state's.
 *
 * 58-IDENTITY: madder means "irreversible — this cannot be undone", and is
 * allowed on "destructive buttons only. Never errors, never warnings."
 *
 * The distinction this gate encodes:
 *   BANNED  — madder TEXT and madder BORDERS. Nothing performs an action by
 *             being coloured; a word or a frame wearing madder is a STATE
 *             talking, which is precisely what law 1 forbids.
 *   ALLOWED — the madder VARIANT and the madder FILL, plus its paired
 *             foreground. Those are how a real reject/deny/delete button is
 *             built, and law 1 EARNS them: removing them would break law 1
 *             from the other side, leaving the one genuinely irreversible
 *             control indistinguishable from the benign one beside it.
 *
 * SAY IT PLAINLY: THIS IS A PROXY, NOT A PROOF. "Fill on a button is fine,
 * text or border is a state talking" is the closest a source-level gate can
 * get to a rule about INTENT, and it is not the rule itself. It has a known
 * blind spot in both directions:
 *   - a status badge rendered with the allowed VARIANT passes this gate and
 *     still violates law 1 (60-06 found exactly one, a "Preview failed"
 *     badge in `pdf-preview-pane.tsx`, by reading — not by grep);
 *   - a genuinely irreversible control built with madder TEXT instead of a
 *     fill would fail this gate despite obeying law 1, and should be
 *     rebuilt as a fill rather than allowlisted.
 * Judgement stays with the reviewer. This gate only makes the cheap, common
 * regression expensive.
 */
const MADDER_TOKEN = ["destruc", "tive"].join("");

/** Prefixes that make madder a STATE rather than an action's fill. */
const STATE_MADDER_PREFIXES = ["text", "border"] as const;

/**
 * `(?!-foreground)` keeps the legitimate pair intact: the foreground token is
 * the text sitting ON a madder fill — i.e. part of a real destructive button
 * (`confirm-deny-controls.tsx`, `layers-tree-row.tsx`), not a state.
 */
const STATE_MADDER_PATTERN = new RegExp(
  `\\b(?:${STATE_MADDER_PREFIXES.join("|")})-${MADDER_TOKEN}\\b(?!-foreground)`,
  "g",
);

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly match: string;
};

/**
 * Inline allowlist for genuinely-justified occurrences. It starts EMPTY and
 * should stay that way: Phase 60 converted both scoped surfaces outright
 * (60-01..60-06-SUMMARY.md).
 *
 * DO NOT ADD TO IT WITHOUT A DOCUMENTED REASON. An entry here is a claim that
 * a role reads better as a hue than as a shape, or that a state has earned
 * the irreversible colour — both are amendments to D-58-01 (LOCKED), which
 * requires a demonstrated usability failure of the monochrome treatment, not
 * a preference. Take it to the identity record, not to this array.
 *
 * Shape: `{ file, pattern, reason }` — `file` is APP_DIR-relative (POSIX
 * separators), `pattern` is matched via `String.includes` against the
 * violating line's matched text.
 */
const ALLOWLIST: ReadonlyArray<{ file: string; pattern: string; reason: string }> = [];

function isAllowlisted(file: string, matchedText: string): boolean {
  return ALLOWLIST.some((entry) => entry.file === file && matchedText.includes(entry.pattern));
}

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (EXCLUDED_DIR_SEGMENTS.has(entry)) {
        return [];
      }
      return collectSourceFiles(fullPath);
    }
    const ext = path.extname(entry);
    return FILE_EXTENSIONS.has(ext) ? [fullPath] : [];
  });
}

/** Every `.ts`/`.tsx` file under the scoped roots. */
function collectScopedFiles(): string[] {
  return SCOPED_DIRS.flatMap((dir) => collectSourceFiles(path.join(APP_DIR, dir)));
}

function findViolationsInFile(absPath: string, pattern: RegExp): Violation[] {
  const relPath = path.relative(APP_DIR, absPath).split(path.sep).join("/");
  const lines = readFileSync(absPath, "utf-8").split("\n");
  const violations: Violation[] = [];

  lines.forEach((lineText, index) => {
    const matches = lineText.match(pattern);
    if (!matches) return;
    for (const match of matches) {
      if (isAllowlisted(relPath, match)) continue;
      violations.push({ file: relPath, line: index + 1, match });
    }
  });

  return violations;
}

function findAllViolations(pattern: RegExp): Violation[] {
  return collectScopedFiles().flatMap((file) => findViolationsInFile(file, pattern));
}

function report(violations: readonly Violation[]): string {
  return violations.map((v) => `  ${v.file}:${v.line} -> "${v.match}"`).join("\n");
}

describe("role-hue-ban (SURF-04 — law 1 + law 3 on Phase 60's surfaces)", () => {
  describe("the scope is the contract", () => {
    it("covers every root swept so far — Phase 60's two, and Phase 61's two", () => {
      // Pinned so the scope cannot be silently narrowed to make a future
      // violation pass. Widening (Phases 62-63) is welcome; removing a root
      // must break this test and force the conversation.
      //
      // Phase 60 — the inbox and the email-detail view.
      expect(SCOPED_DIRS).toContain("_components");
      expect(SCOPED_DIRS).toContain("emails/[id]");
      // Phase 61 — the chat surface and its canvas (61-06 cleared `_canvas/`,
      // 61-08 cleared `_components/`), plus the shared tier vocabulary.
      expect(SCOPED_DIRS).toContain("chat");
      expect(SCOPED_DIRS).toContain("_vocabulary");
    });

    it("only ever GROWS — a later phase's append never drops an earlier one", () => {
      // The ratchet stated as an invariant rather than left implicit in the
      // test above. Every root any phase has ever swept must still be in scope:
      // a narrowing is the one edit this file exists to make expensive, and it
      // would otherwise read as a plausible one-word diff in review.
      const SWEPT_SO_FAR = ["_components", "emails/[id]", "chat", "_vocabulary"] as const;
      for (const root of SWEPT_SO_FAR) {
        expect(
          SCOPED_DIRS,
          `a swept root was removed from the ratchet: ${root}. The scope only ever ` +
            `grows — if this root's surface regressed, fix the surface, not the scope.`,
        ).toContain(root);
      }
    });

    it("every scoped root exists and actually yields files — the gate cannot be made vacuous", () => {
      // A rename or a move would otherwise leave the walk policing an empty
      // set, and a gate that inspects nothing passes everything.
      for (const dir of SCOPED_DIRS) {
        const absolute = path.join(APP_DIR, dir);
        expect(existsSync(absolute), `scoped root is missing: ${dir}`).toBe(true);
        expect(
          collectSourceFiles(absolute).length,
          `scoped root walks to zero files: ${dir}`,
        ).toBeGreaterThan(0);
      }
    });

    it("excludes dev/** scratch from the walk", () => {
      expect(Array.from(EXCLUDED_DIR_SEGMENTS)).toContain("dev");
    });
  });

  it("bans role-as-hue: no retired node-type colour utility on any swept surface (law 3)", () => {
    const violations = findAllViolations(ROLE_HUE_PATTERN);

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} role-as-hue violation(s) on a swept surface:\n` +
          `${report(violations)}\n\n` +
          `Law 3: entity type and region role are carried by SHAPE, never by hue — they must ` +
          `survive greyscale. Take role from REGION_ROLE_GEOMETRY/REGION_ROLE_SWATCH and tier ` +
          `from REGION_TIER via tierOf (region-vocabulary.ts); on the canvas, take a node's kind ` +
          `from CANVAS_NODE_KIND_GEOMETRY (canvas-vocabulary.ts). These tokens remain valid on ` +
          `the knowledge surfaces, which Phase 62 has not swept yet — but not here.`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("bans madder on a state: no madder text or border on any swept surface (law 1)", () => {
    const violations = findAllViolations(STATE_MADDER_PATTERN);

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} madder-on-a-state violation(s) on a swept surface:\n` +
          `${report(violations)}\n\n` +
          `Law 1: madder means "irreversible — this cannot be undone". Never errors, never ` +
          `warnings, never statuses. An error is ink on a rule; a warning is ink weight; an ` +
          `uncertain read is pencil. If this IS an irreversible control, build it as a fill ` +
          `(the madder variant and the madder background are allowed, and are how the deny and ` +
          `reject buttons on this surface are already built) rather than allowlisting it.`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
