# P-lane 0c — UAT runsheets + baseline skeleton (vNEXT live seams → vLAUNCH BURN/WEDG)

Prepared read-only 2026-08-07. Nothing in this pack was executed. Sources (repo-relative, verified this session):
`packages/db/src/schema/chat-canvas-layouts.ts` · `packages/db/src/schema/canvas-recipes.ts` ·
`packages/db/src/schema/correction-propagations.ts` · `packages/db/src/schema/entity-type-corrections.ts` ·
`apps/web/src/app/chat/_canvas/agent-recipe-reconcile.ts` · `apps/web/src/app/chat/_canvas/canvas-publish.ts` ·
`apps/worker/src/tasks.ts` · `apps/worker/src/index.ts` · `packages/db/migrations/0053/0054/0061_*.sql` ·
`apps/email-listener/app/application/use_cases/{assemble,compose}_morning_board.py` ·
`apps/email-listener/app/infrastructure/supabase/home_canvas_layout_writer.py` ·
`.planning/milestones/vNEXT-AUDIT-2026-08-06.md` · `.planning/milestones/PROPOSAL-vLAUNCH.md`.

**graphile-worker 0.17 facts every runsheet below depends on** (apps/worker pins `graphile-worker ^0.17.0`):

- `graphile_worker.jobs` is a **VIEW** over `graphile_worker._private_jobs`; the view does not
  reliably expose `payload` — read payloads from `_private_jobs` when needed.
- A **successfully completed job row is DELETED**. Post-hoc, "the job ran" is proven by
  (a) `graphile_worker.known_crontabs.last_execution` advancing (durable cron-fired evidence),
  (b) the job's *effect* in app tables, and (c) the ABSENCE of a failed row. A lingering row with
  `attempts > 0` + `last_error` is failure evidence; `attempts = max_attempts` is the dead-letter.
- Every enqueue in this repo crosses `public.enqueue_job` (SECURITY DEFINER allowlist, migration
  0061 widens it to include `recompute_canvas_recipe` / `dispatch_recipe_recomputes` /
  `cascade_relabel`). 0061 RAISEs if the `graphile_worker` schema is absent — schema install first.

Placeholders throughout: `:conv` = conversation uuid · `:node` = the published source node's canvas
id (one dot-free segment, may contain `:`) · `:sheet` = spreadsheet uuid · `:recipe` = canvas_recipes uuid.

---

## 1 · LCAN-05 runsheet — wired recipe survives reload, asserted against the DB row

**Claim proven:** the edge and the `shared.published.*` value a recipe wires are restored after a
full browser reload FROM the `chat_canvas_layouts` row — not from client memory, not from jsdom.

**Preconditions**
- [ ] Stack serving `:3000` against the target DB (local per `docs/RUN-LOCAL.md`, or prod per audit seam 1).
- [ ] A conversation whose canvas has: one published source node (e.g. a spreadsheet node), one
      wired edge into a consumer, and a named recipe (either the agent MVP sentence with
      `CANVAS_EMIT_TOOL_ENABLED=true`, or manual wiring + save-as-recipe).
- [ ] Wait > the debounced-save window after the last canvas gesture (watch the save-status
      indicator settle) before capturing — the row is the upsert target of `saveCanvasLayout`
      (unique index `idx_chat_canvas_layouts_conversation_id`).

**Step A — capture BEFORE reload (this alone is the persistence proof):**

