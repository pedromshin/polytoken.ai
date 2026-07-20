/**
 * capability-vocabulary.ts — the panel's ONE place where manifest metadata becomes visual fact.
 *
 * ## The colour ruling (law 1, D-58-01)
 *
 * Risk is the ONE place on this surface where tier colour is semantic — the slice's explicit
 * grant, and an honest one: risk is exactly the axis the identity's three earned hues were
 * built to state.
 *
 *   read  → verdigris (`--conf`)  — looks things up, changes nothing: the safe tier.
 *   write → pencil-amber (`--sugg`) — alters data inside its grant: the caution tier.
 *   exec  → madder (`--bad`)      — starts programs: effects can be impossible to undo.
 *                                    `--bad`'s reserved scope IS the irreversible class —
 *                                    this is a semantic statement of that class, not an
 *                                    error/warning skin (the banned use).
 *
 * The hue appears ONCE per tier — the group-header swatch dot. Rows, badges, and every other
 * element stay ink: trust is stated by border geometry (solid = accountable first-party/
 * verified, dashed = claimed/unvetted — the same solid/dashed provenance grammar as `pmark`,
 * NOT a second mark language), and an off row is stated by opacity, never hue.
 */
import type { RouterOutputs } from "@polytoken/api-client";

export type ManifestEntry = RouterOutputs["capabilities"]["manifest"][number];
export type RiskTier = ManifestEntry["risk"];

/** Highest consequence first: the grants worth reading land above the fold. */
export const RISK_ORDER: readonly RiskTier[] = ["exec", "write", "read"];

export const RISK_TIER: Record<
  RiskTier,
  { readonly label: string; readonly meaning: string; readonly swatch: string }
> = {
  exec: {
    label: "Runs programs",
    meaning: "Can start executables on your machine — effects may be impossible to undo.",
    swatch: "bg-bad",
  },
  write: {
    label: "Changes data",
    meaning: "Can create or overwrite files and records inside what you've granted.",
    swatch: "bg-sugg",
  },
  read: {
    label: "Reads only",
    meaning: "Looks things up. Changes nothing.",
    swatch: "bg-conf",
  },
};

/** Trust in border geometry: solid = accountable, dashed = not yet. Ink only (law 1). */
export const TRUST_BADGE: Record<
  ManifestEntry["trust"],
  { readonly label: string; readonly borderStyle: "border-solid" | "border-dashed" }
> = {
  "first-party": { label: "first-party", borderStyle: "border-solid" },
  verified: { label: "verified", borderStyle: "border-solid" },
  claimed: { label: "claimed", borderStyle: "border-dashed" },
  unvetted: { label: "unvetted", borderStyle: "border-dashed" },
};

/** Where the capability executes — plain words, no glyph inventory needed at n=2. */
export const ORIGIN_LABEL: Record<ManifestEntry["origin"], string> = {
  daemon: "on your machine",
  chat: "in chat",
};

/**
 * Cost stays quiet until it isn't: free/cheap say nothing (declaring "cheap" on every row is
 * decoration), moderate/expensive are stated in words — ink weight, never hue.
 */
export const COST_LABEL: Record<ManifestEntry["cost"], string | null> = {
  free: null,
  cheap: null,
  moderate: "moderate cost",
  expensive: "expensive",
};
