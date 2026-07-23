/**
 * canvas-vocabulary.ts — the tier/kind vocabulary the whole chat canvas
 * resolves against (61-02-PLAN.md Task 2).
 *
 * GROWN from `emails/[id]/_components/region-vocabulary.ts`, not improvised
 * beside it. It applies that module's rule — the single most reusable decision
 * Phase 60 made — to the surface it was explicitly written to serve next
 * (brand-guide.md §3: "Phases 61-63 need it for canvas nodes and edges"):
 *
 *   > Tier owns colour and solid-vs-dashed. Role owns weight, style, and
 *   > opacity — never hue. The two axes are orthogonal.
 *
 * On the canvas, "role" is a node's KIND. Before this module the canvas
 * answered the same questions with five improvised local class maps and a
 * retired node-type hue family whose three tokens had collapsed to within 4.4%
 * lightness of each other — a colour key that had stopped distinguishing
 * anything while still teaching the user that colour meant type. That is how
 * the debt accumulated in the first place, and it is what this file exists to
 * stop happening a fourth time.
 *
 * The tier TRUTH is NOT here — it lives in `app/_vocabulary/tier.ts`, shared
 * with `/emails/[id]` and (Phase 62) `/knowledge`. This module holds the
 * canvas's own LITERAL classes, and `__tests__/canvas-vocabulary.test.ts`
 * asserts they AGREE with that shared truth. The literals must stay literal:
 * Tailwind v4 scans source for literal class strings, so a class composed from
 * a shared token name is silently purged at build time with no error. See
 * `_vocabulary/tier.ts`'s header for the full reasoning.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THREAT MODEL (T-61-04, Tampering/XSS)
 * ────────────────────────────────────────────────────────────────────────
 *
 * `node.type` and `edge.data` come from `chat_canvas_layouts`, a user-writable
 * row. Every class below is a LOOKUP from a closed map keyed by a narrowed
 * union — never a string built by concatenating anything derived from that
 * data. This is `region-vocabulary.ts`'s T-60-02 obligation restated for the
 * canvas, and consumers (61-04/61-05) inherit it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WIRING HAZARD FOR 61-04: STOCK REACT FLOW CSS WILL FIGHT THESE CLASSES
 * ────────────────────────────────────────────────────────────────────────
 *
 * `chat-canvas.tsx` still imports `@xyflow/react/dist/style.css`, whose
 * `.react-flow__edge-path` rule sets its own stroke at single-class
 * specificity. That is why today's `DataEdge` needs `!stroke-primary` rather
 * than `stroke-primary` to render at all. The `!` is deliberately NOT baked in
 * below: it is a property of the CONSUMER's specificity context, not of the
 * design, and it would be wrong on a non-React-Flow consumer such as a legend
 * swatch. 61-04 owns "zero stock React Flow default styling remaining" — if it
 * drops the stock import the plain classes win; if it keeps it, the consumer
 * must force them. Wire an edge and LOOK at it; a lost specificity fight here
 * renders a stock grey wire through a green suite.
 */

import { type Tier } from "../../_vocabulary/tier";

/**
 * The tier an edge states.
 *
 * `neutral` is NOT a `Tier` — it is the ABSENCE of a tier claim, which is why
 * this union is not simply `Tier`. A structural wire is plumbing, not
 * provenance, and law 1 says colour is earned.
 */
export type CanvasEdgeTier = "neutral" | "confirmed" | "suggested";

interface EdgeClasses {
  /** The `<path>`/`<line>` itself — the ONLY place an edge's tier colour lives. */
  readonly path: string;
  /** The endpoint dot (the sketch's `.e-joint`), matching its path's colour. */
  readonly joint: string;
}

