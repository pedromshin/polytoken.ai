# Retrieval-Miss Rate (RECALL-02)

**This is the stage-3 go/no-go gate.** Per backlog 999.10's staged plan, seed-then-expand
BFS-into-prompts (KGX-01..03) is explicitly deferred until this artifact measures a real
retrieval miss — "only build graph-expand if it still buys anything after the cheap alias
injection" (RECALL-01). This document names the miss definition; the artifact that computes
it lives beside it at `retrieval-miss-rate.ts`.

## What counts as a run

One row in `autofill_retrieval_events` per `AutofillUseCase.execute` call — persisted
best-effort by the autofill use case (a write failure never breaks autofill, T-31-04). Each
row records the retrieval outcome: `seed_hit_count` (few-shot examples retrieved),
`injected_entity_instance_id` (RECALL-01 alias/identifier injection, if any), and
`routing_reason`.

## Miss definition

A run is a **MISS** when either of the following holds, evaluated by joining
`autofill_retrieval_events` to `extraction_records` on `component_id` **at query time**
(never by mutating the event row — human-correction linkage is always derived, never
stored on the event):

- **Type A — had context, still wrong.** The run HAD retrieval context (`seed_hit_count > 0`
  OR `injected_entity_instance_id IS NOT NULL`), yet the human subsequently corrected the
  autofilled field(s) for that component (`extraction_records.status = 'confirmed'` AND
  `corrected_fields` is present and non-empty for that `component_id`). The retrieval
  pipeline had something to work with and the model still got it wrong — the alias/example
  context was insufficient.

- **Type B — no context, hand-filled.** The run's retrieval returned nothing
  (`seed_hit_count = 0` AND `injected_entity_instance_id IS NULL`) for a component the
  human later confirmed WITH corrections present. Nothing was retrieved or injected, so the
  human effectively hand-filled the field(s) the autofiller had no basis to guess.

A run with no matching confirmed `extraction_records` row (not yet reviewed) is **not** a
miss or a hit — it is simply excluded from the numerator (still counted in `total_runs`).

## The number

```
miss_rate = (miss_type_a + miss_type_b) / total_runs
```

With zero persisted events (`total_runs = 0`), the script reports `miss_rate = 0` (not
`NaN`/`N/A`) — an empty history is a valid, unambiguous starting state, not evidence of
either a hit or a miss.

## Running it

```bash
cd packages/db
npm run with-env -- tsx scripts/retrieval-miss-rate.ts
```

Prints the live report (`total_runs`, `total_misses`, the type-A/type-B breakdown, and
`miss_rate`), then runs a self-contained fixture-based self-test (inline `VALUES` CTEs — no
writes to any real table) proving the join/classification SQL is correct, and exits 0/1
accordingly.

## Go/no-go

This number is the evidence gate for KGX-01..03 (seed-then-expand BFS-into-prompts,
budget-pruned prompt packing, snapshot/diff staleness). A near-zero measured miss rate over
a meaningful sample of real autofill runs means the cheap alias/identifier injection
(RECALL-01) is already sufficient and stage 3 should stay deferred. A materially non-zero
rate, concentrated in Type A (context existed but was still wrong) rather than Type B (data
sparsity, unrelated to graph depth), is the signal that justifies building the bounded
neighbour-expand BFS.
