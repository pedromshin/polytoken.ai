import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "./root";
import { appRouter } from "./root";
import { createCallerFactory, createTRPCContext } from "./trpc";

/**
 * Server-side caller factory for the tRPC API.
 * @example const trpc = createCaller(createTRPCContext({ headers }));
 */
const createCaller = createCallerFactory(appRouter);

/** Inference helper for input types: RouterInputs["emails"]["list"] */
type RouterInputs = inferRouterInputs<AppRouter>;

/** Inference helper for output types: RouterOutputs["emails"]["list"] */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { createTRPCContext, appRouter, createCaller };
export type { AppRouter, RouterInputs, RouterOutputs };

// Geometry utilities — used by the overlay layer in the Review UI
export { polygonToRect } from "./geometry";

// ---------------------------------------------------------------------------
// Read-capability projection surface (Phase 77 — expose-only MCP server).
//
// The `apps/mcp-server` package projects the READ side of the capability
// registry as stdio MCP tools. It needs (a) the exported Zod input schemas of
// the read procedures it exposes, for `zod-to-json-schema` conversion + a
// dispatch-boundary re-parse (MCPX-02/MCPX-07), and (b) the honest manifest
// mirror so its catalogue can pin every exposed id to a `risk:"read"` entry
// and carry the `describe` string verbatim (MCPX-01). These are PURE
// additive re-exports of already-public module members — a byte-level no-op
// for every existing consumer.
// ---------------------------------------------------------------------------
export { searchKnowledgeInputSchema } from "./router/knowledge/search";
export { listInputSchema } from "./router/entities/gallery";
export { omniboxSearchInputSchema } from "./router/search";
export {
  BUILTIN_CAPABILITY_MANIFEST,
  type BuiltinManifestEntry,
} from "./router/capabilities/builtin-manifest";
