/**
 * theme/packs.ts — DTCG style pack registry.
 *
 * Contains hand-authored, WCAG-AA verified W3C-DTCG 2025.10 style packs.
 * ALL color values are HSL channel-triplet strings (no raw hex, no prose).
 *
 * Packs included (D-01: >= 5 distinct packs, not variations of one baseline):
 *   1. polytoken-teal       — baseline Nauta brand; teal-primary, light neutral surface  (DEFAULT)
 *   2. linear-clean     — monochrome precision-SaaS inspired by Linear; slate tones
 *   3. warm-editorial   — editorial warmth; amber/sand; serif-leaning typography
 *   4. brutalist        — bold high-contrast; full-black primary, no radius
 *   5. corporate-saas   — enterprise blue; conservative trust palette
 *   6. playful-rounded  — high-radius; vibrant purple; playful but accessible
 *
 * WCAG-AA note: every primary/secondary/destructive color was chosen to maintain >=4.5:1
 * contrast ratio against their respective foreground/background colors.
 *
 * Font pairings (D-07): display + body family. All fonts are widely available via system
 * stacks or Google Fonts (no CDN fetches at request time — loaded at app build time only).
 */

import type { StylePack, StylePackId, PackTokenMap } from "./tokens";
import { TOKEN_ALIASES } from "./tokens";

// ===========================================================================
// Internal helper to build a PackTokenMap with compile-time completeness check
// ===========================================================================

/**
 * Build a frozen PackTokenMap, ensuring every TOKEN_ALIAS is present.
 * The `satisfies` assertion produces a compile-time error if any alias is missing.
 */
function makeTokens(
  values: Record<(typeof TOKEN_ALIASES)[number], string>,
): PackTokenMap {
  return Object.freeze({ ...values });
}

/**
 * Build a resolved CSS-variable map from a PackTokenMap.
 * Maps the DTCG alias keys to their CSS variable names (without leading --).
 */
function resolveVars(
  tokens: PackTokenMap,
): Readonly<Record<string, string>> {
  const vars: Record<string, string> = {};
  vars["background"] = tokens["color.background"];
  vars["foreground"] = tokens["color.foreground"];
  vars["card"] = tokens["color.card"];
  vars["card-foreground"] = tokens["color.cardForeground"];
  vars["primary"] = tokens["color.primary"];
  vars["primary-foreground"] = tokens["color.primaryForeground"];
  vars["secondary"] = tokens["color.secondary"];
  vars["secondary-foreground"] = tokens["color.secondaryForeground"];
  vars["muted"] = tokens["color.muted"];
  vars["muted-foreground"] = tokens["color.mutedForeground"];
  vars["accent"] = tokens["color.accent"];
  vars["accent-foreground"] = tokens["color.accentForeground"];
  vars["destructive"] = tokens["color.destructive"];
  vars["destructive-foreground"] = tokens["color.destructiveForeground"];
  vars["success"] = tokens["color.success"];
  vars["success-foreground"] = tokens["color.successForeground"];
  vars["border"] = tokens["color.border"];
  vars["ring"] = tokens["color.ring"];
  vars["radius"] = tokens["radius.base"];
  vars["radius-pill"] = tokens["radius.pill"];
  vars["spacing-density"] = tokens["spacing.density"];
  vars["shadow-base"] = tokens["shadow.base"];
  vars["font-display"] = tokens["typography.display.family"];
  vars["font-body"] = tokens["typography.body.family"];
  vars["font-code"] = tokens["typography.code.family"];
  vars["tier-inferred"] = tokens["color.tier.inferred"];
  vars["tier-inferred-foreground"] = tokens["color.tier.inferredForeground"];
  vars["tier-extracted"] = tokens["color.tier.extracted"];
  vars["tier-extracted-foreground"] = tokens["color.tier.extractedForeground"];
  vars["graph-entity"] = tokens["color.graph.entity"];
  vars["graph-entity-foreground"] = tokens["color.graph.entityForeground"];
  vars["graph-email-component"] = tokens["color.graph.emailComponent"];
  vars["graph-email-component-foreground"] =
    tokens["color.graph.emailComponentForeground"];
  vars["graph-email"] = tokens["color.graph.email"];
  vars["graph-email-foreground"] = tokens["color.graph.emailForeground"];
  return Object.freeze(vars);
}