/**
 * CANVAS_EDGE_TIER — the sketch's `.e-neutral` / `.e-conf` / `.e-sugg`
 * (direction-final.html lines 459-462), realized as literal classes.
 *
 * ON THE YAGNI CHARGE, because someone will raise it: only `neutral` has a
 * consumer in Phase 61. `confirmed`/`suggested` are built now because
 *   (a) the LOCKED sketch declares all three;
 *   (b) `/knowledge` ALREADY renders tier-encoded edges today, and Phase 62
 *       moves them onto this map;
 *   (c) Phase 63's provenance edges need them.
 * Building them now is "grow the vocabulary". The alternative is a fourth
 * local map next term — the exact debt this rule exists to prevent.
 *
 * THE ONE COLLISION, respected as `region-vocabulary.ts` respects it with
 * `unrelated`: tier owns solid-vs-dashed, so NO other axis on this surface may
 * use dashed to mean anything. A node kind that wants a broken rule takes
 * DOTTED (see `CANVAS_NODE_KIND_GEOMETRY`).
 *
 * `--edge` is declared in both themes but is deliberately NOT registered in
 * `@theme`, so no `stroke-edge` utility exists and this plan must not depend
 * on one (61-04 decides whether to register it). The arbitrary-property form
 * is a LITERAL string, so Tailwind's scanner sees it and emits the rule
 * regardless of registration — which is exactly what makes it safe here.
 */
export const CANVAS_EDGE_TIER: Record<CanvasEdgeTier, EdgeClasses> = {
  // The structural wire. A DataEdge wires sourcePath -> targetKey; that is
  // plumbing, and plumbing states no tier, so it earns no hue.
  neutral: {
    path: "[stroke:var(--edge)] [stroke-width:1.5] fill-none",
    joint: "[fill:var(--edge)]",
  },
  // Solid mark = confirmed (58-IDENTITY.md's signature-element language).
  confirmed: {
    path: "stroke-conf-line [stroke-width:1.5] fill-none",
    joint: "fill-conf-line",
  },
  // Dashed mark = suggested. The email-detail surface spells this same fact as
  // `border-dashed` on a CSS box; an edge is an SVG path, so it spells it as a
  // dasharray. The FACT travels between the surfaces; the class never could.
  suggested: {
    path: "stroke-sugg-line [stroke-width:1.5] [stroke-dasharray:4_4] fill-none",
    joint: "fill-sugg-line",
  },
};

/**
 * The tier facts again — as CSS VALUES this time, for a consumer that CANNOT
 * use a class. Added by 61-06, after measuring why the class map alone could
 * not reach the screen.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHY A SECOND PROJECTION EXISTS, and why it is not "two maps of one fact"
 * ────────────────────────────────────────────────────────────────────────
 *
 * The header above tells 61-04 that today's `DataEdge` needs `!stroke-primary`
 * "rather than `stroke-primary` to render at all", and attributes it to
 * SPECIFICITY. **That diagnosis is wrong, and 61-05 measured the real one.**
 * `@xyflow/react/dist/style.css` is imported from a client component, so Next
 * emits it UNLAYERED — and an unlayered normal declaration beats ANY declaration
 * inside a Tailwind cascade layer, before specificity is ever consulted. The
 * shipped rule is:
 *
 *   .react-flow__edge-path {                       <- UNLAYERED
 *     stroke:       var(--xy-edge-stroke,       var(--xy-edge-stroke-default));
 *     stroke-width: var(--xy-edge-stroke-width, var(--xy-edge-stroke-width-default));
 *     fill: none;
 *   }
 *
 * So `CANVAS_EDGE_TIER.neutral.path` applied to a React Flow edge is a DEAD
 * class string: `[stroke:var(--edge)]` loses to the stock rule — which, since
 * 61-05 set `--xy-edge-stroke: var(--edge)`, happens to resolve to the SAME
 * colour, so the deadness is invisible — while `[stroke-width:1.5]` loses to a
 * stock default of `1` and is simply wrong on screen. A class that agrees by
 * accident is exactly the failure 61-05 found in the controls-svg `fill` rule,
 * which passed a green gate for two milestones without ever applying.
 *
 * The header's instruction — "the consumer must force them" — is also not
 * mechanically available: Tailwind v4 scans source for LITERAL class strings, so
 * a `!` composed at runtime (`` `!${tier.path}` ``) emits nothing at all.
 *
 * So the FACT travels and the CLASS cannot — which is precisely the concession
 * `CANVAS_EDGE_TIER.suggested` already documents in the other direction
 * ("the email-detail surface spells this same fact as `border-dashed` on a CSS
 * box; an edge is an SVG path, so it spells it as a dasharray"). This map is
 * that same fact in a third spelling, for a third kind of consumer.
 *
 * `__tests__/canvas-node-law.test.tsx` asserts the two projections AGREE —
 * same token, same width, same dashedness — so they cannot drift apart.
 * Extend both or neither.
 */
