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
import { EmailComponents } from "./schema/components";
import { Emails } from "./schema/emails";
import { Importers } from "./schema/importers";
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