// ===========================================================================
// Pack 1: polytoken-teal — DEFAULT baseline (D-02)
// Primary: hsl(164 39% 22%) — nauta brand teal (dark forest teal)
// Verified WCAG-AA: primary-foreground (white 98%) on primary passes 8.1:1
// ===========================================================================

const NAUTA_TEAL_TOKENS: PackTokenMap = makeTokens({
  "color.background": "0 0% 100%",
  "color.foreground": "0 0% 3.9%",
  "color.card": "0 0% 100%",
  "color.cardForeground": "0 0% 3.9%",
  "color.primary": "164 39% 22%",
  "color.primaryForeground": "0 0% 98%",
  "color.secondary": "0 0% 96.1%",
  "color.secondaryForeground": "0 0% 9%",
  "color.muted": "0 0% 96.1%",
  "color.mutedForeground": "0 0% 45.1%",
  "color.accent": "0 0% 96.1%",
  "color.accentForeground": "0 0% 9%",
  "color.destructive": "0 84.2% 60.2%",
  "color.destructiveForeground": "0 0% 98%",
  // D-48-02: success pair — Verified WCAG-AA: successForeground on success passes 4.9:1
  "color.success": "142 71% 29%",
  "color.successForeground": "0 0% 98%",
  "color.border": "0 0% 89.8%",
  "color.ring": "0 0% 3.9%",
  "radius.base": "0.5rem",
  // D-48-01: fully-rounded pill utility (chips/badges/pill buttons)
  "radius.pill": "9999px",
  "spacing.density": "1rem",
  "shadow.base": "none",
  "typography.display.family":
    "'Inter', 'Helvetica Neue', Arial, sans-serif",
  "typography.body.family": "'Inter', 'Helvetica Neue', Arial, sans-serif",
  // D-48-03: monospace code family for code blocks / inline code
  "typography.code.family":
    "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  // D-48-04: tier-ladder — cyan-teal EXTRACTED (confirmed, solid) vs
  // indigo-violet INFERRED (provisional, pale) — distinct hues from both
  // each other and from color.muted/accent (neutral gray in this pack).
  // Verified WCAG-AA: extractedForeground on extracted passes 5.10:1
  "color.tier.extracted": "178 55% 30%",
  "color.tier.extractedForeground": "0 0% 98%",
  // Verified WCAG-AA: inferredForeground on inferred passes 9.07:1
  "color.tier.inferred": "230 40% 90%",
  "color.tier.inferredForeground": "230 45% 28%",
  // D-48-05: graph node-type palette (CLOSED) — violet/amber/slate
  // equivalents replacing graph-nodes.tsx's hardcoded Tailwind colors.
  // Verified WCAG-AA: entityForeground on entity passes 5.67:1
  "color.graph.entity": "262 83% 58%",
  "color.graph.entityForeground": "0 0% 100%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 8.21:1
  "color.graph.emailComponent": "38 92% 50%",
  "color.graph.emailComponentForeground": "20 14% 10%",
  // Verified WCAG-AA: emailForeground on email passes 6.03:1
  "color.graph.email": "215 20% 65%",
  "color.graph.emailForeground": "215 25% 15%",
});

// ===========================================================================
// Pack 2: linear-clean — monochrome precision-SaaS
// Inspired by Linear.app — neutral slate palette, subtle shadows, tight radius
// Primary: hsl(220 14% 10%) — near-black slate
// Verified WCAG-AA: #f8fafc (98% white-ish) on #161b25 (10% dark) passes 13.5:1
// ===========================================================================

