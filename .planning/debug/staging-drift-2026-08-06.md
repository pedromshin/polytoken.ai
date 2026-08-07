# Staging migration drift — diagnosis + repair (2026-08-06)

## Symptom

`npm run db:migrate:staging` fails with `relation "public.chat_source_ledger" does not exist`.
Staging's newest drizzle journal row is 2026-07-16; `canvas_recipes`, `code_islands`,
`correction_propagations`, `subscriptions` (and 20 more migrations' worth of objects) are absent.
Prod is healthy. Local dev is unaffected (see below).

## Root cause: out-of-order journal timestamps + drizzle's high-water-mark skip

Drizzle's migrator takes ONE snapshot per run — the single newest
`drizzle.__drizzle_migrations.created_at` — and applies only journal entries whose `when` is
**greater** than that snapshot (`drizzle-orm` migrator: `lastDbMigration.created_at < entry.folderMillis`).

Journal entries 0024–0036 were hand-stamped with round daily timestamps (`…T18:40:00.000Z`,
exact multiples of 86,400,000 ms). The last of them, `0036_chat_conversation_thread_id`, was
stamped **2026-07-16T18:40:00Z** (`1784227200000`). But drizzle-kit *generated* the next three
migrations on the morning of **2026-07-15** — i.e. with `when` values EARLIER than 0036's hand-set stamp:

| tag | journal `when` | vs 0036 (1784227200000) |
|---|---|---|
| 0037_serious_sugar_man | 1784093875902 = 2026-07-15T05:37:55Z | **earlier → skipped forever** |
| 0038_entity_type_corrections | 1784103700170 = 2026-07-15T08:21:40Z | **earlier → skipped forever** |
| 0039_entity_resolution_dismiss_filter | 1784108349679 = 2026-07-15T09:39:09Z | **earlier → skipped forever** |

Staging ran the migrator at a moment when it applied through 0036, recording high-water mark
`1784227200000`. Every run since then:

1. skips 0037/0038/0039 (their `when` < high-water mark),
2. attempts `0040_documents` (`when` 1784564238930 > mark), whose **line 11** is
   `ALTER TABLE "documents" ADD CONSTRAINT … FOREIGN KEY ("source_ledger_id") REFERENCES "public"."chat_source_ledger"("id")`,
3. crashes — `chat_source_ledger` is created only by the skipped 0037,
4. and because drizzle wraps the whole run in a single transaction, **nothing** persists.
   Staging is frozen at 0036 permanently; the failure is deterministic on every retry.

Why prod is healthy: prod's catch-up run had a high-water snapshot *below* 0037's `when`
(it applied 0037+ in one batch before the skip window could open). The bug only bites a DB whose
recorded high-water mark landed **between** 0037's `when` (2026-07-15T05:37Z) and 0036's stamp
(2026-07-16T18:40Z) — exactly and only staging. (Not probed — prod untouched per mandate.)

## Evidence (read-only probe, 2026-08-06)

Probe: `scratchpad/staging-drift-probe.mjs` against `.env.staging` `POSTGRES_URL_NON_POOLING`
(host `aws-1-sa-east-1.pooler.supabase.com`, user ref `fyfwkjvbcrmjqjysdyqw` = staging; prod never contacted).

- `drizzle.__drizzle_migrations`: **exactly 37 rows** = journal idx 0–36 (0000…0036).
  Newest `created_at` = `1784227200000` = 0036's journal `when`. No partial rows beyond it.
- All 37 stored hashes == sha256 of the local migration files (**37/37 match**) — files unedited,
  and this confirms the hash formula the repair script replicates.
- `public` has 25 base tables; ABSENT: `chat_source_ledger`, `entity_type_corrections`, `documents`,
  `document_references`, `desktop_sessions`, `spreadsheets`, `file_versions`, `workspaces`,
  `canvas_recipes`, `code_islands`, `correction_propagations`, `subscriptions`, …
- `graphile_worker` schema: **ABSENT** on staging — matters because 0053/0054/0061 contain a
  DO-block that `RAISE EXCEPTION`s without it (see 0053 header: worker `install-schema` must run first).

## Missing migrations (24, in journal order)

0037_serious_sugar_man (creates `chat_source_ledger` + `chat_context_edges`), 0038_entity_type_corrections,
0039_entity_resolution_dismiss_filter, 0040_documents, 0041_references, 0042_desktop_sessions,
0043_entity_resolution_dismiss_keying, 0044_spreadsheets, 0045_file_versions, 0046_home_canvas_scope,
0047_workspaces_teams_rbac, 0048_secure_rls_chat_telemetry, 0049_generalize_entity_types,
0050_purge_maritime_data, 0052_canvas_node_promotion, 0053_graphile_enqueue_wrapper,
0054_enqueue_allowlist_morning_board, 0055_code_islands (`code_islands`), 0056_billing
(`subscriptions`, `stripe_webhook_events`), 0057_sour_peter_quill, 0058_secret_mesmero
(`canvas_recipes`), 0059_moaning_wrecker, 0060_rapid_red_skull (`correction_propagations`),
0061_enqueue_allowlist_cascade_recipe.

(No 0051 exists — neither file nor journal entry; the idx 50→52 gap is intentional/harmless.)

## Local-dev impact

`.env.local` points `POSTGRES_URL`/`POSTGRES_URL_NON_POOLING` at **127.0.0.1:54322** (local
Supabase), not staging — local dev is unaffected by this drift. Fresh local resets are also immune
to the skip itself: a single catch-up run snapshots the high-water mark once and applies the whole
journal in array order. Only a DB that recorded 0035/0036's future-stamped `when` as its high-water
mark before 2026-07-15 could be stuck — that DB is staging alone.

## Repair (user-authorized, one paste)

Script: `C:\Users\pc\AppData\Local\Temp\claude\c--Users-pc-Desktop-nauta-services-email-listener\139e600f-8ae8-44c5-8288-ca6bb368d4cd\scratchpad\staging-repair.mjs`
(copy it somewhere durable if the scratchpad may be cleaned).

It is idempotent and staging-guarded (refuses any URL without the staging ref, hard-refuses the
prod ref). It applies the 24 missing migrations **in journal order**, one transaction per migration
(failure rolls back that migration only; rerun resumes), installs the `graphile_worker` schema via
graphile-worker's own idempotent migrate immediately before 0053 needs it (same mechanism and
role as `apps/worker/src/install-schema.ts`), and inserts each journal row exactly as drizzle's
migrator does: `insert into drizzle.__drizzle_migrations ("hash","created_at") values (sha256(file), journal.when)`.

```
node "C:\Users\pc\AppData\Local\Temp\claude\c--Users-pc-Desktop-nauta-services-email-listener\139e600f-8ae8-44c5-8288-ca6bb368d4cd\scratchpad\staging-repair.mjs" --yes && npm run db:migrate:staging
```

(Without `--yes` it is a read-only dry run — already executed 2026-08-06: 24 pending listed,
graphile install flagged, nothing written.)

The trailing `npm run db:migrate:staging` is the **final green check**: after repair the newest
`created_at` is 1785974400000 (0061), everything in the journal is older-or-equal, so drizzle's own
migrator must report nothing pending and exit green.

## Prevent recurrence

- **Never hand-stamp a journal `when` into the future.** The 0024–0036 round `…T18:40Z` stamps are
  what opened the skip window. If a `when` must be hand-set, set it to the real current time.
- The 0045/0046 pair is also out of order (0046's `when` < 0045's) — harmless once applied in a
  single batch (as this repair does), but the same class of hazard.
- 0061's hand stamp is `2026-08-06T00:00:00Z` (today). Any migration generated after this morning
  gets a larger `when` — fine — but this was close to reopening the same window.