export interface EdgeStyle {
  /** A CSS colour value — always a `var(--token)`, never a literal. */
  readonly stroke: string;
  readonly strokeWidth: number;
  /** Present only where tier claims a dash; tier owns solid-vs-dashed. */
  readonly strokeDasharray?: string;
}

export const CANVAS_EDGE_TIER_STYLE: Record<CanvasEdgeTier, EdgeStyle> = {
  neutral: { stroke: "var(--edge)", strokeWidth: 1.5 },
  confirmed: { stroke: "var(--conf-line)", strokeWidth: 1.5 },
  suggested: { stroke: "var(--sugg-line)", strokeWidth: 1.5, strokeDasharray: "4 4" },
};

/**
 * A canvas node's kind. Mirrors `NODE_TYPE_REGISTRY`'s registered types
 * ONE-FOR-ONE plus the `unknown` marker `resolveNodeType` already returns for
 * an unregistered/legacy type (CANVAS-03, T-23-05: the canvas "never breaks").
 * `canvas-vocabulary.test.ts` asserts the two stay in lockstep — register a
 * node type without growing this vocabulary and that gate goes red rather than
 * the new node silently rendering a degraded placeholder frame forever.
 */
export type CanvasNodeKind =
  | "chat"
  | "genui-panel"
  | "email-thread"
  | "knowledge-preview"
  | "document"
  | "source"
  | "directory"
  | "browser"
  | "editor"
  | "desktop"
  | "circle-pack"
  | "spreadsheet"
  | "file"
  | "unknown";

/**
 * The closed lookup backing `canvasNodeKindOf`. `node.type` is an untrusted
 * string from a persisted row, so this is a null-prototype map: a plain object
 * literal would answer `canvasNodeKindOf("__proto__")` and
 * `canvasNodeKindOf("toString")` with an inherited value rather than a miss
 * (T-61-06).
 */
const NODE_KIND_BY_TYPE: Readonly<Record<string, CanvasNodeKind>> = Object.freeze(
  Object.assign(Object.create(null), {
    chat: "chat",
    "genui-panel": "genui-panel",
    "email-thread": "email-thread",
    "knowledge-preview": "knowledge-preview",
    document: "document",
    source: "source",
    directory: "directory",
    browser: "browser",
    editor: "editor",
    desktop: "desktop",
    "circle-pack": "circle-pack",
    spreadsheet: "spreadsheet",
    file: "file",
  }) as Record<string, CanvasNodeKind>,
);

/**
 * canvasNodeKindOf — resolves a persisted `node.type` to its kind. NEVER
 * throws and never falls through to another kind's geometry: an unrecognized
 * type resolves to `"unknown"` by lookup MISS (T-61-06), the same
 * degrade-gracefully posture `resolveNodeType` already takes.
 */
export function canvasNodeKindOf(type: string): CanvasNodeKind {
  return NODE_KIND_BY_TYPE[type] ?? "unknown";
}

