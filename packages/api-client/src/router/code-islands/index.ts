/**
 * code-islands/index.ts — codeIslandsRouter (Phase 76 / BTAP-03/04/09/10).
 *
 * The owner-scoped read/write control plane for the `code_islands` table — the
 * persistence half of "bespoke disposable apps per task". It serves:
 *
 *   1. the canvas `code-island` node — `byId` returns one owned island's
 *      { intent, code, inputBindings } so the node can host the jailed
 *      <CodeIslandFrame> over its wired inputs (node.data carries only an
 *      `islandId` ref, ref-only discipline). The node reads byId; it NEVER
 *      re-calls the non-deterministic generator on mount.
 *   2. the "Build a tool from these" flow — `create` persists the winning
 *      generated code + its targetKey→{sourceNodeKey,sourcePath} bindings.
 *   3. disposability (BTAP-10) — `remove` deletes the row; dropping the canvas
 *      node itself only removes the placement (deleteElements), the row survives
 *      unless explicitly removed here.
 *
 * ## Tenancy (INV-8/INV-9, TENA-03, BTAP-09)
 * Every procedure is `protectedProcedure`; the acting identity is ALWAYS
 * `ctx.user.id`, never a client field. `create` stamps the owner server-side.
 * `byId`/`remove` assert ownership at the TOP via `assertCodeIslandOwnership`
 * (through `assertOwnedOrNotFound`) — missing-or-not-yours both surface as
 * NOT_FOUND (fail-closed, no existence oracle). `list` filters directly on
 * `ctx.user.id`. `remove`'s DELETE also scopes on user_id (defense in depth).
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { CodeIslands } from "@polytoken/db/schema";
import { assertCodeIslandOwnership } from "@polytoken/db/ownership";

import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { tableColumnExists } from "../_column-detect";

// ---------------------------------------------------------------------------
// Bounds — an island program + its bindings must stay sane (the code is bounded
// by the generator, but this is the persistence boundary's own belt).
// ---------------------------------------------------------------------------
const MAX_CODE_LEN = 200_000;
const MAX_BINDINGS = 32;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** One typed-input binding: which source node's published path feeds this
 * island's `window.__ISLAND_DATA__.{targetKey}`. Pointers only — never data. */
const bindingSchema = z
  .object({
    sourceNodeKey: z.string().min(1).max(200),
    sourcePath: z.string().min(1).max(200),
  })
  .strict();

/** targetKey → binding. Capped count + prototype-pollution-guarded keys (the
 * targetKey becomes a property name inside the injected data global). */
const inputBindingsSchema = z
  .record(z.string().min(1).max(120), bindingSchema)
  .refine((obj) => Object.keys(obj).length <= MAX_BINDINGS, {
    message: `at most ${MAX_BINDINGS} input bindings`,
  })
  .refine((obj) => Object.keys(obj).every((k) => !FORBIDDEN_KEYS.has(k)), {
    message: "binding key must not be __proto__/constructor/prototype",
  });

