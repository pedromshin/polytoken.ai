/**
 * emails.detail tRPC procedure.
 *
 * Returns the full EmailView shape required by the Phase 5 review UI (05-UI-SPEC §9.1):
 *   { email, attachments, components }
 *
 * Tenancy (Phase 44, TENA-03): protectedProcedure requires a session; the
 * target email's ownership is asserted via `assertEmailOwnership`
 * (@polytoken/db/ownership) BEFORE any read — a missing email and one owned
 * by another user both surface as NOT_FOUND (fail-closed, no existence
 * oracle).
 *
 * T-05-01: input id validated as UUID via z.string().uuid() before any SQL.
 * T-05-03: all filters use Drizzle eq() parameterized builders — no string interpolation.
 */

import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import {
  EmailAttachments,
  EmailComponents,
  Emails,
  EntityTypes,
  ExtractionRecords,
} from "@polytoken/db/schema";
import { assertEmailOwnership } from "@polytoken/db/ownership";

import { protectedProcedure } from "../../trpc";
import { assertOwnedOrNotFound } from "../_ownership";

/**
 * emailDetailProcedures — a plain object of procedures, spread-merged into
 * emailsRouter in index.ts.
 *
 * Exporting as a plain object (not a createTRPCRouter call) allows index.ts to
 * spread it: `createTRPCRouter({ list, byId, ...emailDetailProcedures })`.
 */
export const emailDetailProcedures = {
  /**
   * detail — fetch a single email with its attachments and components.
   *
   * Throws NOT_FOUND when the email is missing or owned by another user.
   */
  detail: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOwnedOrNotFound(() =>
        assertEmailOwnership(ctx.db, input.id, ctx.user.id),
      );

      // 1. Fetch the email row
      const emailRows = await ctx.db
        .select({
          id: Emails.id,
          subject: Emails.subject,
          senderName: Emails.senderName,
          senderAddress: Emails.senderAddress,
          toAddresses: Emails.toAddresses,
          receivedAt: Emails.receivedAt,
          bodyText: Emails.bodyText,
          bodyHtml: Emails.bodyHtml,
          parseStatus: Emails.parseStatus,
          importerId: Emails.importerId,
        })
        .from(Emails)
        .where(eq(Emails.id, input.id))
        .limit(1);

      if (!emailRows[0]) return null;

      const email = emailRows[0];

      // 2. Fetch attachments (metadata only — bytes live in Supabase Storage)
      const attachments = await ctx.db
        .select({
          id: EmailAttachments.id,
          filename: EmailAttachments.filename,
          contentType: EmailAttachments.contentType,
          storageKey: EmailAttachments.storageKey,
          fileExt: EmailAttachments.fileExt,
        })
        .from(EmailAttachments)
        .where(eq(EmailAttachments.emailId, input.id));

      // 3. Fetch components joined with their active extraction record + entity type.
      //
      //    leftJoin so that components with no extraction record are included
      //    (most components are in "candidate" status before Bedrock unlocks).
      //    Superseded records are excluded from the join. A component can still
      //    have MORE THAN ONE active record (e.g. a leftover candidate plus a
      //    confirmed one), which multiplies rows — deduped to one row per
      //    component below (preferring the confirmed record).
      const componentRows = await ctx.db
        .select({
          id: EmailComponents.id,
          attachmentId: EmailComponents.attachmentId,
          parentComponentId: EmailComponents.parentComponentId,
          sourceType: EmailComponents.sourceType,
          contentText: EmailComponents.contentText,
          extractionStatus: EmailComponents.extractionStatus,
          location: EmailComponents.location,
          // Phase 9 (WR-05): content_raw carries the lineage origin marker
          // ({ origin: "auto_detected" }) stamped by AutofillFieldsUseCase. The
          // client reads it to brand the optimistic deny so a USER-DRAWN box is
          // never transiently flipped to "rejected" ("your boxes never disappear").
          contentRaw: EmailComponents.contentRaw,
          // Phase 9 (D-15): the relationship model columns now live first-class
          // on email_components — direct column reads, no join change.
          role: EmailComponents.role,
          entityTypeId: EmailComponents.entityTypeId,
          entityTypeFieldId: EmailComponents.entityTypeFieldId,
          entityTypeLabel: EntityTypes.label,
          entityTypeSlug: EntityTypes.slug,
          extractedFields: ExtractionRecords.extractedFields,
          correctedFields: ExtractionRecords.correctedFields,
          confidenceScore: ExtractionRecords.confidenceScore,
          confidenceBreakdown: ExtractionRecords.confidenceBreakdown,
          extractionRecordStatus: ExtractionRecords.status,
        })
        .from(EmailComponents)
        .leftJoin(
          ExtractionRecords,
          and(
            eq(ExtractionRecords.componentId, EmailComponents.id),
            ne(ExtractionRecords.status, "superseded"),
          ),
        )
        .leftJoin(
          EntityTypes,
          eq(EntityTypes.id, ExtractionRecords.entityTypeId),
        )
        .where(eq(EmailComponents.emailId, input.id));

      // Dedupe to exactly one row per component id (the join can return several).
      // Preserve first-seen order; prefer the confirmed extraction record so a
      // confirmed component shows its confirmed fields/status, not a stale candidate.
      const byId = new Map<string, (typeof componentRows)[number]>();
      for (const row of componentRows) {
        const existing = byId.get(row.id);
        if (
          existing === undefined ||
          (row.extractionRecordStatus === "confirmed" &&
            existing.extractionRecordStatus !== "confirmed")
        ) {
          byId.set(row.id, row);
        }
      }
      const components = [...byId.values()];

      return { email, attachments, components };
    }),
};
