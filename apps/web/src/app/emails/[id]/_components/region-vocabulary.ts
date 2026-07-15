/**
 * region-vocabulary.ts — the single tier/role vocabulary the whole
 * email-detail surface resolves against (60-04-PLAN.md Task 1).
 *
 * Turns the overlay boxes into the provenance marks they always were:
 * colour states the TIER (§C, T-60-08) and nothing else; ROLE is carried
 * structurally (weight/fill/style/opacity), never by hue (law 3). This
 * generalizes `extraction-summary-panel.tsx`'s `statusTone` precedent one
 * level up, into a module the whole detail surface — not just one panel —
 * resolves against (Plan 05 wires six more panels onto these exports).
 *
 * Threat model (T-60-02, Tampering/XSS): every class returned here is a
 * LOOKUP from a closed map keyed by a narrowed union — never a string built
 * by concatenating anything derived from attacker-influenced component
 * data (`contentText`, `entityTypeLabel`). Consumers must keep it that way.
 */

import { contentSnippet } from "./region-label";

export type RegionTier = "confirmed" | "suggested" | "terminal";

/**
 * tierOf — maps a component's raw `extractionStatus` to the tier truth
 * (§C, consistent with Plan 01's server-side mapping):
 *   "confirmed"               -> confirmed
 *   "candidate" | "pending"   -> suggested
 *   "rejected" | "superseded" -> terminal (no tier claim at all — a ghost)
 *
 * Any UNRECOGNIZED status defaults to "suggested", NEVER "confirmed"
 * (T-60-08, Repudiation): tier is a claim about whether a human confirmed a
 * fact, so a new/unknown status value must never silently inherit a
 * confirmation the user never gave. The product's stance is suggest-only.
 */
export function tierOf(status: string): RegionTier {
  if (status === "confirmed") return "confirmed";
  if (status === "rejected" || status === "superseded") return "terminal";
  return "suggested";
}

interface TierClasses {
  /** Border + fill — the ONLY place tier's colour lives. */
  readonly box: string;
  /**
   * The label-chip colouring — the pmark provenance-mark language. `pmark`
   * sets `font-family: var(--font-serif)`, so this is the EVIDENCE treatment:
   * it belongs on the document's own words (a value, a content snippet) and
   * nowhere else. For chrome that merely NAMES a tier, use `badge`.
   */
  readonly chip: string;
  /**
   * The tier BADGE — direction-final.html's `.badge.c`/`.badge.s` (sketch
   * lines 235-245): a swatch plus the tier word, for stating a tier in
   * chrome. Deliberately NOT `chip`: the words "Confirmed"/"Suggested" are
   * polytoken's own vocabulary, not the document's, so law 2 gives them the
   * sans — and `chip`'s `pmark` would force the serif onto them. The sketch
   * draws the same distinction itself (`.pm` is serif, `.badge` is not).
   * Carries border+fill+text colour; pair with `swatch`.
   */
  readonly badge: string;
  /**
   * The small square inside a `badge` — solid for confirmed, hollow+dashed
   * for suggested, mirroring the same solid-vs-dashed language `box` uses,
   * so the swatch restates the tier in shape as well as hue rather than
   * relying on colour alone (the accessibility half of law 1).
   */
  readonly swatch: string;
  /**
   * Selection/active ring. INK under law 1 ("selected states ... carry NO
   * hue") — identical across every tier by design. Tier owns fill and
   * border; it never owns selection.
   */
  readonly ring: string;
}

const SELECTION_RING = "ring-ink";

export const REGION_TIER: Record<RegionTier, TierClasses> = {
  // Solid mark = confirmed (58-IDENTITY.md's signature-element language).
  confirmed: {
    box: "border-conf-line bg-conf-wash",
    chip: "pmark pmark-confirmed",
    badge: "border border-conf-line bg-conf-wash text-conf",
    swatch: "bg-conf",
    ring: SELECTION_RING,
  },
  // Dashed mark = suggested.
  suggested: {
    box: "border-sugg-line bg-sugg-wash border-dashed",
    chip: "pmark pmark-suggested",
    badge: "border border-dashed border-sugg-line bg-sugg-wash text-sugg",
    swatch: "border border-dashed border-sugg",
    ring: SELECTION_RING,
  },
  // A rejected/superseded region makes NO tier claim, so it earns no
  // colour — a ghost, not a "weakly confirmed" wash of either hue.
  terminal: {
    box: "border-rule border-dashed bg-shade opacity-40",
    chip: "pmark text-pencil",
    badge: "border border-rule bg-shade text-pencil",
    swatch: "bg-pencil opacity-40",
    ring: SELECTION_RING,
  },
};

export type RegionRole = "entity" | "field" | "unrelated" | "none";

