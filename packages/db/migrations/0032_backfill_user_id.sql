-- Phase 44 (tenancy): backfill user_id on importers, chat_conversations, and
-- chat_cost_ledger to the single existing auth.users row.
--
-- Fail-loud guard (T-44-01-01): unless BACKFILL_USER_ID overrides, this
-- migration REFUSES to run when auth.users does not have exactly one row —
-- silently picking "the first user" out of zero or many rows would risk
-- mis-assigning ownership of every existing record.
--
-- Override: migrate.ts SETs the `app.backfill_user_id` session GUC when
-- process.env.BACKFILL_USER_ID is present; current_setting(..., true) reads
-- it here (the `true` missing_ok argument returns NULL instead of erroring
-- when unset, rather than requiring the GUC to be predeclared).
--
-- Idempotent: WHERE user_id IS NULL means re-running this migration (e.g.
-- against a partially-backfilled DB) is a safe no-op for already-backfilled
-- rows.
DO $$
DECLARE
  override_setting text;
  target_user_id uuid;
BEGIN
  override_setting := nullif(current_setting('app.backfill_user_id', true), '');

  IF override_setting IS NULL AND (SELECT count(*) FROM auth.users) <> 1 THEN
    RAISE EXCEPTION 'Backfill requires exactly one auth.users row (found %). Set BACKFILL_USER_ID to override.', (SELECT count(*) FROM auth.users);
  END IF;

  target_user_id := coalesce(
    override_setting::uuid,
    (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)::uuid
  );

  UPDATE importers SET user_id = target_user_id WHERE user_id IS NULL;
  UPDATE chat_conversations SET user_id = target_user_id WHERE user_id IS NULL;
  UPDATE chat_cost_ledger SET user_id = target_user_id WHERE user_id IS NULL;

  -- Post-backfill completeness assertion (T-44-01-02): the contract migration
  -- (0033) sets user_id NOT NULL immediately after this — if any row is still
  -- NULL here, that contract step would fail anyway, but failing loudly here
  -- with a clear message is better than a generic NOT NULL constraint error.
  IF EXISTS (SELECT 1 FROM importers WHERE user_id IS NULL)
     OR EXISTS (SELECT 1 FROM chat_conversations WHERE user_id IS NULL)
     OR EXISTS (SELECT 1 FROM chat_cost_ledger WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Backfill incomplete: user_id IS NULL rows remain in importers/chat_conversations/chat_cost_ledger after backfill.';
  END IF;
END $$;