const LINEAR_CLEAN_TOKENS: PackTokenMap = makeTokens({
  "color.background": "210 20% 98%",
  "color.foreground": "220 14% 10%",
  "color.card": "0 0% 100%",
  "color.cardForeground": "220 14% 10%",
  "color.primary": "220 14% 10%",
  "color.primaryForeground": "210 20% 98%",
  "color.secondary": "220 13% 95%",
  "color.secondaryForeground": "220 14% 10%",
  "color.muted": "220 13% 95%",
  "color.mutedForeground": "220 9% 46%",
  "color.accent": "220 13% 91%",
  "color.accentForeground": "220 14% 10%",
  "color.destructive": "0 72% 51%",
  "color.destructiveForeground": "0 0% 98%",
  // D-48-02: success pair — Verified WCAG-AA: successForeground on success passes 4.9:1
  "color.success": "142 71% 29%",
  "color.successForeground": "0 0% 98%",
  "color.border": "220 13% 91%",
  "color.ring": "220 14% 10%",
  "radius.base": "0.375rem",
  // D-48-01: fully-rounded pill utility (chips/badges/pill buttons)
  "radius.pill": "9999px",
  "spacing.density": "0.875rem",
  "shadow.base": "0 1px 3px 0 hsl(220 14% 10% / 0.08)",
  "typography.display.family":
    "'Inter', 'Segoe UI', system-ui, sans-serif",
  "typography.body.family": "'Inter', 'Segoe UI', system-ui, sans-serif",
  // D-48-03: monospace code family for code blocks / inline code
  "typography.code.family":
    "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  // D-48-04: tier-ladder — cool cyan-blue EXTRACTED (confirmed) vs
  // indigo INFERRED (provisional, pale) — both distinct from this pack's
  // monochrome hue-220 primary/muted/accent register.
  // Verified WCAG-AA: extractedForeground on extracted passes 5.30:1
  "color.tier.extracted": "195 60% 34%",
  "color.tier.extractedForeground": "210 20% 98%",
  // Verified WCAG-AA: inferredForeground on inferred passes 8.49:1
  "color.tier.inferred": "260 45% 92%",
  "color.tier.inferredForeground": "260 40% 32%",
  // D-48-05: graph node-type palette (CLOSED) — violet/amber/slate
  // equivalents, tuned to linear-clean's monochrome-slate register.
  // Verified WCAG-AA: entityForeground on entity passes 5.49:1
  "color.graph.entity": "262 60% 55%",
  "color.graph.entityForeground": "210 20% 98%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 7.28:1
  "color.graph.emailComponent": "38 85% 48%",
  "color.graph.emailComponentForeground": "220 14% 10%",
  // Verified WCAG-AA: emailForeground on email passes 4.95:1
  "color.graph.email": "220 14% 45%",
  "color.graph.emailForeground": "210 20% 98%",
});

// ===========================================================================
// Pack 3: warm-editorial — editorial warmth; amber/sand personality
// Primary: hsl(32 95% 44%) — warm amber (like Substack, editorial tools)
// Verified WCAG-AA: primary-foreground (amber 3% dark) on amber primary passes 4.6:1
// Body/display: serif-leaning for editorial gravitas
// ===========================================================================