```sql
-- A1: the layout row exists and is conversation-scoped
SELECT id, conversation_id, scope, user_id, node_registry_version, updated_at
FROM chat_canvas_layouts WHERE conversation_id = :conv;
-- EXPECT: exactly 1 row; scope IS NULL; user_id IS NULL (conversation shape of the
-- chat_canvas_layouts_scope_discriminator CHECK).

-- A2: the wired edge is IN the row (D-09 edge shape)
SELECT jsonb_pretty(edges) FROM chat_canvas_layouts WHERE conversation_id = :conv;
-- EXPECT: array containing an element of shape
--   { "id": "<edgeId>", "source": "<:node>", "target": "<consumerNodeId>",
--     "data": { "sourcePath": "shared.published.<:node>[.field]", "targetKey": "<key>" } }

-- A3: the published value is IN shared_state at the exact slot the resolver walks
SELECT jsonb_pretty(shared_state #> ARRAY['shared','published',:node])
FROM chat_canvas_layouts WHERE conversation_id = :conv;
-- EXPECT (spreadsheet source — projectSpreadsheetForPublish shape):
--   { "label": <sheet title>, "columns": [{ "name", "type" }...],
--     "rowCount": <int>, "sample": [<= 8 row-data objects] }
-- and NOT NULL. (Bounds: depth<=4, <=20 array items, <=30 keys, strings<=2000, <=8192 bytes.)

-- A4: the recipe row that names the graph
SELECT id, name, jsonb_pretty(node_keys) AS node_keys, jsonb_pretty(edge_keys) AS edge_keys,
       jsonb_pretty(source_ref) AS source_ref, updated_at
FROM canvas_recipes WHERE conversation_id = :conv ORDER BY updated_at DESC;
-- EXPECT: 1 row for the recipe name; node_keys ⊇ [:node, <consumerNodeId>] and every entry
-- matches a node id in A2/the nodes column (all-or-nothing re-grounding guarantees this);
-- edge_keys contains the A2 edge id; source_ref (if agent-emitted with a source) =
--   { "version": 1, "reads": [{ "kind": "spreadsheet", "nodeId": :node, "spreadsheetId": :sheet }] }

-- A5: content fingerprints for the after-reload diff
SELECT md5(edges::text)                                        AS edges_md5,
       md5((shared_state #> '{shared,published}')::text)       AS published_md5,
       updated_at
FROM chat_canvas_layouts WHERE conversation_id = :conv;
```

**Step B — reload:** hard-reload the tab (Ctrl+Shift+R), let the canvas settle.
Visually: the edge is drawn, the consumer shows the published value, the recipe badge/name shows.

**Step C — capture AFTER reload and assert:**

```sql
-- C1: re-run A5.
-- PASS: edges_md5 and published_md5 are IDENTICAL to Step A. (updated_at MAY bump — the
-- debounced post-reload save is LWW by design; content equality is the assertion, not timestamps.)
-- C2: re-run A3.
-- PASS: same value object — the restored tile rendered FROM this row, per D-05 the row carries
-- refs + sharedState, and specs rehydrate from chat_messages (so genui spec content is NOT here;
-- do not "fail" C2 for absent spec bodies — that absence is the design).
```

**FAIL shapes:** A3 NULL before reload = publish never persisted (client-only value — the exact
jsdom blind spot this seam exists to catch). C1 md5 drift = reload serialization bug — capture both
`jsonb_pretty` dumps and diff before touching anything.

---

## 2 · LCAN-09-live runsheet — after-close recompute provably bumped server-side

**Claim proven:** with the tab CLOSED, a `*/15` cron tick re-polled the recipe's `source_ref` and
bumped `shared.published.<:node>` inside the layout row — the milestone's headline sentence.

**Preconditions (the audit seam-2 chain, in order)**
- [ ] Worker container deployed + booted (no `worker_fatal` in logs).
- [ ] `graphile_worker` schema installed (`apps/worker` install-schema), then 0053 + 0054 + 0061 applied.
      Sanity: `SELECT 1 FROM pg_namespace WHERE nspname='graphile_worker';` → 1 row;
      `SELECT public.enqueue_job('recompute_canvas_recipe','{"recipe_id":"00000000-0000-0000-0000-000000000000"}'::jsonb);`
      must NOT raise "unknown identifier" (it enqueues a job that no-ops/fails cleanly on the fake id —
      acceptable smoke; or simply verify the allowlist rejects a junk identifier instead).