/**
 * CANVAS_NODE_KIND_GEOMETRY — kind carries STRUCTURE and nothing else (law 3:
 * "Entity type is shape, never hue ... This is what makes law 1 possible").
 *
 * Post-59 the chat node's `border-l-primary` stripe already resolved to ink,
 * so the job here was never a colour removal — it is NAMING the geometry axis,
 * so a future edit cannot reach for a hue to separate two node kinds. Routing
 * the stripe through `primary` is the indirection that let a hue live there
 * for three milestones; below it is ink, said out loud.
 *
 * Composed against the sketch's `.card` (a single flat `--bright` card, a
 * `--rule` border, `--r-card` radius, ZERO shadow anywhere — the base belongs
 * to the shell in 61-05, not here). Kinds differentiate by RULE and WEIGHT,
 * never by fill.
 *
 * THE AXIS, stated so it can be extended rather than guessed at:
 *
 *   LEFT-RULE WEIGHT = how much of the user's OWN material this node carries.
 *     chat (4)          the conversation itself — the anchor the canvas is about
 *     email-thread (2)  mail the user received — real evidence, in full
 *     document (2)      a stored document — polytoken's SYNTHESIS of the user's
 *                       real material, provenance-marked back to it (rule 2, the
 *                       same evidence-carrying weight as a thread)
 *     genui-panel (1)   polytoken's rendering — it has no words of its own
 *     source (1)        a web source the agent pulled in (RCNV-02) — its words
 *                       are real (they earn the serif) but they are NOT the
 *                       user's own material yet; curation into the canon is
 *                       what would raise its standing, and that promotion is
 *                       recorded by TIER (the pmark flips dashed->solid), never
 *                       by kind — kind is shape, and this card stays a source
 *
 *   DOUBLE RULE = "a bound artifact, a synthesis composed into a standalone
 *   piece" — the one kind that is neither raw evidence nor a mere view:
 *     document           a report bound from the user's material; the DOUBLE
 *                        rule sets it apart from the raw thread at the same
 *                        weight, without spending a hue (law 3)
 *
 *   DOTTED FRAME = "this is a VIEW or a guess, not an artifact in its own right".
 *     knowledge-preview  real material (rule 2) but a bounded, non-interactive
 *                        glance at another surface — a view of the thing
 *     source             a GUESS with words of its own (rule 1): the system's
 *                        zero-ceremony bet that this source matters to the
 *                        research — a candidate, not an artifact, until the
 *                        user curates it (taste-references §3: "arrival is
 *                        free, promotion is deliberate")
 *     unknown            claims nothing at all: no rule, provisional frame
 *
 *   RIGHT SEAM RULE (2px ink, the v2.0 panels' one new structural bit) =
 *   "a LIVE surface — the far edge of this card is the user's own machine,
 *   reached through the daemon; its contents can change under you". The three
 *   panel kinds each restate an EXISTING kind's left-rule/frame claim and add
 *   this one bit, which is exactly what separates a live daemon-backed
 *   counterpart from its static sibling (and what keeps every kind's geometry
 *   DISTINCT without spending a hue, law 3):
 *     directory          email-thread's claim (rule 2, solid: the user's own
 *                        material, raw and in full) + live — the node IS the
 *                        watched folder, fed by `fs.list`
 *     browser            source's claim (rule 1, dotted: no words of its own,
 *                        a view not an artifact) + live — a viewport streaming
 *                        daemon screenshots
 *     editor             document's claim (rule 2, double: a bound artifact)
 *                        + live — the artifact still being AUTHORED, written
 *                        back through `fs.write`
 *     desktop            a WHOLE cloud machine the user owns, streamed live
 *                        (Cloud Desktop epoch, RFC §4). It has NO words of its
 *                        own — a streamed screen is pixels, a VIEW not an
 *                        artifact — so it takes DOTTED, exactly as the browser
 *                        panel does. But it is weightier than a browser tab's
 *                        single view: it is the user's own whole computer
 *                        ("replaces my computer", RFC §1), substantial like the
 *                        watched folder / knowledge preview, so it takes the
 *                        rule-2 left weight rather than browser's rule-1. The
 *                        one bit that separates it from `knowledge-preview`
 *                        (also rule-2 dotted) is the right seam: a desktop is a
 *                        LIVE control-plane-backed surface, a preview is a
 *                        static glance. rule-2 DOTTED + right seam is therefore
 *                        distinct from every sibling (browser is rule-1;
 *                        knowledge-preview has no seam; directory/editor are not
 *                        dotted) without spending a hue (law 3).
 *
 * DOTTED/DOUBLE, never DASHED: tier owns solid-vs-dashed on every surface, and
 * `region-vocabulary.ts` makes the identical concession with `unrelated`.
 */