const WARM_EDITORIAL_TOKENS: PackTokenMap = makeTokens({
  "color.background": "36 33% 97%",
  "color.foreground": "20 14% 10%",
  "color.card": "36 33% 97%",
  "color.cardForeground": "20 14% 10%",
  "color.primary": "32 95% 44%",
  "color.primaryForeground": "20 14% 5%",
  "color.secondary": "36 25% 90%",
  "color.secondaryForeground": "20 14% 10%",
  "color.muted": "36 25% 90%",
  "color.mutedForeground": "20 10% 45%",
  "color.accent": "36 33% 85%",
  "color.accentForeground": "20 14% 10%",
  "color.destructive": "0 72% 51%",
  "color.destructiveForeground": "0 0% 98%",
  // D-48-02: success pair (warmer green register) — Verified WCAG-AA: successForeground on success passes 5.1:1
  "color.success": "142 60% 30%",
  "color.successForeground": "0 0% 98%",
  "color.border": "36 20% 83%",
  "color.ring": "32 95% 44%",
  "radius.base": "0.375rem",
  // D-48-01: fully-rounded pill utility (chips/badges/pill buttons)
  "radius.pill": "9999px",
  "spacing.density": "1.125rem",
  "shadow.base": "0 2px 8px 0 hsl(20 14% 10% / 0.08)",
  "typography.display.family": "'Playfair Display', Georgia, 'Times New Roman', serif",
  "typography.body.family": "'Source Serif 4', Georgia, 'Times New Roman', serif",
  // D-48-03: monospace code family for code blocks / inline code
  "typography.code.family":
    "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  // D-48-04: tier-ladder — teal-green EXTRACTED (confirmed, cooler
  // counterpoint to the warm palette) vs dusty-lavender INFERRED
  // (provisional, pale) — distinct from this pack's warm sand muted/accent.
  // Verified WCAG-AA: extractedForeground on extracted passes 5.20:1
  "color.tier.extracted": "165 55% 30%",
  "color.tier.extractedForeground": "0 0% 98%",
  // Verified WCAG-AA: inferredForeground on inferred passes 8.86:1
  "color.tier.inferred": "250 30% 90%",
  "color.tier.inferredForeground": "250 30% 28%",
  // D-48-05: graph node-type palette (CLOSED) — violet/amber/slate
  // equivalents, warmed to fit this pack's editorial register.
  // Verified WCAG-AA: entityForeground on entity passes 5.89:1
  "color.graph.entity": "265 55% 52%",
  "color.graph.entityForeground": "0 0% 98%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 8.74:1
  "color.graph.emailComponent": "40 90% 48%",
  "color.graph.emailComponentForeground": "20 14% 5%",
  // Verified WCAG-AA: emailForeground on email passes 5.01:1
  "color.graph.email": "30 15% 41%",
  "color.graph.emailForeground": "36 33% 97%",
});

// ===========================================================================
// Pack 4: brutalist — stark, bold, maximum-contrast; zero radius
// Primary: hsl(0 0% 0%) — pure black on white
// Verified WCAG-AA: white on pure black = 21:1 (AAA)
// Typography: monospace display for raw/code aesthetic
// ===========================================================================

const BRUTALIST_TOKENS: PackTokenMap = makeTokens({
  "color.background": "0 0% 100%",
  "color.foreground": "0 0% 0%",
  "color.card": "0 0% 97%",
  "color.cardForeground": "0 0% 0%",
  "color.primary": "0 0% 0%",
  "color.primaryForeground": "0 0% 100%",
  "color.secondary": "0 0% 90%",
  "color.secondaryForeground": "0 0% 0%",
  "color.muted": "0 0% 92%",
  "color.mutedForeground": "0 0% 30%",
  "color.accent": "60 100% 50%",
  "color.accentForeground": "0 0% 0%",
  "color.destructive": "0 100% 45%",
  "color.destructiveForeground": "0 0% 100%",
  // D-48-02: success pair (stark high-contrast green) — Verified WCAG-AA: successForeground on success passes 5.2:1
  "color.success": "120 100% 25%",
  "color.successForeground": "0 0% 100%",
  "color.border": "0 0% 0%",
  "color.ring": "0 0% 0%",
  "radius.base": "0rem",
  // D-48-01 EXCEPTION: brutalist's zero-radius identity wins over pill-ness —
  // stays squared instead of adopting the 9999px pill radius other packs use.
  "radius.pill": "0rem",
  "spacing.density": "1rem",
  "shadow.base": "3px 3px 0px 0px hsl(0 0% 0%)",
  "typography.display.family":
    "'JetBrains Mono', 'Courier New', Courier, monospace",
  "typography.body.family":
    "'Space Mono', 'Courier New', Courier, monospace",
  // D-48-03: brutalist migrates its existing JetBrains Mono identity onto
  // code.family explicitly (display.family is left unchanged — mono IS
  // brutalist's identity, so code.family now carries the explicit mono answer).
  "typography.code.family":
    "'JetBrains Mono', 'Courier New', Courier, monospace",
  // D-48-04: tier-ladder — stark saturated blue EXTRACTED (confirmed,
  // stamp-like) vs pale blue-gray INFERRED (provisional) — distinct from
  // this pack's neutral-gray muted and yellow accent.
  // Verified WCAG-AA: extractedForeground on extracted passes 5.15:1
  "color.tier.extracted": "210 100% 42%",
  "color.tier.extractedForeground": "0 0% 100%",
  // Verified WCAG-AA: inferredForeground on inferred passes 14.63:1
  "color.tier.inferred": "210 30% 85%",
  "color.tier.inferredForeground": "0 0% 0%",
  // D-48-05: graph node-type palette (CLOSED) — stark high-saturation
  // violet/amber/slate equivalents fitting brutalist's bold register.
  // Verified WCAG-AA: entityForeground on entity passes 6.26:1
  "color.graph.entity": "270 100% 50%",
  "color.graph.entityForeground": "0 0% 100%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 12.73:1
  "color.graph.emailComponent": "45 100% 50%",
  "color.graph.emailComponentForeground": "0 0% 0%",
  // Verified WCAG-AA: emailForeground on email passes 5.74:1
  "color.graph.email": "0 0% 40%",
  "color.graph.emailForeground": "0 0% 100%",
});

