/**
 * ownership.ts — the ONE central ownership helper (TENA-03).
 *
 * Every tRPC procedure and web route asks "does this user own this row?"
 * through this module — never via ad-hoc per-call-site SQL. Two ownership
 * anchors (Phase 44 Plan 01 schema):
 *   - importer-anchored tables (importers, emails, email_components,
 *     email_attachments, entity_instances, threads) — resolved via a join to
 *     importers.user_id
 *   - direct-user_id tables (chat_conversations, chat_cost_ledger) —
 *     resolved directly, no join. assertConversationOwnership is the single
 *     entry point every chat-descendant scoping (chat_messages, chat_runs,
 *     chat_run_events, chat_canvas_layouts, chat_widget_interactions) goes
 *     through, by resolving the ancestor conversation first.
 *
 * Fail-closed (T-44-02-01): a missing row and a row owned by someone else
 * both throw the same OwnershipError — callers never get a signal
 * distinguishing "doesn't exist" from "not yours". Callers decide the
 * transport code (403/NOT_FOUND) from the caught error.
 *
 * All queries are parameterized Drizzle builders (eq) — zero string
 * interpolation (T-44-02-02).
 *
 * The Drizzle handle is always the FIRST parameter — callers pass ctx.db
 * (tRPC) or the imported db (web route). This module never imports the `db`
 * singleton itself, so it stays test-injectable and framework-agnostic.
 * Callers are contractually required to source userId from server-verified
 * identity (ctx.user / X-User-Id), never from client-supplied input
 * (T-44-02-03 — enforced by the calling procedures, not this module).
 */

import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { ChatConversations } from "./schema/chat-conversations";
import { ChatMessages } from "./schema/chat-messages";
import { ChatSourceLedger } from "./schema/chat-source-ledger";
import { EmailComponents } from "./schema/components";
import { Emails } from "./schema/emails";
import { ForwardingAddresses } from "./schema/forwarding-addresses";
import { Importers } from "./schema/importers";
import { KnowledgeNodes } from "./schema/knowledge-nodes";
import { Threads } from "./schema/threads";

/** The Drizzle handle every ownership function accepts as its first parameter. */
export type OwnershipDb = PostgresJsDatabase<typeof schema>;

/**
 * Thrown by every assert* function when the target row belongs to another
 * user OR does not exist. Fail-closed (T-44-02-01): no signal distinguishes
 * the two cases — callers map this to a 403/NOT_FOUND per their own
 * transport.
 */
export class OwnershipError extends Error {
  readonly resource: string;
  readonly id: string;

  constructor(resource: string, id: string) {
    super(`Ownership check failed for ${resource} ${id}`);
    this.name = "OwnershipError";
    this.resource = resource;
    this.id = id;
  }
}

/**
 * userOwnedImporterIds — every importer id owned by userId.
 * Returns [] when the user owns none (never throws).
 */
export async function userOwnedImporterIds(
  db: OwnershipDb,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: Importers.id })
    .from(Importers)
    .where(eq(Importers.userId, userId));

  return rows.map((row) => row.id);
}

/**
 * assertImporterOwnership — resolves when importers.user_id = userId.
 * Throws OwnershipError when the importer belongs to another user or is
 * missing.
 */
export async function assertImporterOwnership(
  db: OwnershipDb,
  importerId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: Importers.userId })
    .from(Importers)
    .where(eq(Importers.id, importerId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("importer", importerId);
  }
}

/**
 * assertEmailOwnership — resolves when emails.importer_id -> importers.user_id
 * = userId. Throws OwnershipError otherwise/missing.
 */
export async function assertEmailOwnership(
  db: OwnershipDb,
  emailId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: Importers.userId })
    .from(Emails)
    .innerJoin(Importers, eq(Importers.id, Emails.importerId))
    .where(eq(Emails.id, emailId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("email", emailId);
  }
}

/**
 * assertComponentOwnership — resolves when email_components ->
 * importers.user_id = userId. email_components carries importer_id
 * directly (components.ts), so a single join to importers is enough — no
 * need to route through emails. Throws OwnershipError otherwise/missing.
 */
export async function assertComponentOwnership(
  db: OwnershipDb,
  componentId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: Importers.userId })
    .from(EmailComponents)
    .innerJoin(Importers, eq(Importers.id, EmailComponents.importerId))
    .where(eq(EmailComponents.id, componentId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("component", componentId);
  }
}

/**
 * assertThreadOwnership — resolves when threads.importer_id ->
 * importers.user_id = userId. Throws OwnershipError otherwise/missing.
 */
export async function assertThreadOwnership(
  db: OwnershipDb,
  threadId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: Importers.userId })
    .from(Threads)
    .innerJoin(Importers, eq(Importers.id, Threads.importerId))
    .where(eq(Threads.id, threadId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("thread", threadId);
  }
}

/**
 * assertConversationOwnership — resolves when chat_conversations.user_id =
 * userId. Throws OwnershipError otherwise/missing.
 */
