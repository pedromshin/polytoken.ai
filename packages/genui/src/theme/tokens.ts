/**
 * theme/tokens.ts — W3C-DTCG 2025.10 token contract layer.
 *
 * Defines:
 *   - TOKEN_ALIASES: the closed, exhaustive set of alias names every style pack must define.
 *     These are DTCG-style dotted aliases mirroring the CSS variable surface in globals.css.
 *     The fourth TOKEN allowlist (D-06/STYLE-03) is derived from this set.
 *   - StylePackId: string-literal union of all known pack ids.
 *   - DtcgTokenValue: a leaf token node ({$value, $type}) in the W3C DTCG 2025.10 shape.
 *   - PackTokenMap: a flat map from alias -> value string (the renderer-facing shape).
 *   - StylePack: a frozen pack record — metadata + flat token map.
 *
 * Color values throughout are HSL channel-triplet strings (e.g. "164 39% 22%"),
 * consumed as `hsl(var(--alias))` by @nauta/ui — exactly the globals.css shape.
 * Raw hex values are FORBIDDEN by design (D-03/STYLE-03).
 *
 * No React imports — this is pure data + types for consumption by both TS (renderer)
 * and Python (pack registry, eval injection) layers.
 */

// ===========================================================================
// TOKEN_ALIASES — the exhaustive alias set every pack must define (D-06)
//
// Naming convention: group.subgroup e.g. "color.primary", "radius.base"
// These mirror the CSS variables in apps/web/src/app/globals.css :root block.
// The Zod TOKEN allowlist (schema/token-props-schema.ts) is derived from this tuple.
// ===========================================================================

/**
 * The closed set of semantic token aliases that constitute the TOKEN allowlist (D-06).
 *
 * Every pack in STYLE_PACKS must define a value for every alias in this tuple.
 * The schema/token-props-schema.ts Zod schema derives its z.enum from this constant.
 *
 * Groups:
 *   color.*         — HSL channel-triplet strings (H S% L%), consumed as hsl(var(--*))
 *   radius.*        — CSS length values (e.g. "0.5rem", "0rem", "1rem")
 *   spacing.*       — CSS length values for density (e.g. "1rem", "1.5rem")
 *   shadow.*        — CSS box-shadow values (e.g. "none", "0 1px 3px ...")
 *   typography.display.family — font-family string for display/heading text
 *   typography.body.family    — font-family string for body text
 */
export const TOKEN_ALIASES = [
  // Color surface tokens — core UI palette (mirrors globals.css :root)
  "color.background",
  "color.foreground",
  "color.card",
  "color.cardForeground",
  "color.primary",
  "color.primaryForeground",
  "color.secondary",
  "color.secondaryForeground",
  "color.muted",
  "color.mutedForeground",
  "color.accent",
  "color.accentForeground",
  "color.destructive",
  "color.destructiveForeground",
  "color.border",
  "color.ring",
  // Structural tokens
  "radius.base",
  "spacing.density",
  "shadow.base",
  // Typography tokens (D-07 — font family pairings per pack)
  "typography.display.family",
  "typography.body.family",
] as const;

/** Union of all token alias literal strings. */
export type TokenAlias = (typeof TOKEN_ALIASES)[number];

// ===========================================================================
// StylePackId — union of all known pack ids (stable lowercase-kebab slugs)
// ===========================================================================

/**
 * All known style-pack identifiers.
 * Adding a new pack requires:
 *   1. Adding its id here
 *   2. Adding its StylePack entry to STYLE_PACKS in packs.ts
 */
export type StylePackId =
  | "nauta-teal"
  | "linear-clean"
  | "warm-editorial"
  | "brutalist"
  | "corporate-saas"
  | "playful-rounded";

// ===========================================================================
// PackTokenMap — flat map from alias -> resolved string value
// ===========================================================================

/**
 * A flat map of token alias -> resolved string value.
 * Color values are HSL channel-triplets ("H S% L%").
 * Radius values are CSS lengths ("0.5rem").
 * Shadow values are CSS box-shadow values ("none", "0 1px ...").
 * Typography values are CSS font-family strings.
 */
export type PackTokenMap = Readonly<Record<TokenAlias, string>>;

// ===========================================================================
// StylePack — the full pack record
// ===========================================================================

/**
 * A W3C-DTCG 2025.10-shaped style pack.
 *
 * Fields:
 *   id          — unique stable lowercase-kebab slug (matches StylePackId)
 *   label       — human-readable display name (for the studio dropdown)
 *   description — short brand-personality description (for Auto/Surprise mode)
 *   isDefault   — true for the nauta-teal baseline pack (D-02)
 *   tokens      — flat map of alias -> resolved value (the renderer projection)
 *   resolvedVars — CSS variable name -> resolved value (for CSS injection by renderer)
 */
export type StylePack = {
  readonly id: StylePackId;
  readonly label: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly tokens: PackTokenMap;
  readonly resolvedVars: Readonly<Record<string, string>>;
};

// ===========================================================================
// CSS variable name mapping
// Maps each TOKEN_ALIAS to its corresponding CSS variable name in globals.css
// ===========================================================================

/**
 * Maps a token alias to its CSS variable name (without leading --).
 * This allows the renderer to inject the active pack's values as CSS overrides.
 */
export const TOKEN_ALIAS_TO_CSS_VAR: Readonly<Record<TokenAlias, string>> =
  Object.freeze({
    "color.background": "background",
    "color.foreground": "foreground",
    "color.card": "card",
    "color.cardForeground": "card-foreground",
    "color.primary": "primary",
    "color.primaryForeground": "primary-foreground",
    "color.secondary": "secondary",
    "color.secondaryForeground": "secondary-foreground",
    "color.muted": "muted",
    "color.mutedForeground": "muted-foreground",
    "color.accent": "accent",
    "color.accentForeground": "accent-foreground",
    "color.destructive": "destructive",
    "color.destructiveForeground": "destructive-foreground",
    "color.border": "border",
    "color.ring": "ring",
    "radius.base": "radius",
    "spacing.density": "spacing-density",
    "shadow.base": "shadow-base",
    "typography.display.family": "font-display",
    "typography.body.family": "font-body",
  } satisfies Record<TokenAlias, string>);