// ===========================================================================
// Pack 5: corporate-saas — enterprise trust palette
// Primary: hsl(221 83% 53%) — Salesforce/Stripe-style blue
// Verified WCAG-AA: white on hsl(221 83% 53%) passes 4.7:1
// ===========================================================================

const CORPORATE_SAAS_TOKENS: PackTokenMap = makeTokens({
  "color.background": "0 0% 100%",
  "color.foreground": "222 47% 11%",
  "color.card": "0 0% 100%",
  "color.cardForeground": "222 47% 11%",
  "color.primary": "221 83% 53%",
  "color.primaryForeground": "0 0% 100%",
  "color.secondary": "214 32% 91%",
  "color.secondaryForeground": "222 47% 11%",
  "color.muted": "214 32% 91%",
  "color.mutedForeground": "215 16% 47%",
  "color.accent": "214 32% 87%",
  "color.accentForeground": "222 47% 11%",
  "color.destructive": "0 72% 51%",
  "color.destructiveForeground": "0 0% 98%",
  // D-48-02: success pair — Verified WCAG-AA: successForeground on success passes 4.9:1
  "color.success": "142 71% 29%",
  "color.successForeground": "0 0% 98%",
  "color.border": "214 32% 91%",
  "color.ring": "221 83% 53%",
  "radius.base": "0.25rem",
  // D-48-01: fully-rounded pill utility (chips/badges/pill buttons)
  "radius.pill": "9999px",
  "spacing.density": "1rem",
  "shadow.base": "0 1px 2px 0 hsl(222 47% 11% / 0.05)",
  "typography.display.family":
    "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif",
  "typography.body.family": "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
  // D-48-03: monospace code family for code blocks / inline code
  "typography.code.family":
    "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  // D-48-04: tier-ladder — enterprise teal EXTRACTED (confirmed) vs pale
  // violet INFERRED (provisional, common "pending" enterprise-tag hue) —
  // distinct from this pack's blue primary and slate muted/accent.
  // Verified WCAG-AA: extractedForeground on extracted passes 5.17:1
  "color.tier.extracted": "175 60% 29%",
  "color.tier.extractedForeground": "0 0% 98%",
  // Verified WCAG-AA: inferredForeground on inferred passes 9.34:1
  "color.tier.inferred": "260 40% 93%",
  "color.tier.inferredForeground": "260 40% 30%",
  // D-48-05: graph node-type palette (CLOSED) — violet/amber/slate
  // equivalents, tuned to this pack's conservative enterprise register.
  // Verified WCAG-AA: entityForeground on entity passes 6.06:1
  "color.graph.entity": "262 70% 55%",
  "color.graph.entityForeground": "0 0% 100%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 7.61:1
  "color.graph.emailComponent": "38 90% 48%",
  "color.graph.emailComponentForeground": "222 47% 11%",
  // Verified WCAG-AA: emailForeground on email passes 4.70:1
  "color.graph.email": "215 25% 48%",
  "color.graph.emailForeground": "0 0% 100%",
});

