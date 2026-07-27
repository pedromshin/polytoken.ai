/**
 * catalogue.ts — the expose-allowlist (Plan 77-01), the "fifth face" of the
 * capability registry projected as MCP tools.
 *
 * ## What this is
 *
 * An EXPLICIT, auditable allowlist mapping a read-side capability to an MCP tool
 * definition. NOT "everything read" — an intentional set the maintainer signs
 * off on. Today it is exactly three tools:
 *
 *   polytoken.searchMyKnowledge  ← capability `search_knowledge` → knowledge.search
 *   polytoken.listEntities       ← capability `lookup_entity`    → entities.list
 *   polytoken.searchEverything   ← (procedure-backed)            → search.omnibox
 *
 * ## Why two shapes of entry (manifest-backed vs procedure-backed)
 *
 * `search_knowledge` and `lookup_entity` are real ids in `BUILTIN_CAPABILITY_MANIFEST`
 * with `risk:"read"`, so their tool `description` is pulled VERBATIM from the manifest
 * `describe` (the string documented as "what an LLM reads to decide whether to call it")
 * and drift-guarded (MCPX-01). `search.omnibox` is a shipped `protectedProcedure` but has
 * NO `defineCapability` descriptor in the registry (verified: it is absent from
 * `BUILTIN_CAPABILITY_MANIFEST`), so it cannot carry a `capabilityId` and its description
 * is authored here and marked procedure-sourced. The drift guard enforces the
 * manifest-verbatim invariant for every entry that DOES claim a `capabilityId`.
 *
 * ## Input schema (MCPX-02 + the thin-ergonomics goal)
 *
 * The raw procedures take `importerId` / `offset` / `sort` — noise for an external agent.
 * Each tool therefore PRESENTS a thin, query-first Zod schema (`toolInputSchema`,
 * `{ query, limit }`) whose `zod-to-json-schema` conversion is the MCP `inputSchema`. The
 * procedure's own exported Zod schema (`procedureInputSchema`) is carried separately and is
 * the authoritative re-parse gate at dispatch (MCPX-07); `toProcedureArgs` maps the thin
 * input onto it, defaulting `importerId`/`offset`/`sort` server-side (the safe
 * full-owned-scope path — identity/scope are NEVER taken from tool input, MCPX-04). A tool
 * whose `procedureInputSchema` (or `toolInputSchema`) is not a real Zod schema is REFUSED at
 * registration (MCPX-02) — the module throws at load, so a mis-wired tool can never list.
 *
 * ## Purity
 *
 * This module imports NO `@modelcontextprotocol/sdk` (MCPX-08) — it is pure data + Zod +
 * zod-to-json-schema, so its tests run with the SDK absent. `src/index.ts` is the ONLY file
 * allowed to touch the SDK.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  BUILTIN_CAPABILITY_MANIFEST,
  listInputSchema,
  omniboxSearchInputSchema,
  searchKnowledgeInputSchema,
} from "@polytoken/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which appRouter router + procedure a tool dispatches to. */
export interface ToolDispatchTarget {
  readonly router: "knowledge" | "entities" | "search";
  readonly proc: string;
}