export const CANVAS_NODE_KIND_GEOMETRY: Record<CanvasNodeKind, string> = {
  chat: "border-l-4 border-l-ink",
  "email-thread": "border-l-2 border-l-ink",
  document: "border-l-2 border-l-ink border-double",
  "genui-panel": "border-l border-l-ink",
  "knowledge-preview": "border-l-2 border-l-ink border-dotted",
  source: "border-l border-l-ink border-dotted",
  directory: "border-l-2 border-l-ink border-r-2 border-r-ink",
  browser: "border-l border-l-ink border-r-2 border-r-ink border-dotted",
  editor: "border-l-2 border-l-ink border-r-2 border-r-ink border-double",
  desktop: "border-l-2 border-l-ink border-r-2 border-r-ink border-dotted",
  // A VIEW, not an artifact (dotted, like knowledge-preview) — a bounded glance
  // at a whole surface (the mailbox/entity landscape). The TOP seam distinguishes
  // it from every sibling: no other kind rules its top edge, so rule-2 dotted +
  // a top rule is unique without spending a hue (law 3). Real material (rule 2:
  // the user's own mail, aggregated) but a derived overview, never a bound piece.
  "circle-pack": "border-l-2 border-l-ink border-t-2 border-t-ink border-dotted",
  // CV-03 spreadsheet: the user's own STRUCTURED material composed into a bound
  // artifact — a whole dataset, heavier than a single document (rule-4, chat's
  // weight) AND a bound artifact (the DOUBLE rule, document's mark). rule-4 +
  // double is distinct from chat (rule-4, no double) and document (rule-2,
  // double) without spending a hue (law 3); it is a static grid, not a live
  // daemon-backed surface, so it takes no right seam.
  spreadsheet: "border-l-4 border-l-ink border-double",
  // DR-03 file: a vault file at rest — the user's OWN material, raw (rule-2 left
  // weight, email-thread's evidence weight) resting on a SHELF (a BOTTOM rule).
  // SOLID, never dotted: a stored file is a real artifact, not a guess (source)
  // or a bounded view (knowledge-preview). No other kind rules its bottom edge,
  // so rule-2 left + a bottom rule is distinct from every sibling — and it is
  // NOT a live daemon surface (no right seam) and NOT a bound synthesis (no
  // double) — without spending a hue (law 3).
  file: "border-l-2 border-l-ink border-b-2 border-b-ink",
  unknown: "border-dotted",
};

/**
 * CANVAS_NODE_KIND_LABEL — polytoken's word for each kind, in ONE place,
 * mirroring `REGION_ROLE_LABEL`'s rationale: two maps of one fact drift, and
 * the drift reads to the user as two panels disagreeing.
 *
 * THESE ARE POLYTOKEN'S WORDS, NOT THE DOCUMENT'S, SO LAW 2 GIVES THEM THE
 * SANS. A consumer must NEVER put them behind `chip`/`pmark`: `pmark` sets
 * `font-family: var(--font-serif)`, and no className-reading gate can see the
 * resulting law-2 violation because the serif arrives by INHERITANCE, not by a
 * class anyone can grep (brand-guide §3; 60-05's finding, re-confirmed by
 * 60-06). Use `badge`/`swatch` for chrome that names a thing; `chip`/`pmark`
 * is for the document's own words only.
 *
 * "unknown" reads "Unrecognized" — the honest word for a node whose type this
 * session's registry does not know, mirroring `REGION_ROLE_LABEL`'s
 * "Unclassified".
 */
export const CANVAS_NODE_KIND_LABEL: Record<CanvasNodeKind, string> = {
  chat: "Chat",
  "genui-panel": "Panel",
  "email-thread": "Email thread",
  "knowledge-preview": "Knowledge",
  document: "Document",
  source: "Source",
  directory: "Folder",
  browser: "Browser",
  editor: "Editor",
  desktop: "Desktop",
  "circle-pack": "Landscape",
  spreadsheet: "Table",
  file: "File",
  unknown: "Unrecognized",
};

/**
 * Re-exported so a consumer resolving an edge's tier reads the SHARED truth
 * rather than reaching for `emails/[id]/_components`. Kept as a type-only
 * re-export: this module owns classes, never the truth behind them.
 */
export type { Tier };
