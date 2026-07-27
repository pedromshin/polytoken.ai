/**
 * documents/index.ts — documentsRouter (Phase 70 — DOCS-02, read path).
 *
 * Documents are first-class objects: stored, listed, re-openable, regenerable
 * from spec (DOCS-03). This router is the owner-scoped READ path the web
 * documents surfaces consume (documents/page.tsx list + documents/[id]/page.tsx
 * detail/reopen).
 *
 * Tenancy (INV-8/INV-9, TENA-03): every procedure is `protectedProcedure` — the
 * acting identity is ALWAYS `ctx.user.id`, never a client-supplied field. Reads
 * scope through the central `@polytoken/db/ownership` helper:
 *   - `list` filters directly on `ctx.user.id` (documents carries a DIRECT
 *     user_id anchor — no importer join; the same direct-user_id scoping
 *     forwardingRouter.getOrCreateMyAddress uses). This is NOT an inline
 *     cross-table user_id join — it is the ownership anchor itself.
 *   - `byId` calls `assertDocumentOwnership` at the TOP of the resolver BEFORE
 *     any read; a missing document and one owned by another user both surface
 *     as NOT_FOUND (fail-closed, no existence oracle).
 *
 * The `spec` column is the structured `ReportDocument` (jsonb) the print route +
 * PDF handler typeset from (DOCS-03 / INV-7). Its concrete shape is owned by
 * apps/web (`documents/_lib/report-document.ts`); this package stays free of any
 * apps/web import, so `spec` crosses the boundary as `unknown` and the web
 * detail page narrows it. The list projection deliberately OMITS `spec` so a
 * large document body is never streamed into the list response.
 */

import { randomUUID } from "node:crypto";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { Documents } from "@polytoken/db/schema";
import { assertCanAccess } from "@polytoken/db/access-control";

import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { assertAccessOrNotFound } from "../_ownership";

/**
 * A LOCAL zod mirror of apps/web's ReportBlock grammar
 * (`documents/_lib/report-document.ts`), kept here so `create` can accept REAL
 * initial blocks (the "save this chat response as a document" path, DOCS-01)
 * WITHOUT this package importing apps/web (see the file header — spec crosses the
 * boundary as jsonb). It is intentionally structural, not the source of truth:
 * the write-time validator is `reportDocumentSpecSchema` in apps/web, which this
 * must stay shape-compatible with. Kept minimal (no `.strict()`) so a future
 * additive field on a block does not reject an otherwise valid stored spec.
 */
const inlineSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    tier: z.enum(["confirmed", "suggested"]),
    source: z.string().optional(),
  }),
]);

const reportBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("heading"),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string(),
  }),
  z.object({ kind: z.literal("paragraph"), runs: z.array(inlineSchema) }),
  z.object({
    kind: z.literal("evidence"),
    runs: z.array(inlineSchema),
    cite: z.string().optional(),
  }),
  z.object({
    kind: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(z.array(inlineSchema)),
  }),
]);