export async function assertConversationOwnership(
  db: OwnershipDb,
  conversationId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: ChatConversations.userId })
    .from(ChatConversations)
    .where(eq(ChatConversations.id, conversationId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("conversation", conversationId);
  }
}

/**
 * assertForwardingAddressOwnership — resolves when
 * forwarding_addresses.user_id = userId. Direct user_id, no join (mirrors
 * assertConversationOwnership). Throws OwnershipError otherwise/missing.
 */
export async function assertForwardingAddressOwnership(
  db: OwnershipDb,
  addressId: string,
  userId: string,
): Promise<void> {
  const rows = await db
    .select({ userId: ForwardingAddresses.userId })
    .from(ForwardingAddresses)
    .where(eq(ForwardingAddresses.id, addressId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== userId) {
    throw new OwnershipError("forwarding_address", addressId);
  }
}

/**
 * ContextEdgeSourceRef — the discriminated union chat_context_edges.sourceRef
 * holds (Phase 56, RCNV-04). The AUTHORITATIVE shape lives in the doc comment
 * on `./schema/chat-context-edges.ts` — this type mirrors it exactly so
 * `assertSourceRefOwnership` stays structurally aligned with the Zod boundary
 * (`packages/api-client/src/router/chat/context-edges.ts`'s
 * `contextEdgeSourceRefSchema`) without either module importing the other.
 */
export type ContextEdgeSourceRef =
  | { readonly type: "source_ledger"; readonly ledgerId: string }
  | { readonly type: "knowledge_node"; readonly nodeId: string }
  | {
      readonly type: "genui_panel";
      readonly messageId: string;
      readonly partIndex: number;
    }
  | { readonly type: "email_thread"; readonly threadId: string };

/**
 * assertSourceRefOwnership — the WRITE-TIME cross-tenant gate for RCNV-04
 * (Phase 56 Plan 03, T-56-03-01 — "Landmine 2"). Dispatches per
 * `sourceRef.type` to resolve the OWNING user of the resource a
 * `chat_context_edges` row would point at, and throws the same
 * `OwnershipError` shape every sibling assert* throws on a foreign or
 * missing resource — fail-closed, no signal distinguishing "doesn't exist"
 * from "not yours" (T-44-02-01's convention, extended here).
 *
 * CALLS an existing helper where one exists (`email_thread` delegates
 * directly to `assertThreadOwnership`) and otherwise does a single
 * parameterized join to the resource's owning `user_id` — never reimplements
 * `assertConversationOwnership`/`assertThreadOwnership`'s own logic. Per
 * Decision D-56-A (56-03-PLAN.md), this performs OWNERSHIP resolution ONLY —
 * no `knowledge_nodes.tier` check — an explicit user-drawn edge injects
 * regardless of trust tier; only `list_injectable_edges` (automatic
 * injection) gates on tier.
 *
 * Callers MUST gate on `chat_context_edges`/`chat_source_ledger` table
 * existence (migration 0037, `tableColumnExists`) BEFORE calling this for a
 * `source_ledger`-typed sourceRef — both tables land in the same migration,
 * so a `createContextEdge` caller that has already confirmed
 * `chat_context_edges` exists may safely assume `chat_source_ledger` does
 * too (56-01-SUMMARY.md: "Both new tables in ONE combined generate pass").
 */
export async function assertSourceRefOwnership(
  db: OwnershipDb,
  userId: string,
  sourceRef: ContextEdgeSourceRef,
): Promise<void> {
  switch (sourceRef.type) {
    case "email_thread":
      return assertThreadOwnership(db, sourceRef.threadId, userId);

    case "knowledge_node": {
      const rows = await db
        .select({ userId: Importers.userId })
        .from(KnowledgeNodes)
        .innerJoin(Importers, eq(Importers.id, KnowledgeNodes.importerId))
        .where(eq(KnowledgeNodes.id, sourceRef.nodeId))
        .limit(1);

      const row = rows[0];
      if (!row || row.userId !== userId) {
        throw new OwnershipError("knowledge_node", sourceRef.nodeId);
      }
      return;
    }

    case "source_ledger": {
      const rows = await db
        .select({ userId: ChatConversations.userId })
        .from(ChatSourceLedger)
        .innerJoin(
          ChatConversations,
          eq(ChatConversations.id, ChatSourceLedger.conversationId),
        )
        .where(eq(ChatSourceLedger.id, sourceRef.ledgerId))
        .limit(1);

      const row = rows[0];
      if (!row || row.userId !== userId) {
        throw new OwnershipError("source_ledger", sourceRef.ledgerId);
      }
      return;
    }

    case "genui_panel": {
      const rows = await db
        .select({ userId: ChatConversations.userId })
        .from(ChatMessages)
        .innerJoin(
          ChatConversations,
          eq(ChatConversations.id, ChatMessages.conversationId),
        )
        .where(eq(ChatMessages.id, sourceRef.messageId))
        .limit(1);

      const row = rows[0];
      if (!row || row.userId !== userId) {
        throw new OwnershipError("genui_panel", sourceRef.messageId);
      }
      return;
    }
  }
}
