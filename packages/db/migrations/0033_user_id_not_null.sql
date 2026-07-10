ALTER TABLE "chat_conversations" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_cost_ledger" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "importers" ALTER COLUMN "user_id" SET NOT NULL;