/**
 * REGION_ROLE_GEOMETRY — role carries STRUCTURE and NOTHING else: border
 * weight, style, and opacity. Choosing weight/style for role while tier
 * owns colour and solid-vs-dashed keeps the two axes orthogonal: a box
 * says "entity, suggested" as "thick and amber-dashed", and neither
 * reading interferes with the other.
 *
 * Tier already owns solid-vs-dashed, so no value here may use
 * `border-dashed` — that is why "unrelated" is DOTTED, not dashed.
 *
 * "field" additionally carries `opacity-80` beyond a bare `border`:
 * without it, "field" and "none" would both resolve to the literal string
 * "border" — structurally INDISTINGUISHABLE at a fixed tier, exactly the
 * kind of role-collapsing-into-indistinguishability regression this
 * plan's own gate (region-overlay-law.test.tsx, "ROLE IS LEGIBLE") exists
 * to catch. The opacity nuance keeps "field" honestly subordinate while
 * "none" (truly unclassified) stays the plain, unmodified 1px border.
 */
export const REGION_ROLE_GEOMETRY: Record<RegionRole, string> = {
  entity: "border-2",
  field: "border opacity-80",
  unrelated: "border border-dotted opacity-60",
  none: "border",
};

/**
 * REGION_ROLE_LABEL — polytoken's word for each role, in ONE place.
 *
 * `role-picker.tsx` and `inspector-panel.tsx` each carried their own copy of
 * this map, which is the same one-mapping-not-two hazard T-60-08 names for
 * tier: two maps of the same fact drift, and the drift shows up as the
 * picker and the inspector disagreeing about what the user just clicked.
 * These are polytoken's words, not the document's, so law 2 gives them the
 * sans — a consumer must never put these behind `chip`/`pmark`.
 *
 * "none" reads "Unclassified" — the picker cannot select it (it clears the
 * role instead), but the inspector can be shown a region that has no role.
 */
export const REGION_ROLE_LABEL: Record<RegionRole, string> = {
  entity: "Entity",
  field: "Field",
  unrelated: "Unrelated",
  none: "Unclassified",
};

/**
 * REGION_ROLE_SWATCH — a MINIATURE of the real box treatment the user will
 * see on the document, for chrome that must show a role rather than name it.
 *
 * This is law 3 applied to chrome. Pre-60 the role picker painted an
 * arbitrary hue per role and the inspector painted a matching chip, so the
 * surface taught a colour key that (a) died in greyscale and (b) existed
 * nowhere on the actual document. Rendering the geometry instead means the
 * picker teaches the document's own vocabulary: the swatch beside "Entity"
 * IS the border weight an entity box wears on the page.
 *
 * The base is deliberately `border-ink` — chrome ink, never a tier hue. A
 * swatch in the picker is answering "which role?", and it has no tier to
 * claim; tier colour appears only on a box that has a real extraction status
 * behind it. Composed here from `REGION_ROLE_GEOMETRY` at module load so the
 * geometry can never drift from the boxes it advertises, and consumed as a
 * plain lookup keyed by the `RegionRole` union (T-60-02).
 */
const ROLE_SWATCH_BASE = "inline-block h-3 w-3 shrink-0 rounded-[2px] border-ink";

export const REGION_ROLE_SWATCH: Record<RegionRole, string> = {
  entity: `${ROLE_SWATCH_BASE} ${REGION_ROLE_GEOMETRY.entity}`,
  field: `${ROLE_SWATCH_BASE} ${REGION_ROLE_GEOMETRY.field}`,
  unrelated: `${ROLE_SWATCH_BASE} ${REGION_ROLE_GEOMETRY.unrelated}`,
  none: `${ROLE_SWATCH_BASE} ${REGION_ROLE_GEOMETRY.none}`,
};

export type RegionLabel =
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "status"; readonly text: string };

interface LabelSource {
  readonly entityTypeLabel: string | null;
  readonly contentText: string | null;
  readonly extractionStatus: string;
}

/**
 * regionLabelFor — B1's exact fallback precedence (entityTypeLabel ->
 * content snippet -> status), now discriminated by PROVENANCE instead of
 * collapsed into one string. Law 2 hinges on this discrimination:
 *   "type"   — polytoken's own word for a category. Chrome, so sans.
 *   "text"   — the document's own words. Evidence, so serif.
 *   "status" — no extraction happened yet. Chrome, so sans.
 * The pre-60-04 `labelText = entityTypeLabel ?? contentSnippet(...) ??
 * extractionStatus` shape collapsed three very different provenances into
 * one string and therefore could not obey law 2 — this discrimination is
 * the fix, not a behavior change (precedence order is preserved exactly).
 */
export function regionLabelFor(component: LabelSource): RegionLabel {
  if (component.entityTypeLabel !== null) {
    return { kind: "type", text: component.entityTypeLabel };
  }
  const snippet = contentSnippet(component.contentText);
  if (snippet !== null) {
    return { kind: "text", text: snippet };
  }
  return { kind: "status", text: component.extractionStatus };
}