- [ ] `RECIPE_RECOMPUTE_ENABLED=true` on the WORKER env (adds crontab line `*/15 * * * * dispatch_recipe_recomputes`).
- [ ] A recipe with a non-NULL `source_ref` and a layout row for its conversation (LCAN-05's setup is reusable):

```sql
SELECT r.id AS recipe_id, r.conversation_id, jsonb_pretty(r.source_ref) AS source_ref
FROM canvas_recipes r WHERE r.source_ref IS NOT NULL;
-- EXPECT >= 1 row; note recipe_id, conversation_id, and reads[0].nodeId / .spreadsheetId.
```

**Step A — BEFORE capture, then CLOSE the tab:**

```sql
SELECT shared_state #>> ARRAY['shared','published',:node,'label'] AS label_before,
       md5((shared_state #> ARRAY['shared','published',:node])::text) AS value_md5_before,
       updated_at AS updated_before
FROM chat_canvas_layouts WHERE conversation_id = :conv;
```

Close every tab/window with the app open. From here to Step D the browser stays closed — that IS the claim.

**Step B — mutate the source SERVER-SIDE (attribution: only the worker can now propagate this):**

```sql
UPDATE spreadsheets
SET title = title || ' · after-close ' || to_char(now() AT TIME ZONE 'utc','HH24:MI')
WHERE id = :sheet
RETURNING title;
-- title flows into the projection's `label` — a provable delta with zero UI involvement.
-- Record the new title and now() (UTC).
```

**Step C — wait ≥ one `*/15` tick past the mutation (next quarter-hour + drain slack), then verify the tick:**

```sql
-- C1: the cron fired (durable evidence — survives job-row deletion)
SELECT identifier, last_execution
FROM graphile_worker.known_crontabs
WHERE identifier = 'dispatch_recipe_recomputes';
-- PASS: last_execution > the Step-B mutation timestamp.

-- C2 (optional, only catchable DURING the window): the fan-out job rows
SELECT id, task_identifier, key, attempts, max_attempts, last_error, run_at
FROM graphile_worker.jobs
WHERE task_identifier IN ('dispatch_recipe_recomputes','recompute_canvas_recipe');
-- Key format: recipe:<recipe_id>:<yyyy-mm-ddThh:mm> (recipeJobKey, minute-stamped).
-- AFTER a successful drain this returns 0 rows (success deletes). A row with attempts>0 and
-- last_error is a failing recompute; attempts=max_attempts is the dead-letter — STOP and read
-- last_error ("projection write refused" = missing layout row or the 100k sharedState SQL cap;
-- "missing or not owned" = tenancy re-assertion failed; "source_ref:" prefix = descriptor parse).
```

**Step D — AFTER capture (tab still closed):**

```sql
SELECT shared_state #>> ARRAY['shared','published',:node,'label'] AS label_after,
       md5((shared_state #> ARRAY['shared','published',:node])::text) AS value_md5_after,
       updated_at AS updated_after
FROM chat_canvas_layouts WHERE conversation_id = :conv;
-- PASS, all three:
--   1. label_after contains ' · after-close ' (the Step-B delta landed);
--   2. value_md5_after <> value_md5_before;
--   3. updated_after > known_crontabs.last_execution window start (the worker's single-key
--      jsonb_set UPDATE sets updated_at = now(); no browser was open to have written it).
```

**Step E — reopen:** open the conversation; the wired tile shows the new label without any user
action. Screenshot for the evidence trail (steps only — §3 rules apply).

---

## 3 · MORN-07 checklist — the 05:00 UTC run painted /home

**Claim proven:** the cron fired headless at 05:00 UTC, fanned out one job per home-board user, the
listener composed + wrote each board, and a fresh browser shows it.

**Night-before setup**
- [ ] Worker deployed (as §2) and `MORNING_BOARD_ENABLED=true` on the WORKER env → crontab line
      `0 5 * * * dispatch_morning_boards` active.
- [ ] `MORNING_BOARD_ENABLED=true` on the LISTENER env too — BOTH ends read the same flag name;
      listener-dark means the use case returns `assembled=False` and writes NOTHING while the job
      still 200s (a silent no-op night).
- [ ] The seed/target user has opened `/home` at least once: the dispatcher enumerates
      `SELECT user_id FROM chat_canvas_layouts WHERE scope='home' AND user_id IS NOT NULL` — no
      prior home row, no job.
- [ ] Expected fan-out N recorded the night before:
      `SELECT count(*) FROM chat_canvas_layouts WHERE scope='home' AND user_id IS NOT NULL;`
- [ ] LWW caution acknowledged: the 05:00 write is a whole-snapshot read-then-write overwrite of
      each user's home row (SPEC-flagged clobber window; don't arrange a home board you care about
      the night before, and nobody edits /home at 05:00 UTC).