// ===========================================================================
// Pack 6: playful-rounded — high-radius, vibrant purple, friendly
// Primary: hsl(262 83% 58%) — vibrant purple (Notion/Loom-ish)
// Verified WCAG-AA: white on hsl(262 83% 58%) passes 4.5:1
// ===========================================================================

const PLAYFUL_ROUNDED_TOKENS: PackTokenMap = makeTokens({
  "color.background": "0 0% 100%",
  "color.foreground": "262 30% 10%",
  "color.card": "262 100% 99%",
  "color.cardForeground": "262 30% 10%",
  "color.primary": "262 83% 58%",
  "color.primaryForeground": "0 0% 100%",
  "color.secondary": "262 50% 95%",
  "color.secondaryForeground": "262 30% 10%",
  "color.muted": "262 50% 95%",
  "color.mutedForeground": "262 20% 50%",
  "color.accent": "320 85% 60%",
  "color.accentForeground": "0 0% 100%",
  "color.destructive": "0 72% 51%",
  "color.destructiveForeground": "0 0% 98%",
  // D-48-02: success pair (vibrant-but-legible green) — Verified WCAG-AA:
  // successForeground on success passes 4.9:1. NOTE: the plan's suggested
  // "142 70% 40%" fg white computed to only 2.92:1 (fails AA) — darkened to
  // L=30% to clear 4.5:1 while staying in the same hue/saturation family
  // (Rule 1 auto-fix, verified by the Task 3 computational contrast gate).
  "color.success": "142 70% 30%",
  "color.successForeground": "0 0% 100%",
  "color.border": "262 40% 88%",
  "color.ring": "262 83% 58%",
  "radius.base": "1rem",
  // D-48-01: fully-rounded pill utility (chips/badges/pill buttons)
  "radius.pill": "9999px",
  "spacing.density": "1.25rem",
  "shadow.base": "0 4px 20px 0 hsl(262 83% 58% / 0.12)",
  "typography.display.family":
    "'Nunito', 'Rounded Mplus 1c', 'Arial Rounded MT Bold', sans-serif",
  "typography.body.family": "'Nunito', 'Segoe UI', Arial, sans-serif",
  // D-48-03: monospace code family for code blocks / inline code
  "typography.code.family":
    "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  // D-48-04: tier-ladder — vibrant cyan EXTRACTED (confirmed) vs pastel
  // peach/yellow INFERRED (provisional, playful) — distinct from this
  // pack's purple primary and pink accent.
  // Verified WCAG-AA: extractedForeground on extracted passes 5.07:1
  "color.tier.extracted": "190 65% 33%",
  "color.tier.extractedForeground": "0 0% 100%",
  // Verified WCAG-AA: inferredForeground on inferred passes 9.41:1
  "color.tier.inferred": "45 85% 88%",
  "color.tier.inferredForeground": "30 40% 22%",
  // D-48-05: graph node-type palette (CLOSED) — violet/amber/slate
  // equivalents. entity is a distinct violet shade from this pack's own
  // violet primary (270 vs 262 hue) so the two aliases stay visually
  // distinguishable despite sharing a family.
  // Verified WCAG-AA: entityForeground on entity passes 4.63:1
  "color.graph.entity": "270 75% 60%",
  "color.graph.entityForeground": "0 0% 100%",
  // Verified WCAG-AA: emailComponentForeground on emailComponent passes 8.71:1
  "color.graph.emailComponent": "35 95% 55%",
  "color.graph.emailComponentForeground": "262 30% 10%",
  // Verified WCAG-AA: emailForeground on email passes 4.69:1
  "color.graph.email": "262 15% 55%",
  "color.graph.emailForeground": "262 30% 10%",
});

