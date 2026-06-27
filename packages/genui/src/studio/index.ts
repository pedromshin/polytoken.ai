/**
 * studio/index.ts — public surface for the @nauta/genui/studio subpath export.
 *
 * Only pure, framework-free helpers are exported from this barrel.
 * No React, Next.js, or server-only imports are permitted here.
 */

export type {
  GenerationSignals,
  GenerationState,
  InProgressState,
  FallbackState,
  CacheHitState,
  ColdState,
} from "./derive-generation-state";

export { deriveGenerationState } from "./derive-generation-state";

export type { PropDescriptor } from "./describe-props-schema";

export { describePropsSchema } from "./describe-props-schema";