**Morning verification (SQL, in order)**

```sql
-- M1: cron fired
SELECT identifier, last_execution FROM graphile_worker.known_crontabs
WHERE identifier = 'dispatch_morning_boards';
-- PASS: last_execution = today ~05:00 UTC.

-- M2: fan-out count — worker log line `dispatch_morning_boards: enqueued N morning-board job(s)`
-- must equal the night-before N. Job keys were `morning:<userId>:<yyyy-mm-dd>` (todayUtc).
-- Success shape NOW: zero rows below (drained jobs are deleted); any survivor is a failure:
SELECT id, task_identifier, key, attempts, max_attempts, last_error
FROM graphile_worker.jobs
WHERE task_identifier IN ('dispatch_morning_boards','assemble_morning_board');
-- PASS: 0 rows. Any row: read last_error; listener logs should show the paired failure.

-- M3: board content + timestamp (the effect — the durable success evidence)
SELECT user_id,
       jsonb_array_length(nodes) AS node_count,
       (SELECT array_agg(n->>'id' ORDER BY n->>'id')
          FROM jsonb_array_elements(nodes) n)   AS node_ids,
       (SELECT array_agg(n->>'type' ORDER BY n->>'id')
          FROM jsonb_array_elements(nodes) n)   AS node_types,
       node_registry_version,
       updated_at
FROM chat_canvas_layouts
WHERE scope = 'home';
-- PASS per user: node_count = 3;
--   node_ids   = {morning-brief, morning-review-queue, morning-usage};
--   node_types = {brief, review-queue, usage};
--   node_registry_version = 'home-v1';
--   updated_at >= today 05:00 UTC (drain latency of minutes is normal);
--   edges = [] and shared_state = {} are the composed MVP shape (nodes are ref-only and
--   rehydrate their live data client-side — empty node.data here is CORRECT, not a bug).
```

- [ ] Listener logs show one `home_canvas_snapshot_updated` (or `_inserted`) per user, node_count=3.

**Browser capture — STEPS ONLY (never run playwright from this lane)**
1. Ensure the dev/prod web server is ALREADY serving on port 3000 (`npm run web:dev` at repo root
   for local). The geometry/screenshot configs spawn nothing by design.
2. First, human eyes: fresh browser → `/home` → the three cards render pre-assembled (no
   "Assemble board" click needed) with live data hydrating.
3. From `apps/web`: `npm run screenshot:review` → captures land in
   `.planning/ui-reviews/<timestamp>/` (gitignored; contains signed-in state).
4. READ the PNGs (both themes, all viewports): 3 cards, non-overlapping row, no clipping.
5. Never `npx playwright test` bare against these configs; never add a `webServer` block; keep
   serial (workers:1 — magic-link minting invalidates prior tokens).