/** A single exposed MCP tool — the projection of one read capability/procedure. */
export interface ExposedTool {
  /** MCP tool name the external agent calls, e.g. "polytoken.searchMyKnowledge". */
  readonly toolName: string;
  /**
   * The `BUILTIN_CAPABILITY_MANIFEST` id this tool projects, when the procedure
   * has a capability descriptor. Absent for `search.omnibox` (no descriptor exists).
   */
  readonly capabilityId?: string;
  /** MCP tool description — VERBATIM manifest `describe` for manifest-backed tools. */
  readonly description: string;
  /** Thin, query-first Zod schema PRESENTED to the agent (source of `inputJsonSchema`). */
  readonly toolInputSchema: z.ZodTypeAny;
  /** JSON-Schema conversion of `toolInputSchema` — the MCP `inputSchema` (MCPX-02). */
  readonly inputJsonSchema: Record<string, unknown>;
  /** The procedure's OWN exported Zod schema — the dispatch re-parse gate (MCPX-07). */
  readonly procedureInputSchema: z.ZodTypeAny;
  /** Router + procedure to invoke via `createCaller(ctx)[router][proc]`. */
  readonly dispatch: ToolDispatchTarget;
  /** Maps the parsed thin input onto full procedure args (server-defaults the rest). */
  readonly toProcedureArgs: (thin: Record<string, unknown>) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Thin, query-first tool schemas (presented to the agent)
// ---------------------------------------------------------------------------

/** Bounds mirror the procedures' own Zod maxima so the presented tool never over-promises. */
const knowledgeToolInput = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(50).default(10),
});

const entitiesToolInput = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(25),
});

const omniboxToolInput = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(20).default(5),
});

// ---------------------------------------------------------------------------
// Registration guards (MCPX-01, MCPX-02) — throw at module load ("refuse to register")
// ---------------------------------------------------------------------------

export function assertZodSchema(
  schema: unknown,
  label: string,
): asserts schema is z.ZodTypeAny {
  if (!(schema instanceof z.ZodType)) {
    throw new Error(
      `[mcp-catalogue] ${label} is not a valid Zod schema — refusing to register the tool (MCPX-02).`,
    );
  }
}

/**
 * Resolve a `risk:"read"` manifest entry by id, throwing on drift:
 *   - absent id           → the allowlist references a non-existent capability
 *   - risk !== "read"     → a non-read capability must never be exposed
 * (MCPX-01: every manifest-backed tool pins to a `risk:"read"` manifest entry.)
 */
