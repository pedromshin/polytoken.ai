# Tabular / spreadsheet engines — research lane

**Date:** 2026-07-24
**Lane:** Storage/compute + frontend grid for an in-house scalable Excel-like system where the agent proposes creating tables and extracting info into new/existing ones.
**Bottom line up front:** This is **not a greenfield selection.** polytoken has already picked a frontend grid (**ag-grid-community 35**) and a storage shape (**Postgres JSONB whole-document**), both shipped and wired. The real research question is therefore narrower and more honest: *does that stack scale to the "agent extracts into growing tables" product, and where is the load-bearing gap?* Answer: the **grid is fine for now but has a licensing cliff at exactly the word "scalable"**; the **JSONB whole-document storage is the actual scaling bottleneck** and is where a query engine (DuckDB) should be introduced.

---

## 0. What is actually in the repo (verify before recommending)

| Concern | Reality | Evidence |
|---|---|---|
| Frontend grid | **ag-grid-community ^35.1.0** (+ `ag-grid-react`). Custom 2286-LOC wrapper with cell editors, cell renderers, conditional formatting, column header menu, add-column dialog, validation. | `packages/ui/package.json` (deps `ag-grid-community`/`ag-grid-react`); `packages/ui/src/spreadsheet-grid/SpreadsheetGrid.tsx:1-60` imports `AgGridReact` from `ag-grid-react`; `wc -l` = 2286 across the dir |
| Enterprise features used? | **None.** No `LicenseManager`, `rowGroup`, `pivotMode`, `masterDetail`, integrated charts. Pure community. | grep of `packages/ui/src/spreadsheet-grid/` returns nothing for enterprise symbols |
| Storage | `spreadsheets` table: `columns jsonb`, `rows jsonb`, direct `user_id` owner-scope, RLS. **Explicitly a JSONB whole-document, not `spreadsheet_cells`.** | `packages/db/src/schema/spreadsheets.ts:63-98`; migration `packages/db/migrations/0044_spreadsheets.sql` shipped |
| Agent verbs | `table.create` / `table.update` capabilities — agent materializes "here are the 14 invoices as a table" from email extractions. Store injected as a port (`SpreadsheetStore`), fail-closed until bound. | `packages/capabilities/src/table.ts:1-40` |
| Wired where | Canvas `spreadsheet` node + entities table (the stale schema comment "imported by zero surface" is now false). | `apps/web/src/app/chat/_canvas/spreadsheet-node.tsx`, `apps/web/src/app/entities/_components/entities-table.tsx` |
| Column type vocab | `text/number/date/boolean/url/email/enum/json/array`; rows are `{ id, data: Record<string,unknown> }`. | `packages/ui/src/spreadsheet-grid/types.ts:1-40` |

So the "capability, declared once, read by four consumers" spine (`packages/capabilities/src/capability.ts:1-30`) already has `table.*` slotted into it. **The architecture question is not "which grid" — a grid was chosen and integrated — it is "how does this stack survive the word scalable in the brief."**

---

## 1. The two honest scaling gaps

### Gap A — grid licensing cliff (medium risk, deferred)
ag-grid-community is MIT and virtualizes rows in the DOM, comfortably handling ~100k rows client-side. The trap is the **Server-Side Row Model (SSRM)** — lazy/infinite scroll where the grid pages rows from a backend on demand. That is the feature you inevitably want the moment "the agent extracts info into a growing table" produces tables that don't fit in a browser. **SSRM is ag-grid Enterprise only** (commercial, per-dev license). So the current choice is free today and hits a paid gate precisely at the scale the brief names. This is a known, bounded cost — not a blocker — but it must be a *conscious* decision, not a surprise at 500k rows.

### Gap B — JSONB whole-document storage (the real bottleneck)
The schema comment is admirably honest (`spreadsheets.ts:32-36`): *"a giant sheet is read/written as one row."* The write path is whole-document (`table.create` materializes in one shot, `table.update` replaces atomically), bounded by capability input schemas. This is the correct call for *today's* verbs and it matches the repo idiom (`documents.spec`, `chat_canvas_layouts.nodes`). **But it is antithetical to "scalable."** A JSONB doc:
- is read and rewritten in full on every edit (O(sheet) per keystroke-save, TOAST out-of-line above 2KB),
- cannot be queried *across* tables (no SQL over `rows`),
- cannot back ag-grid SSRM or DuckDB pushdown,
- makes the agent's core verb — *"extract info from table X into new table Y"* — a full-table read + JS transform + full-table write, not a query.

The extraction/derivation verb is the product. It should be **a query, not a document rewrite.** That is where a query engine earns its place.

---

## 2. Storage / compute candidates (evaluated on merit)

