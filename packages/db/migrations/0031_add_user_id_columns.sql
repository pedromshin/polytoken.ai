-- auth.users is Supabase-managed and already exists locally (owned by
-- supabase_auth_admin; the migrating role has no CREATE privilege on schema
-- auth and doesn't need it). The _auth.ts schema stub exists only so Drizzle
-- can model the cross-schema FK below — no CREATE TABLE statement is emitted
-- for it.
ALTER TABLE "chat_conversations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_cost_ledger" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "importers" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_cost_ledger" ADD CONSTRAINT "chat_cost_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "importers" ADD CONSTRAINT "importers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_conversations_user_id" ON "chat_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_chat_cost_ledger_user_id" ON "chat_cost_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_importers_user_id" ON "importers" USING btree ("user_id");