CREATE TABLE "correction_propagations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"importer_id" uuid NOT NULL,
	"survivor_entity_instance_id" uuid NOT NULL,
	"absorbed_entity_instance_id" uuid NOT NULL,
	"promoted_edge_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_email_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"job_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "correction_propagations" ADD CONSTRAINT "correction_propagations_importer_id_importers_id_fk" FOREIGN KEY ("importer_id") REFERENCES "public"."importers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_propagations" ADD CONSTRAINT "correction_propagations_survivor_entity_instance_id_entity_instances_id_fk" FOREIGN KEY ("survivor_entity_instance_id") REFERENCES "public"."entity_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_propagations" ADD CONSTRAINT "correction_propagations_absorbed_entity_instance_id_entity_instances_id_fk" FOREIGN KEY ("absorbed_entity_instance_id") REFERENCES "public"."entity_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_correction_propagations_importer_id" ON "correction_propagations" USING btree ("importer_id");--> statement-breakpoint
CREATE INDEX "idx_correction_propagations_survivor_id" ON "correction_propagations" USING btree ("survivor_entity_instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_correction_propagations_job_key" ON "correction_propagations" USING btree ("job_key");--> statement-breakpoint
-- Phase 75 (CPF-03): correction_propagations RLS — importer-descendant hard-FK
-- table, mirroring 0038_entity_type_corrections / 0034. Hand-appended (drizzle-kit
-- never emits policies). The app boundary derives importer_id from a loaded row
-- (D-21); this is the defense-in-depth wall every importer-scoped table carries.
ALTER TABLE "correction_propagations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "correction_propagations_owner_authenticated" ON "correction_propagations"
  AS PERMISSIVE FOR ALL TO authenticated
  USING (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()))
  WITH CHECK (importer_id IN (SELECT id FROM importers WHERE user_id = auth.uid()));