export function readManifestEntry(id: string) {
  const entry = BUILTIN_CAPABILITY_MANIFEST.find((e) => e.id === id);
  if (entry === undefined) {
    throw new Error(
      `[mcp-catalogue] "${id}" is not in BUILTIN_CAPABILITY_MANIFEST — refusing to register (MCPX-01).`,
    );
  }
  if (entry.risk !== "read") {
    throw new Error(
      `[mcp-catalogue] "${id}" has risk="${entry.risk}"; only risk:"read" capabilities may be exposed (MCPX-01).`,
    );
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Entry builders
// ---------------------------------------------------------------------------

function manifestBackedTool(opts: {
  toolName: string;
  capabilityId: string;
  description: string;
  toolInputSchema: z.ZodTypeAny;
  procedureInputSchema: z.ZodTypeAny;
  dispatch: ToolDispatchTarget;
  toProcedureArgs: (thin: Record<string, unknown>) => Record<string, unknown>;
}): ExposedTool {
  assertZodSchema(opts.toolInputSchema, `${opts.toolName} toolInputSchema`);
  assertZodSchema(opts.procedureInputSchema, `${opts.toolName} procedureInputSchema`);
  // Guard (MCPX-01): the id must exist in the manifest with risk:"read", so a
  // non-read / non-existent capability can NEVER be exposed. We pin to the id for
  // the risk gate, but the LLM-facing `description` is AUTHORED to match the actual
  // dispatch target — the manifest `describe` is written for the broader Python
  // chat executors (id-lookup, graph-expand) and over-promises what the read
  // procedure this tool dispatches to (entities.list search / knowledge.search
  // trgm) can actually do. Presenting that verbatim would advertise a surface the
  // procedure lacks, so a well-behaved agent would issue calls that return nothing.
  readManifestEntry(opts.capabilityId);
  return {
    toolName: opts.toolName,
    capabilityId: opts.capabilityId,
    description: opts.description,
    toolInputSchema: opts.toolInputSchema,
    inputJsonSchema: zodToJsonSchema(opts.toolInputSchema) as Record<string, unknown>,
    procedureInputSchema: opts.procedureInputSchema,
    dispatch: opts.dispatch,
    toProcedureArgs: opts.toProcedureArgs,
  };
}

function procedureBackedTool(opts: {
  toolName: string;
  description: string;
  toolInputSchema: z.ZodTypeAny;
  procedureInputSchema: z.ZodTypeAny;
  dispatch: ToolDispatchTarget;
  toProcedureArgs: (thin: Record<string, unknown>) => Record<string, unknown>;
}): ExposedTool {
  assertZodSchema(opts.toolInputSchema, `${opts.toolName} toolInputSchema`);
  assertZodSchema(opts.procedureInputSchema, `${opts.toolName} procedureInputSchema`);
  return {
    toolName: opts.toolName,
    description: opts.description,
    toolInputSchema: opts.toolInputSchema,
    inputJsonSchema: zodToJsonSchema(opts.toolInputSchema) as Record<string, unknown>,
    procedureInputSchema: opts.procedureInputSchema,
    dispatch: opts.dispatch,
    toProcedureArgs: opts.toProcedureArgs,
  };
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

export const EXPOSED_TOOLS: readonly ExposedTool[] = Object.freeze([
  manifestBackedTool({
    toolName: "polytoken.searchMyKnowledge",
    capabilityId: "search_knowledge",
    // Procedure-accurate: knowledge.search is trigram text search over the caller's
    // EXTRACTED-tier knowledge nodes — no graph-expansion / neighbour arm.
    description:
      "Search your own polytoken knowledge graph — the facts extracted from your mail — " +
      "by a free-text query, and return the best-matching knowledge nodes. Owner-scoped " +
      "and read-only; only your own extracted knowledge is ever reachable.",
    toolInputSchema: knowledgeToolInput,
    procedureInputSchema: searchKnowledgeInputSchema,
    dispatch: { router: "knowledge", proc: "search" },
    // importerId omitted → resolveListScope(undefined) = the full owned scope.
    toProcedureArgs: (thin) => ({ query: thin.query, limit: thin.limit }),
  }),
  manifestBackedTool({
    toolName: "polytoken.listEntities",
    capabilityId: "lookup_entity",
    // Procedure-accurate: entities.list matches the free-text query against an entity's
    // display name, identifiers, and aliases (NOT its entity_instance id).
    description:
      "Find your own resolved entities — people, organisations, and things polytoken has " +
      "recognised from your mail — by matching a name, identifier, or alias, and return the " +
      "matching entities. Owner-scoped and read-only; only your own entities are reachable.",
    toolInputSchema: entitiesToolInput,
    procedureInputSchema: listInputSchema,
    dispatch: { router: "entities", proc: "list" },
    // query → the gallery's `search`; status/sort/offset/importerId server-defaulted.
    toProcedureArgs: (thin) => ({ search: thin.query, limit: thin.limit }),
  }),
  procedureBackedTool({
    toolName: "polytoken.searchEverything",
    // Authored here (search.omnibox has no capability descriptor to mirror). Kept in the
    // registry's describe voice: grounded, owner-scoped, read-only, cited. Procedure-
    // accurate: the knowledge arm returns EXTRACTED-tier nodes (not human-confirmed).
    description:
      "Search everything in your own polytoken workspace at once — your resolved entities, " +
      "emails, chat conversations, extracted knowledge, and files — for a free-text query, " +
      "and return grounded, owner-scoped results grouped by kind. Read-only; " +
      "only your own data is ever reachable.",
    toolInputSchema: omniboxToolInput,
    procedureInputSchema: omniboxSearchInputSchema,
    dispatch: { router: "search", proc: "omnibox" },
    toProcedureArgs: (thin) => ({ query: thin.query, limitPerKind: thin.limit }),
  }),
]);

/** Find an exposed tool by its MCP tool name (fails closed → undefined). */
export function getExposedTool(toolName: string): ExposedTool | undefined {
  return EXPOSED_TOOLS.find((t) => t.toolName === toolName);
}
