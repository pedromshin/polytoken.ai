-- Generalize the system-default entity catalog away from the NAUTA maritime/
-- trade domain toward a general-purpose personal-intelligence tool.
--
-- 0004 seeded 8 maritime system types (importer_id IS NULL). Those rows are
-- referenced by extraction_records via a RESTRICT FK, so they cannot be
-- DELETEd on an installation that has data (prod). Instead:
--   * DEACTIVATE the clearly maritime/logistics types (is_active = false) —
--     the management UI defaults to active-only, so they vanish from view
--     while their historical rows stay FK-valid and recoverable.
--   * GENERALIZE 'order' and 'invoice' in place (they are general business
--     concepts; only their descriptions were trade-flavored).
--   * SEED a small generic set (contact, organization, receipt, event, task)
--     so the classifier and Knowledge UI have a sensible default catalog.
-- Idempotent: UPDATEs are naturally repeatable; INSERTs use ON CONFLICT.

-- Deactivate the maritime/logistics-specific system types.
UPDATE "entity_types" SET "is_active" = false
WHERE "importer_id" IS NULL
  AND "slug" IN ('bill_of_lading', 'container', 'booking', 'shipment', 'maritime_line', 'supplier');
--> statement-breakpoint

-- Generalize the two types worth keeping.
UPDATE "entity_types"
SET "description" = 'An order or purchase request for goods or services.'
WHERE "importer_id" IS NULL AND "slug" = 'order';
--> statement-breakpoint
UPDATE "entity_types"
SET "description" = 'A commercial invoice or bill requesting payment for goods or services.'
WHERE "importer_id" IS NULL AND "slug" = 'invoice';
--> statement-breakpoint

-- Seed general-purpose system types.
INSERT INTO "entity_types" ("slug", "label", "description", "importer_id", "is_active", "config")
VALUES
  ('contact', 'Contact', 'A person — a sender, recipient, or someone mentioned in your mail. Identified by name and email address.', NULL, true, '{}'),
  ('organization', 'Organization', 'A company, institution, or organization you interact with (a vendor, bank, service, employer, or school).', NULL, true, '{}'),
  ('receipt', 'Receipt', 'A receipt or payment confirmation acknowledging a completed transaction.', NULL, true, '{}'),
  ('event', 'Event', 'A dated event, appointment, reservation, or deadline.', NULL, true, '{}'),
  ('task', 'Task', 'An action item or request that needs a response or follow-up.', NULL, true, '{}')
ON CONFLICT ("importer_id", "slug") DO NOTHING;
--> statement-breakpoint

-- One identifier field per new type (is_identifier drives entity resolution).
INSERT INTO "entity_type_fields"
  ("entity_type_id", "importer_id", "slug", "label", "description", "field_type", "is_required", "sort_order", "config")
SELECT et.id, NULL, 'email', 'Email', 'The contact''s email address.', 'string', false, 0, '{"is_identifier": true}'
FROM "entity_types" et WHERE et.slug = 'contact' AND et.importer_id IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "entity_type_fields"
  ("entity_type_id", "importer_id", "slug", "label", "description", "field_type", "is_required", "sort_order", "config")
SELECT et.id, NULL, 'name', 'Name', 'The organization''s name.', 'string', true, 0, '{"is_identifier": true}'
FROM "entity_types" et WHERE et.slug = 'organization' AND et.importer_id IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "entity_type_fields"
  ("entity_type_id", "importer_id", "slug", "label", "description", "field_type", "is_required", "sort_order", "config")
SELECT et.id, NULL, 'reference', 'Reference', 'The receipt or transaction reference.', 'string', true, 0, '{"is_identifier": true}'
FROM "entity_types" et WHERE et.slug = 'receipt' AND et.importer_id IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "entity_type_fields"
  ("entity_type_id", "importer_id", "slug", "label", "description", "field_type", "is_required", "sort_order", "config")
SELECT et.id, NULL, 'title', 'Title', 'The event title.', 'string', true, 0, '{"is_identifier": true}'
FROM "entity_types" et WHERE et.slug = 'event' AND et.importer_id IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "entity_type_fields"
  ("entity_type_id", "importer_id", "slug", "label", "description", "field_type", "is_required", "sort_order", "config")
SELECT et.id, NULL, 'title', 'Title', 'A short title for the task.', 'string', true, 0, '{"is_identifier": true}'
FROM "entity_types" et WHERE et.slug = 'task' AND et.importer_id IS NULL
ON CONFLICT DO NOTHING;
