ALTER TABLE "code_islands" ADD COLUMN "provenance" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_code_islands_user_provenance" ON "code_islands" USING btree ("user_id","provenance");