import { desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { Emails } from "@polytoken/db/schema";
import { assertEmailOwnership, userOwnedImporterIds } from "@polytoken/db/ownership";

import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";
import { emailDetailProcedures } from "./detail";
import { emailEntitySummaryProcedures } from "./entity-summary";
import { componentMutationProcedures } from "./mutations";

/**
 * The reading-preview snippet length — the inbox list projects bodyText
 * truncated to this many chars server-side (matches the client slice) so a large
 * body is never streamed to the inbox.
 */
const INBOX_SNIPPET_CHARS = 2000;

/**
 * resolveListScope — decides which importer ids `emails.list` is allowed to
 * query, given the caller's server-verified owned set and an optional
 * client-supplied `importerId` filter (TENA-03 / T-44-05-01).
 *
 * - No requested importerId: scope to the caller's FULL owned set.
 * - Requested importerId is IN the owned set: narrow to just that one id (an
 *   explicit filter the caller asked for, validated against ownership first).
 * - Requested importerId is NOT in the owned set (or the caller owns
 *   nothing): `{ ok: false }` — the caller must get an empty result, never a
 *   query built from an unverified id.
 *
 * Exported for DB-free unit testing (same idiom as `shapeGalleryItem` /
 * `aggregateEntitySummary` elsewhere in this router).
 */
export function resolveListScope(
  owned: ReadonlyArray<string>,
  requestedImporterId: string | undefined,
):
  | { readonly ok: true; readonly importerIds: ReadonlyArray<string> }
  | { readonly ok: false } {
  if (owned.length === 0) {
    return { ok: false };
  }
  if (requestedImporterId === undefined) {
    return { ok: true, importerIds: owned };
  }
  if (!owned.includes(requestedImporterId)) {
    return { ok: false };
  }
  return { ok: true, importerIds: [requestedImporterId] };
}

/**
 * emailsRouter — access to the append-only `emails` table.
 *
 * Every procedure requires a session (protectedProcedure, TENA-03): reads
 * scope to the caller's owned importers via `userOwnedImporterIds` /
 * `assertEmailOwnership` (@polytoken/db/ownership) — never to a
 * client-supplied importer/email id directly.
 */
export const emailsRouter = createTRPCRouter({
  ...emailDetailProcedures,
  ...emailEntitySummaryProcedures,
  ...componentMutationProcedures,
  /**
   * List emails, newest first, scoped to the caller's owned importers.
   * Optional `importerId` filter (validated against ownership, never trusted
   * on its own) and limit/offset pagination. Returns rows plus a `hasMore`
   * hint for cursor-less paging.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          importerId: z.string().uuid().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const owned = await userOwnedImporterIds(ctx.db, ctx.user.id);
      const scope = resolveListScope(owned, input.importerId);

      if (!scope.ok) {
        return {
          items: [],
          hasMore: false,
          nextOffset: input.offset,
        };
      }

      // Explicit column projection — the inbox list never renders bodyHtml or
      // the raw storage key, so they are NOT fetched (a single email body can be
      // large). bodyText is truncated server-side to the snippet length the
      // reading preview shows (2000 chars) rather than streaming the full body.
      const rows = await ctx.db
        .select({
          id: Emails.id,
          subject: Emails.subject,
          senderName: Emails.senderName,
          senderAddress: Emails.senderAddress,
          toAddresses: Emails.toAddresses,
          receivedAt: Emails.receivedAt,
          importerId: Emails.importerId,
          bodyText: sql<
            string | null
          >`left(${Emails.bodyText}, ${INBOX_SNIPPET_CHARS})`,
        })
        .from(Emails)
        .where(inArray(Emails.importerId, scope.importerIds))
        .orderBy(desc(Emails.receivedAt))
        .limit(input.limit + 1)
        .offset(input.offset);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;

      return {
        items,
        hasMore,
        nextOffset: input.offset + items.length,
      };
    }),

  /**
   * Fetch a single email by id. Throws NOT_FOUND when the email is missing
   * or owned by another user (fail-closed, no existence oracle — T-44-05-02).
   */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertEmailOwnership(ctx.db, input.id, ctx.user.id),
      );

      const rows = await ctx.db
        .select()
        .from(Emails)
        .where(eq(Emails.id, input.id))
        .limit(1);

      return rows[0] ?? null;
    }),
});