6. File the capture path + M1–M3 outputs as the MORN-07 evidence bundle (BURN-04's artifact).

---

## 4 · BURN-06 — ledger-reconciliation draft (what each ledger must say at vNEXT close)

Rule inherited from the audit: `/gsd:complete-milestone` may run only when every Decision-Ledger
row is checked; an ACCEPT-AS-DEBT row without owner + trigger + date is an UNCHECKED row. The
enemy is the v1.9 rot: a seam sliding from "human-gated" to "forgotten" without a decision.

### The ledgers (all six), and their required close-state

| # | Ledger | Where | Must say at vNEXT close |
|---|--------|-------|------------------------|
| 1 | **ORCHESTRATOR-STATE** ⭐ CURRENT block | `.planning/ORCHESTRATOR-STATE.md` | New dated entry: "vNEXT CLOSED <date>" with the 7 seam dispositions (or pointer to the filled audit ledger); the standing "stays CODE-COMPLETE… remaining = Pedro-gated enable/live seams" language REPLACED (no live seam may still read 'open' here); active milestone pointer → vLAUNCH (blessed 2026-08-07). |
| 2 | **STATE.md** | `.planning/STATE.md` | Frontmatter `status: complete` (or rotated by complete-milestone), `percent: 100`; the "Current Position: … open only on live seams" paragraph updated to the close verdict; NO seam listed under any "carried debt" heading without an explicit ACCEPT record — the file currently carries v1.9's LIVE-03/04/CLUS-07 as the named anti-pattern; those stay only as history, never as template. |
| 3 | **PEDRO-CHECKLIST** | `.planning/PEDRO-CHECKLIST.md` | §1 browser-pass debt pruned to whatever BURN-01 did NOT cover; §3 shows 0061 APPLIED with date; §4 flag flips recorded flipped-or-deliberately-dark; §8 addendum reconciled (pwreset chain done); every ACCEPT-AS-DEBT seam COPIED here with owner + trigger + date (the audit's explicit condition — "not 'carried' bare"). |
| 4 | **HANDOFF.json** | `.planning/HANDOFF.json` | Currently an `auto-postool` checkpoint stub (phase:null). At close: either regenerated by the close tooling or left as a stub — the assertion is NEGATIVE: it must NOT name any vNEXT phase/plan as in-flight, and `human_actions_pending` must not silently hold a seam that the Decision Ledger shows as resolved. |
| 5 | **Audit Decision Ledger** | `.planning/milestones/vNEXT-AUDIT-2026-08-06.md` §(c) | All 7 rows filled with choice + owner + trigger/date + notes (the table is currently all ☐). This is the authoritative record the other five ledgers must agree with. |
| 6 | **ROADMAP vNEXT checkboxes** | `.planning/ROADMAP.md` | The live-seam requirement checkboxes (LCAN-05/09, MORN-07, BTAP-07, MCPX-09, CPF-06/live) ticked TRUTHFULLY per disposition: EXECUTE-passed → ticked with evidence link; ACCEPT-AS-DEBT → left unticked + annotated with the ledger row; never ticked-because-closing. |

### The 7 Decision-Ledger rows (verbatim from the audit, with the vLAUNCH requirement each maps to)

| Row | Seam | vLAUNCH home | Runsheet in this pack |
|---|------|--------------|----------------------|
| 1 | LCAN-05 DB-row round-trip | BURN-05 | §1 above |
| 2 | LCAN-09-live after-close recompute | BURN-05 (needs P78 worker) | §2 above |
| 3 | MORN-07 real overnight run | BURN-04 (needs P78 worker) | §3 above |
| 4 | BTAP-07 agent-authored app live | BURN-02 | — (flag flip + gesture; not this lane) |
| 5 | MCPX-09 real Claude Code connect | BURN-03 (Pedro's machine, un-delegatable) | — |
| 6 | CPF-live merge → re-label fan-out | **moved to Phase 81** = WEDG-01/02 (audit note: if ACCEPTed instead, MUST inherit Phase 57's live-DB posture with trigger "first worker deploy") | — |
| 7 | Real-browser screenshot pass (incl. CPF-06) | BURN-01 (CPF-06 leg must be recorded against Phase 75 specifically if waived) | §3's capture steps are the pattern |

Reconciliation procedure for the BURN-06 executor: fill ledger #5 first (it is the source of
truth), then propagate identical dispositions to #1/#2/#3/#6, then confirm #4's negative
assertion, then — and only then — route vNEXT through `/gsd:audit-milestone` →
`/gsd:complete-milestone` (which also triggers the sauce-backup ritual per the 2026-08-07
ORCHESTRATOR-STATE entry: backup failure = close BLOCKER).

---

## 5 · WEDGE-BASELINE.md skeleton (WEDG-03/04 — copy into `.planning/milestones/` when eligible)

```markdown
# WEDGE-BASELINE — email-intelligence learning-loop, first real values

> ⛔ CAPTURE RULE (load-bearing): every value slot below is read ONLY AFTER
> WEDG-01 (CASCADE_CORRECTION_ENABLED live + cascade_relabel draining) AND
> WEDG-02 (one genuine merge cascaded on real mail) are DONE. Reading earlier
> bakes a meaningless zero into the baseline and poisons every later delta —
> leave slots blank rather than fill them early. Each value carries its own
> capture date; a blank date means "not yet eligible", never "zero".

## Metric definitions (owner-scoped; SQL is the definition)

### M1 — Corrections made
Human corrections captured by the loop, both axes:
- type re-labels:      SELECT count(*) FROM entity_type_corrections;        -- axis: field/type (Phase 57)
- confirmed cascades:  SELECT count(*) FROM correction_propagations;       -- axis: identity merge (Phase 75)
(One cascade row per merge — job_key `cascade:{survivor}:{absorbed}` is UNIQUE, so this count
never double-reads a redelivered cascade.)

M1 value: ______ type re-labels + ______ cascades   · capture date: ________

### M2 — Re-labels per correction (propagation leverage)
Emails re-pointed per confirmed merge — the "one click compounds" number:
  SELECT round(avg(jsonb_array_length(affected_email_ids)), 1) AS avg_relabels,
         max(jsonb_array_length(affected_email_ids))            AS max_relabels,
         round(avg(jsonb_array_length(promoted_edge_ids)), 1)   AS avg_edges_promoted
  FROM correction_propagations;

M2 value: avg ______ / max ______ re-labels per correction; avg ______ edges promoted
· capture date: ________

### M3 — % of corrections that STICK
A correction "sticks" when the same component is NOT re-corrected within N days
(N = 14 default — DECISION SLOT, record if changed: N = ____):
  SELECT round(100.0 * count(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM entity_type_corrections later
           WHERE later.component_id = c.component_id
             AND later.created_at >  c.created_at
             AND later.created_at <= c.created_at + interval '14 days'
         )) / NULLIF(count(*), 0), 1) AS pct_stick
  FROM entity_type_corrections c
  WHERE c.created_at <= now() - interval '14 days';  -- only corrections old enough to judge

M3 value: ______ % stick (of ______ judgeable corrections) · capture date: ________
NOTE: M3 is structurally UNREADABLE until N days after WEDG-02 — expect a blank
first pass; that blank is correct.

## Surfaced on: <pipeline-health node | /usage> (WEDG-03 — one existing surface, no new page)

## Deliberately NOT built this milestone (the Track-6 boundary)
- Entity resolution across domains (suggest-only stance stands)
- JIT structured-note retrieval (BlendedRAG + RRF k=60)
- Circular treemap on the node model
- Reprocess-to-date (idempotent, via the now-live worker)

## Feeds: next milestone's Track-6 opener (this file is its intake artifact)
```

---

**SES case reply:** a ready draft exists at `.planning/PEDRO-DECISION-SHEET-2026-08-07.md` §C1 —
reference it, do not redraft; it gates outbound multi-user mail only, not this pack's seams.
