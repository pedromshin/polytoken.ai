/**
 * Phase 4 — Email Intelligence: shared pgEnum definitions.
 *
 * Two enums live here:
 *   componentSourceTypeEnum — what part of the email the component came from
 *   extractionStatusEnum    — lifecycle of an extraction_record (D-16)
 */

import { pgEnum } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// component_source_type — where the email_component originates
// ---------------------------------------------------------------------------
export const componentSourceTypeEnum = pgEnum("component_source_type", [
  "email_body",
  "attachment_page",
  "attachment_sheet",
  "attachment_section",
  "attachment_whole",
  // Child component proposed by segmentation over an attachment_page (04-11/14).
  // Emitted by ProposeRegionsUseCase. Added in migration 0012.
  "region",
]);

// ---------------------------------------------------------------------------
// extraction_status — lifecycle of an extraction_record (D-16)
//
// superseded MUST be present: it marks records replaced by re-processing
// the same component (versioned/supersedable reprocessing per D-16).
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// desktop_session_status — the Cloud Desktop (E5) lifecycle state a
// desktop_sessions row can be in. Mirrors the substrate's DesktopStatus
// (packages/capabilities/src/desktop.ts) 1:1 — the node chrome, the cost
// ledger, and the lifecycle capabilities all read this axis (RFC §5.1/§5.3).
// ---------------------------------------------------------------------------
export const desktopSessionStatusEnum = pgEnum("desktop_session_status", [
  "provisioning",
  "running",
  "hibernated",
  "destroyed",
]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "candidate",
  "auto_confirmed",
  "review_pending",
  "confirmed",
  "rejected",
  "superseded",
  // Component lifecycle states (email_components.extraction_status): a freshly
  // parsed/proposed component is "pending" until extracted; "error" marks a
  // page/region the parser could not process. Emitted by the PDF parser and
  // ProposeRegionsUseCase. Added in migration 0010.
  "pending",
  "error",
]);

// ---------------------------------------------------------------------------
// component_role — Phase 9 (D-01/D-02): the relationship role of a region on
// email_components. A region is one of:
//   entity    — a parent document/object (records its type via entity_type_id)
//   field     — a value of one property of a parent entity (records the
//               property via entity_type_field_id; nested under the entity via
//               parent_component_id)
//   unrelated — explicitly marked not-an-entity-and-not-a-field (D-05)
// NULL on the email_components.role column = unclassified/standalone (D-01/D-02);
// "unclassified" is intentionally NOT an enum value — manual override always wins.
// ---------------------------------------------------------------------------
export const componentRoleEnum = pgEnum("component_role", [
  "entity",
  "field",
  "unrelated",
]);

// ---------------------------------------------------------------------------
// FEATURE-CATALOG W5 (multiuser/teams/workspaces) — sharing + RBAC enums.
//
// These back the greenfield tenancy-widening layer (migration 0047). They are
// ADDITIVE: the single-user `user_id` ownership anchor is untouched — a
// workspace/share only ever WIDENS access beyond the owner, never narrows it.
// ---------------------------------------------------------------------------

// workspace_role — a member's RBAC role inside a workspace. Ordered
// viewer < member < admin < owner (see roleRank in access-control.ts). Only
// owner/admin may mutate membership; viewer caps any share it receives at view.
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

// share_permission — what a resource_share grants: read-only (view) or
// read-write (edit). edit implies view (permissionSatisfies in
// access-control.ts).
export const sharePermissionEnum = pgEnum("share_permission", [
  "view",
  "edit",
]);

// shared_resource_type — the kind of resource a resource_shares row points at.
// Owner-resolution in access-control.ts is wired for document/entity/
// conversation (DB-resolvable owner). file is path-addressed (owner access
// stays on the filesRouter prefix rails); it may still be SHARED via the
// share path. Adding a new shareable resource = extend this enum + add its
// owner resolver.
export const sharedResourceTypeEnum = pgEnum("shared_resource_type", [
  "document",
  "entity",
  "file",
  "conversation",
]);
