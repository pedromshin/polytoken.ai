/**
 * E5 — Cloud Desktop (RFC §6 / AWS-ARCHITECTURE.md): the `desktop_sessions` table.
 *
 * One row per cloud desktop the user has spawned — a real, owner-scoped, billed VM (AWS EC2 +
 * Amazon DCV, AWS-ARCHITECTURE.md) whose realtime desktop renders in the canvas `desktop` node.
 * The four `desktop.*` capabilities (packages/capabilities/src/desktop.ts) mutate exactly these
 * rows through the control-plane router.
 *
 * ## Tenancy (INV-8/INV-9/INV-11 — RFC §6)
 *
 * Direct `user_id` referencing auth.users(id) — one VM = one owner (RFC §2.2), NOT an
 * importer-descendant (importer is never a tenant boundary, INV-10). Ownership resolves ONLY
 * through `assertDesktopSessionOwnership` (ownership.ts) — never an ad-hoc per-call-site filter.
 * The owner-scoping RLS policies (RESTRICTIVE deny-anon + PERMISSIVE owner-authenticated) ship in
 * the SAME migration (INV-9), mirroring documents/references.
 *
 * ## INV-11 — opaque keys, provider ids are DATA never parsed for authz
 *
 * `providerInstanceId` (the AWS instance id) and `gatewayUrl` (the per-session DCV gateway origin)
 * are DATA on the owned row. Authorization is ALWAYS the DB ownership assert on `id` — the provider
 * id / hostname is NEVER parsed to decide access. Provider API credentials live ONLY in the control
 * plane, NEVER on the row and never on the desktop (RFC §6).
 *
 * ## INV-13 — the owner principal rides every billable row
 *
 * A running desktop burns money continuously (RFC §5.3). `userId` is the owner principal carried at
 * creation; the per-run cost ceilings (`hourlyRateCents`, `maxLifetimeMinutes`) are declared on the
 * row and shown in the confirm widget. Fine-grained runtime-hour metering is a separate ledger
 * (CD-4); this row carries the ceilings + lifecycle timestamps the idle-reaper and cap read.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { AuthUsers } from "./_auth";
import { desktopSessionStatusEnum } from "./enums";

// ---------------------------------------------------------------------------
// desktop_sessions — owner-scoped cloud desktops (E5 / RFC §6)
// ---------------------------------------------------------------------------
export const DesktopSessions = pgTable(
  "desktop_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Owner principal (INV-8/13). Direct user_id, no importer join. Cascade so a
    // deleted user's desktops rows go with them (the VM teardown is the router's job).
    userId: uuid("user_id")
      .notNull()
      .references(() => AuthUsers.id, { onDelete: "cascade" }),

    // The requested machine shape — display + the provider's sizing keys. Opaque to us (INV-11).
    provider: text("provider").notNull().default("aws"),
    region: text("region").notNull(),
    shape: text("shape").notNull(),

    label: text("label"),

    status: desktopSessionStatusEnum("status").notNull().default("provisioning"),

    // INV-11: provider instance id + gateway origin are DATA on the owned row — never parsed for
    // authz. Nullable: set once the provider has provisioned / minted them.
    providerInstanceId: text("provider_instance_id"),
    gatewayUrl: text("gateway_url"),

    // RFC §5.3 per-run ceilings, declared on the row and shown in the confirm widget.
    hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
    maxLifetimeMinutes: integer("max_lifetime_minutes").notNull().default(480),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Idle-reaper input (RFC §5.3 layer 2): last time a stream attached.
    lastAttachedAt: timestamp("last_attached_at", { withTimezone: true }),
    hibernatedAt: timestamp("hibernated_at", { withTimezone: true }),
    destroyedAt: timestamp("destroyed_at", { withTimezone: true }),
  },
  (t) => ({
    // Ownership lookups + the per-user desktops list (newest first).
    desktopSessionsUserIdIdx: index("idx_desktop_sessions_user_id").on(t.userId),
    // Concurrent-desktop cap + idle-reaper sweeps scan by status.
    desktopSessionsStatusIdx: index("idx_desktop_sessions_status").on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type DesktopSessionRow = typeof DesktopSessions.$inferSelect;
export type InsertDesktopSession = typeof DesktopSessions.$inferInsert;