export const codeIslandsRouter = createTRPCRouter({
  /**
   * list — the caller's saved islands, newest first (the tools-gallery source).
   * Scoped directly to `ctx.user.id`. Omits the heavy `code` body so the list
   * never streams program text.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: CodeIslands.id,
        intent: CodeIslands.intent,
        createdAt: CodeIslands.createdAt,
        updatedAt: CodeIslands.updatedAt,
      })
      .from(CodeIslands)
      .where(eq(CodeIslands.userId, ctx.user.id))
      .orderBy(desc(CodeIslands.updatedAt))
      .limit(100);
  }),

  /**
   * byId — a single island with its full code + bindings (what the canvas
   * `code-island` node hosts). Ownership asserted BEFORE the read; NOT_FOUND on
   * missing-or-not-yours (fail-closed).
   */
  byId: protectedProcedure
    .input(z.object({ islandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertCodeIslandOwnership(ctx.db, input.islandId, ctx.user.id),
      );
      const rows = await ctx.db
        .select({
          id: CodeIslands.id,
          intent: CodeIslands.intent,
          code: CodeIslands.code,
          inputBindings: CodeIslands.inputBindings,
          createdAt: CodeIslands.createdAt,
          updatedAt: CodeIslands.updatedAt,
        })
        .from(CodeIslands)
        .where(eq(CodeIslands.id, input.islandId))
        .limit(1);
      // Ownership already asserted existence; defensive narrowing, not an oracle.
      return rows[0] ?? null;
    }),

  /**
   * create — persist a generated island. Owner stamped server-side; the code +
   * bindings are the source of truth for THIS island (never regenerated on
   * reload). Returns the new island id so the flow can materialize the node.
   */
  create: protectedProcedure
    .input(
      z.object({
        intent: z.string().min(1).max(4096),
        code: z.string().min(1).max(MAX_CODE_LEN),
        inputBindings: inputBindingsSchema.default({}),
        // Optional idempotency key for AGENT-authored islands (Phase 76-05): the
        // `{messageId}:{partIndex}` provenance of the canvas_code_island part.
        // When present, an insert with the same (owner, provenance) UPSERTS the
        // existing row instead of minting a new one — so a remount / delete+reload
        // re-run of the same part cannot orphan a fresh code_islands row (the
        // islandId is otherwise network-minted and non-deterministic). Omitted for
        // user-summoned islands, which stay distinct (NULL provenance never conflicts).
        provenance: z.string().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Migration-order guard (the 0036 pattern): the `provenance` column +
      // its (user_id, provenance) unique index arrive in migration 0059. Until
      // that migration lands in an environment, the column is absent — so gate
      // the upsert on feature-detection. When the column exists we upsert (agent
      // path idempotency); when it doesn't we fall back to a plain insert with
      // no provenance, so this deploy is safe in ANY migration order and a
      // pre-0059 prod never hits a raw UndefinedColumn (42703) 500.
      const hasProvenance = await tableColumnExists(
        ctx.db,
        "code_islands",
        "provenance",
      );

      const inserted = hasProvenance
        ? await ctx.db
            .insert(CodeIslands)
            .values({
              userId: ctx.user.id,
              intent: input.intent,
              code: input.code,
              inputBindings: input.inputBindings,
              provenance: input.provenance ?? null,
            })
            // Upsert on (user_id, provenance): a NULL provenance never conflicts
            // (user-summon path is a plain insert), a set provenance returns the
            // SAME island id and refreshes its code/bindings (agent-path idempotency).
            .onConflictDoUpdate({
              target: [CodeIslands.userId, CodeIslands.provenance],
              set: {
                intent: input.intent,
                code: input.code,
                inputBindings: input.inputBindings,
                updatedAt: sql`now()`,
              },
            })
            .returning({ id: CodeIslands.id })
        : await ctx.db
            .insert(CodeIslands)
            .values({
              userId: ctx.user.id,
              intent: input.intent,
              code: input.code,
              inputBindings: input.inputBindings,
            })
            .returning({ id: CodeIslands.id });
      const id = inserted[0]?.id;
      if (id === undefined) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "code_island insert returned no id",
        });
      }
      return { islandId: id, created: true };
    }),

  /**
   * remove — disposability (BTAP-10). Ownership asserted first; the DELETE also
   * scopes on user_id (defense in depth). Idempotent: removing an
   * already-gone/never-yours row surfaces NOT_FOUND via the ownership assert.
   */
  remove: protectedProcedure
    .input(z.object({ islandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertCodeIslandOwnership(ctx.db, input.islandId, ctx.user.id),
      );
      const deleted = await ctx.db
        .delete(CodeIslands)
        .where(
          and(eq(CodeIslands.id, input.islandId), eq(CodeIslands.userId, ctx.user.id)),
        )
        .returning({ id: CodeIslands.id });
      return { islandId: input.islandId, removed: deleted.length > 0 };
    }),
});