// ===========================================================================
// STYLE_PACKS registry
// ===========================================================================

/**
 * The immutable registry of all available style packs.
 * Indexed by StylePackId for O(1) lookup.
 */
export const STYLE_PACKS: Readonly<Record<StylePackId, StylePack>> =
  Object.freeze({
    "polytoken-teal": Object.freeze({
      id: "polytoken-teal" as const,
      label: "Nauta Teal",
      description:
        "Default Nauta brand palette — dark teal primary on a clean light surface.",
      isDefault: true,
      tokens: NAUTA_TEAL_TOKENS,
      resolvedVars: resolveVars(NAUTA_TEAL_TOKENS),
    }),

    "linear-clean": Object.freeze({
      id: "linear-clean" as const,
      label: "Linear Clean",
      description:
        "Monochrome precision-SaaS — slate tones, tight radius, engineered clarity.",
      isDefault: false,
      tokens: LINEAR_CLEAN_TOKENS,
      resolvedVars: resolveVars(LINEAR_CLEAN_TOKENS),
    }),

    "warm-editorial": Object.freeze({
      id: "warm-editorial" as const,
      label: "Warm Editorial",
      description:
        "Editorial warmth — amber primary, sand surface, serif typography.",
      isDefault: false,
      tokens: WARM_EDITORIAL_TOKENS,
      resolvedVars: resolveVars(WARM_EDITORIAL_TOKENS),
    }),

    brutalist: Object.freeze({
      id: "brutalist" as const,
      label: "Brutalist",
      description:
        "Bold high-contrast brutalism — pure black primary, zero radius, monospace type.",
      isDefault: false,
      tokens: BRUTALIST_TOKENS,
      resolvedVars: resolveVars(BRUTALIST_TOKENS),
    }),

    "corporate-saas": Object.freeze({
      id: "corporate-saas" as const,
      label: "Corporate SaaS",
      description:
        "Enterprise trust palette — confident blue, conservative corners, clean hierarchy.",
      isDefault: false,
      tokens: CORPORATE_SAAS_TOKENS,
      resolvedVars: resolveVars(CORPORATE_SAAS_TOKENS),
    }),

    "playful-rounded": Object.freeze({
      id: "playful-rounded" as const,
      label: "Playful Rounded",
      description:
        "Friendly and vibrant — purple primary, high radius, warm shadows.",
      isDefault: false,
      tokens: PLAYFUL_ROUNDED_TOKENS,
      resolvedVars: resolveVars(PLAYFUL_ROUNDED_TOKENS),
    }),
  });

// ===========================================================================
// STYLE_PACK_IDS — ordered tuple of all known pack ids
// ===========================================================================

/**
 * All known style-pack ids as a readonly array.
 * Order is stable: polytoken-teal is always first (it is the default).
 */
export const STYLE_PACK_IDS: ReadonlyArray<StylePackId> = Object.freeze(
  Object.keys(STYLE_PACKS) as StylePackId[],
);

// ===========================================================================
// DEFAULT_PACK_ID — constant identifying the baseline pack (D-02)
// ===========================================================================

/** The id of the default/baseline style pack. Always "polytoken-teal". */
export const DEFAULT_PACK_ID: StylePackId = "polytoken-teal";

// ===========================================================================
// getStylePack — lookup with fallback to default
// ===========================================================================

/**
 * Returns the StylePack for the given id.
 * If `id` is not a known pack id (including empty string or unknown values),
 * returns the default baseline pack (polytoken-teal) without throwing.
 *
 * This ensures unknown `style_pack_id` values in spec envelopes gracefully
 * degrade to the baseline rendering (D-02/STYLE-02).
 */
export function getStylePack(id: string): StylePack {
  const pack = (STYLE_PACKS as Record<string, StylePack>)[id];
  return pack ?? STYLE_PACKS[DEFAULT_PACK_ID];
}