### DuckDB — **recommended engine**, two deployment shapes
- **Server-side (via `postgres_scanner` / `pg_duckdb`):** DuckDB reads Postgres tables directly (`CREATE TABLE t AS FROM postgres_db.tbl`), with filter pushdown, then materializes results back. This is a near-exact fit for the agent verb: *"extract the invoice totals per vendor into a new table"* becomes agent-authored SQL DuckDB runs against the source rows and materializes. `pg_duckdb` v1.0 embeds DuckDB *inside* Postgres, so no separate service. ([duckdb-postgres](https://duckdb.org/docs/current/core_extensions/postgres/overview), [pg_duckdb 1.0](https://motherduck.com/blog/pg-duckdb-release/))
- **Client-side (DuckDB-WASM + OPFS):** for interactive analytics on an already-open sheet — sub-second `GROUP BY`/`ORDER BY` over millions of rows, zero server round-trip, OPFS persistence across reloads. Benchmarks: ~0.8s to return ~37k rows filtered from 3.2M; 10–100× faster than prior WASM engines. ([DuckDB-WASM VLDB paper](https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf), [OPFS auto-persist](https://zenn.dev/hideyuki_hori/articles/ae523f62f32fb8?locale=en))
- **Why it wins here:** zero Rust required (polytoken is TS + Python + a Node daemon — see `apps/daemon`), SQL is the agent's natural derivation language, and it plugs into the *existing* Postgres system-of-record rather than replacing it. It gives ~90% of a columnar engine's value at near-zero adoption cost.
- **Tradeoff:** DuckDB-WASM is single-writer and best for small/medium data in-browser (browser memory ceiling); it is an *analytics/derivation* layer, not the transactional store. Keep Postgres as system-of-record.

### Apache DataFusion — powerful, but wrong shape for this shop
DataFusion is an *embeddable Rust query-engine framework* — you embed and extend it (custom operators, Substrait federation), and it is now the fastest single-node Parquet engine, edging out DuckDB. ([Spice.ai comparison](https://spice.ai/learn/apache-datafusion-vs-duckdb)) But its entire advantage is *extension in Rust*, and polytoken has **no Rust surface** to embed it into. Adopting it means standing up a new Rust service purely to get what DuckDB gives out of the box. **Recommend against** unless a Rust data-plane materializes for other reasons.

### SQLite-WASM (wa-sqlite / OPFS) — the transactional counterpart, not the analytics one
Mature OPFS persistence (wa-sqlite `OPFSCoopSyncVFS` performs well even on large DBs; Safari <17 is a compat caveat). ([PowerSync state-of-SQLite-on-web](https://powersync.com/blog/sqlite-persistence-on-the-web)) SQLite is row-oriented and general-purpose — good if the need were *offline transactional* client state, poor for the analytical `GROUP BY`/aggregate/extract workload the agent verb implies. **Not the engine for derivation.** Could be relevant later for offline-first editing, orthogonal to this lane.

### Postgres-backed grids (normalization decision)
When a table genuinely grows past the JSONB ceiling, the migration is **not** per-cell rows (`spreadsheets.ts:24-27` correctly rejects that — a join + per-cell mutation machinery for zero current consumer). The scalable shape is **one real relational table per agent-created "table"** (dynamic/materialized tables) that DuckDB and ag-grid SSRM can both query with pushdown. That is a larger architecture step; the JSONB doc is the right *default* and normalization is the right *escalation*, triggered by row-count/query-across needs — not adopted prematurely.

---

## 3. Frontend grid candidates (given ag-grid is already in)

| Grid | License | Fit for "agent proposes tables + light edit" | Verdict |
|---|---|---|---|
| **ag-grid-community** (current) | MIT community; **SSRM/pivot/grouping/charts are Enterprise (paid)** | Already integrated, 2286 LOC invested, DOM row-virtualization to ~100k rows. Cliff at server-side scale. | **Keep.** Sunk-cost is real value; don't churn. Budget the Enterprise decision for when SSRM is needed. |
| **glide-data-grid** | **MIT, no cliff** | Canvas-rendered, "millions of rows," first-class a11y. But a *low-level data editor*: no formulas, no built-in sort/filter, you own `onCellEdited`, fill-handle only copies. ([GH](https://github.com/glideapps/glide-data-grid), [limits](https://docs.grid.glideapps.com/api/dataeditor/editing)) | **The MIT escape hatch** *if* the ag-grid Enterprise bill is refused. Rebuilds the ~2286 LOC you already have. Only migrate under license pressure. |
| **Univer** | **Apache-2.0**, full stack | Canvas engine + formula engine (2M formulas/sheet, Web Worker/server-side), OT collaboration (200 editors), pivots, 100+ plugins. Successor to the now-archived Luckysheet. ([dream-num/univer](https://github.com/dream-num/univer), [Luckysheet EOL](https://github.com/dream-num/Luckysheet/issues/1454)) | **Overkill unless end-user `=VLOOKUP` formulas become the point.** It's a spreadsheet *product* framework, not a data grid — heavy swap, wrong altitude for an *agent-authored, lightly-edited* table. Revisit only if the product pivots to user-authored spreadsheets. |
| **Handsontable** | **Non-commercial license since v7; commercial >$1k/dev/yr** ([announcement](https://handsontable.com/blog/handsontable-drops-open-source-for-a-non-commercial-license)) | — | **Reject.** Licensing hostile; no reason to adopt over what's installed. |
| **Luckysheet** | Archived Oct 2025 | — | **Dead.** Superseded by Univer. Do not adopt. |

**Judgment:** the frontend is *already solved for the current altitude.* Do not re-litigate the grid. The one grid decision that matters is future and binary: **when tables outgrow the browser, pay for ag-grid Enterprise SSRM, or migrate to glide-data-grid (MIT) + a server data source.** Both are backed by the same storage fix in §2 — SSRM and glide both need a queryable backend, which the JSONB doc is not.

---

## 4. Recommended stack + phasing

**System-of-record:** keep **Postgres/Drizzle** (`spreadsheets` JSONB doc) as the default for agent-proposed tables. It's correct for whole-document create/update and matches repo idiom. Do not normalize speculatively.

**Derivation/query engine:** introduce **DuckDB** as the "extract into new/existing table" execution layer.
- Phase 1 (low cost, high leverage): server-side DuckDB via `pg_duckdb`/`postgres_scanner`, invoked by the `table.create`/derive path so agent extraction is *SQL against source rows materialized back to a `spreadsheets` doc*, not a JS full-table transform.
- Phase 2 (interactivity): DuckDB-WASM + OPFS in the canvas panel for client-side aggregate/filter over an open sheet without server round-trips.

**Frontend:** keep **ag-grid-community**. Treat SSRM/Enterprise vs glide-data-grid as a *deferred, storage-gated* decision, not a now decision.

**Escalation trigger for normalization:** when a single agent-created table crosses the JSONB-doc comfort zone (large/growing row counts, or the need to query *across* tables), promote that table to a real relational table that DuckDB + ag-grid SSRM query with pushdown — exactly the trigger the schema comment already names (`spreadsheets.ts:32-36`), not before.

**Reject:** DataFusion (no Rust host), Handsontable (license), Luckysheet (dead), per-cell `spreadsheet_cells` (join+mutation cost for zero consumer), Univer (wrong altitude unless product pivots to user-authored formulas).

---

## 5. kaszek-os-dev reference impl — recommend requesting access

Cited as a reference implementation but not in this session. **Recommend `add_repo` for it before the storage-engine work lands**, specifically to check *how it wires the query engine to agent-proposed table creation* and whether it normalizes or keeps a document store — that is the exact decision (§2 Gap B) where an existing pattern would de-risk the most. Evaluate on merit meanwhile; nothing above depends on it. Its answer would mainly *confirm or challenge* the DuckDB-as-derivation recommendation.

---

## 6. Maturity flags

- **[SHIPPED]** ag-grid-community wrapper (2286 LOC), `spreadsheets` schema + migration 0044, `table.create`/`table.update` capabilities. This lane is *extending a live subsystem*, not greenfield.
- **[STALE DOC]** `spreadsheets.ts` header says the grid is "imported by zero surface" — false; it's wired into the canvas node and entities table.
- **[SCALING DEBT]** JSONB whole-document is the real bottleneck vs the brief's "scalable"; the schema honestly flags its own escalation trigger.
- **[LICENSE CLIFF]** ag-grid SSRM/pivot/charts are Enterprise (paid) — the free tier ends at server-side scale.
- **[NO RUST]** rules out DataFusion's core advantage; DuckDB is the pragmatic fit.

### Sources
- [DuckDB-WASM (VLDB)](https://www.vldb.org/pvldb/vol15/p3574-kohn.pdf) · [DuckDB Postgres extension](https://duckdb.org/docs/current/core_extensions/postgres/overview) · [pg_duckdb 1.0](https://motherduck.com/blog/pg-duckdb-release/) · [DuckDB-WASM OPFS](https://zenn.dev/hideyuki_hori/articles/ae523f62f32fb8?locale=en)
- [DataFusion vs DuckDB (Spice.ai)](https://spice.ai/learn/apache-datafusion-vs-duckdb) · [SQLite persistence on web (PowerSync)](https://powersync.com/blog/sqlite-persistence-on-the-web)
- [glide-data-grid (GH)](https://github.com/glideapps/glide-data-grid) · [glide editing limits](https://docs.grid.glideapps.com/api/dataeditor/editing) · [Univer (GH)](https://github.com/dream-num/univer) · [Luckysheet EOL → Univer](https://github.com/dream-num/Luckysheet/issues/1454) · [Handsontable license change](https://handsontable.com/blog/handsontable-drops-open-source-for-a-non-commercial-license) · [Best JS data grids 2026 (Bryntum)](https://bryntum.com/blog/the-best-javascript-data-grids-in-2026/)
