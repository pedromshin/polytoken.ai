/**
 * theme/index.ts — public barrel for the @nauta/genui/theme sub-path export.
 *
 * Re-exports:
 *   - tokens.ts: TOKEN_ALIASES, TOKEN_ALIAS_TO_CSS_VAR, types (StylePack, StylePackId, etc.)
 *   - packs.ts:  STYLE_PACKS, STYLE_PACK_IDS, DEFAULT_PACK_ID, getStylePack
 */

export {
  TOKEN_ALIASES,
  TOKEN_ALIAS_TO_CSS_VAR,
} from "./tokens";

export type {
  TokenAlias,
  StylePackId,
  PackTokenMap,
  StylePack,
} from "./tokens";

export {
  STYLE_PACKS,
  STYLE_PACK_IDS,
  DEFAULT_PACK_ID,
  getStylePack,
} from "./packs";