export const documentsRouter = createTRPCRouter({
  /**
   * list — the caller's documents, newest first. Scoped directly to
   * `ctx.user.id` (the ownership anchor); `spec` is omitted from the projection
   * so the list never streams document bodies. limit/offset paging with a
   * `hasMore` hint (mirrors emailsRouter.list).
   */
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 50, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: Documents.id,
          title: Documents.title,
          sourceLedgerId: Documents.sourceLedgerId,
          createdAt: Documents.createdAt,
        })
        .from(Documents)
        .where(eq(Documents.userId, ctx.user.id))
        .orderBy(desc(Documents.createdAt))
        // Fetch one extra row to compute hasMore without a COUNT.
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
   * byId — a single document with its full `spec` (the regenerate-from-spec
   * input the print route / PDF handler consume). Access is asserted BEFORE the
   * read; NOT_FOUND on no-access-or-missing (fail-closed).
   *
   * W5 (multiuser): this is the representative resource wired through the
   * sharing-aware `assertCanAccess` (view) rather than the owner-only
   * `assertDocumentOwnership`. The OWNER path inside assertCanAccess is
   * byte-for-byte the old owner check — so owner reads (and the not-yours →
   * NOT_FOUND case) are unchanged — but a document SHARED with the caller (or a
   * workspace they belong to) at view/edit is now also readable. Sharing widens;
   * it never narrows the owner's access.
   */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAccessOrNotFound(() =>
        assertCanAccess(ctx.db, ctx.user.id, "document", input.id, "view"),
      );

      const rows = await ctx.db
        .select({
          id: Documents.id,
          title: Documents.title,
          spec: Documents.spec,
          sourceLedgerId: Documents.sourceLedgerId,
          createdAt: Documents.createdAt,
        })
        .from(Documents)
        .where(eq(Documents.id, input.id))
        .limit(1);

      // Ownership already asserted the row exists and is ours; this is a
      // defensive narrowing, not an existence oracle.
      const row = rows[0];
      if (!row) return null;
      return row;
    }),

  /**
   * create — a document owned by the caller. Two callers, one procedure:
   *   - the canvas "Add node ▸ Document" / document-from-scratch path, which
   *     passes no blocks and gets a BLANK document ("Untitled document",
   *     `blocks: []`); and
   *   - the chat "Save as document" affordance (DOCS-01), which passes REAL
   *     `blocks` (a message or a deep-research report converted to the report
   *     grammar), producing a stored document the existing typeset-PDF export
   *     applies to immediately.
   *
   * Mirrors spreadsheets.create: the owner is stamped server-side from
   * `ctx.user.id` (never a client field, INV-8/9), the insert is a plain
   * owner-scoped write (no `document.*` capability exists — the read router is
   * likewise plain Drizzle), and it returns just the new id (the `document`
   * canvas node rehydrates title/date via `byId`, ref-only).
   *
   * The `spec` column has no default, so the document must supply a minimal
   * `ReportDocument` envelope. Its RICH block grammar is owned by apps/web
   * (`documents/_lib/report-document.ts`) and crosses this boundary as jsonb —
   * this package stays free of any apps/web import (see file header), so
   * `blocks`/`subtitle`/`source` are validated against the LOCAL structural
   * mirror above. `spec.id === row.id` keeps the stored id and the typeset id in
   * lockstep, and `blocks: []` renders as a clean empty reading view
   * (document-detail's `isReportDocumentSpec` guard only requires `blocks` to be
   * an array).
   *
   * ADDITIVE / byte-identical when no blocks: with `blocks`, `subtitle` and
   * `source` all omitted, the constructed `spec` is `{ id, title, generatedAt,
   * blocks: [] }` — the SAME object, in the same key order, the blank-create path
   * has always written. The new fields only enter the spec when supplied.
   */
  create: protectedProcedure
    .input(
      z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          subtitle: z.string().trim().min(1).max(300).optional(),
          source: z.string().trim().min(1).max(300).optional(),
          /** REAL initial blocks (DOCS-01). Omitted ⇒ blank document. */
          blocks: z.array(reportBlockSchema).optional(),
        })
        .default({}),
    )
    .mutation(async ({ ctx, input }) => {
      const id = randomUUID();
      const title = input.title ?? "Untitled document";
      const spec = {
        id,
        title,
        generatedAt: new Date().toISOString(),
        // Spread BEFORE blocks so the blank path's key order (…, blocks) is
        // preserved byte-for-byte when subtitle/source are absent.
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(input.source !== undefined ? { source: input.source } : {}),
        blocks: input.blocks ?? [],
      };

      const rows = await ctx.db
        .insert(Documents)
        .values({ id, userId: ctx.user.id, title, spec })
        .returning({ id: Documents.id });

      return { documentId: rows[0]?.id ?? id, created: true as const };
    }),
});
