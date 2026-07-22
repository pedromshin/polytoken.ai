# Data-eng / data-science adoption ladder for polytoken

**Date:** 2026-07-22
**Scope:** Honest overkill-vs-worth-it evaluation of the DS/DE tool ecosystem for polytoken as it exists today, plus the LLM post-training/eval side, ending in a 3-stage adoption ladder tied to actual repo needs.

## 0. Ground truth from the repo (read before recommending anything)

What the codebase actually is (verified against `packages/db/src/schema/*` and `apps/email-listener/pyproject.toml`):

- **One Postgres (Supabase) is the entire data platform.** Drizzle schema + 42 SQL migrations (`packages/db/migrations/0042_desktop_sessions.sql` is latest). pgvector via `halfvec(1536)` + HNSW (`knowledge-nodes.ts`, `_halfvec.ts`).
- **The ingestion "pipeline" is event-driven, not batch.** FastAPI listener (`apps/email-listener`, Clean Architecture) receives emails one at a time; `emails` is append-only with an `(importer_id, message_id)` idempotency key and `parse_status` state machine — i.e., the repo already has an exactly-once, incremental ingest pattern without any DE tooling.
- **Human-in-the-loop labels already exist.** `extraction_records.extracted_fields` (LLM output) vs `corrected_fields` (immutable human overlay, versioned/supersedable). This is a fine-tuning/eval dataset accumulating for free.
- **Eval instrumentation already exists, hand-rolled in SQL.** `autofill_retrieval_events` + `packages/db/scripts/retrieval-miss-rate.ts` (query-time join to corrections = retrieval miss rate), `genui_generation_events` (outcome/latency/tokens audit), `chat_cost_ledger` (per-turn/day cost circuit breaker). Trust tiers on knowledge nodes (`EXTRACTED`/`INFERRED`/`AMBIGUOUS`).
- **Python side is lean:** FastAPI, pydantic, anthropic, supabase, pdf tooling. No pandas, no polars, no ML libs. TS side: Next.js 15/tRPC.
- **Data volume assumption (explicit):** solo founder, email-scale data. Even a heavy year of email ingestion is likely 10^4–10^6 rows and well under 10^6 embeddings. Nothing in the repo suggests otherwise. All recommendations below assume ≤ low-millions of rows; re-evaluate if that assumption breaks.

## 1. Tool-by-tool verdicts

### Spark / Beam / Dataflow — **overkill now, likely overkill forever for this product**
Spark and Beam solve distributed compute over data that does not fit one machine. Polytoken's entire dataset fits in RAM on a laptop. Adopting them would add cluster/runner ops, JVM/dep management, and a second execution model for zero benefit. The 2026 consensus stack for this scale is "Postgres as system of record + DuckDB/Polars at the edges," not distributed engines ([MotherDuck: DuckDB vs Postgres](https://motherduck.com/learn/duckdb-vs-postgres-embedded-analytics/), [Lakehouse ecosystem guide 2026](https://datalakehousehub.com/blog/2025-09-2026-guide-to-data-lakehouses/)). **Verdict: do not adopt. Revisit only if polytoken becomes multi-tenant at ~10^8+ rows — and even then, a warehouse beats Spark for this shape of data.**

### DuckDB — **not needed yet; the first analytics tool to reach for when SQL-in-Postgres gets awkward**
DuckDB can attach directly to Postgres (`postgres_scanner` / `ATTACH`) and run columnar analytics over live tables without any ETL; `pg_duckdb` 1.0 (2026) even embeds the engine inside Postgres ([pg_duckdb](https://github.com/duckdb/pg_duckdb), [MotherDuck announcement](https://motherduck.com/blog/pg-duckdb-release/)). For polytoken the near-term uses are real but small: ad-hoc analysis of `genui_generation_events`/`chat_cost_ledger`, cohort views of extraction accuracy, one-off Parquet exports of training data. Today's volumes are small enough that plain Postgres SQL (like `retrieval-miss-rate.ts` already does) is fine. **Verdict: adopt lazily, as a local analyst tool (zero infra, `pip install duckdb`/`npm i duckdb`), the day an analytics query is annoying to write or slow in Postgres. Do not install pg_duckdb into Supabase (not supported on Supabase hosted anyway).**

### Polars — **worth adopting opportunistically; never adopt pandas**
Polars is the right dataframe library if/when the Python listener needs in-memory tabular work (building eval sets from `extraction_records`, dataset prep for fine-tuning). It's fast, has lazy execution, and avoids pandas' API sprawl. But note the repo currently has *zero* dataframe code — Clean Architecture repositories return typed domain objects. **Verdict: not a platform decision at all; add `polars` to a script's deps the first time you'd otherwise reach for pandas. Keep it out of `app/domain`/`app/application` (import-linter will rightly complain).**

### dlt (data load tool) — **only if new *external* sources appear**
dlt automates schema inference, normalization, and incremental state for pulling messy external sources into a DB ([dlt docs](https://dlthub.com/docs/intro), [2026 review](https://www.modern-datatools.com/tools/dlthub)). Polytoken's one ingest path (inbound email → FastAPI → Postgres) is already better than what dlt would give: it's domain-modeled, idempotent, and tested. **Verdict: skip for the current pipeline. Reconsider the day you add importers for Gmail-API backfills, Notion, calendar, CRM, or similar external APIs — dlt would save real time there (incremental cursors, retries, schema drift) versus hand-rolling a second listener. It runs as a plain Python lib inside the existing uv project; no infra.**

### Dagster / Airflow / Prefect — **overkill; cron + a queue column is the honest answer**
Orchestrators pay off when you have DAGs of interdependent batch jobs, backfills across many assets, and a team reading the UI. Polytoken has an event-driven listener plus (at most) a couple of periodic jobs (embedding backfills, miss-rate reports, knowledge-node synthesis). Airflow is the heavyweight incumbent; Dagster is "building a data platform from day one"; Prefect is the lightest of the three for solo devs ([ZenML comparison](https://www.zenml.io/blog/orchestration-showdown-dagster-vs-prefect-vs-airflow), [Orchestra 2026 comparison](https://www.getorchestra.io/blog/dagster-vs-prefect-vs-airflow-complete-data-orchestration-comparison-2026)). All three add a scheduler service + metadata DB to babysit — that's real ops load for one person. **Verdict: do not adopt. Use Supabase `pg_cron` + Edge Functions or a small `jobs` table with `parse_status`-style state (the pattern `emails` already uses) for periodic work. Reconsider Dagster only at Stage 3, if a genuine multi-step batch graph (ingest → embed → synthesize → evaluate → publish) needs backfills and lineage.**

### Lakehouse formats (Iceberg / Delta / DuckLake) — **overkill; Parquet-on-S3 exports are the 90% answer**
Table formats exist to give many engines transactional access to files on object storage. Polytoken has one engine (Postgres). Iceberg/Delta bring catalogs, manifests, and compaction jobs — pure overhead here ([table formats in 2026](https://dev.to/alexmercedcoder/lakehouse-table-formats-in-2026-iceberg-delta-lake-hudi-paimon-and-ducklake-how-they-work-p1k)). If a cold-archive tier is ever needed (e.g., raw email bodies aging out of Postgres — note `emails.raw_storage_key` already points raw bytes at Supabase Storage/S3), plain Parquet files written by DuckDB are enough; DuckLake is the only format light enough to consider (metadata in a SQL DB, data as Parquet, designed exactly for "local-first, small-team" lakehouses — [endjin on DuckLake](https://endjin.com/blog/introducing-ducklake-lakehouse-architecture-reimagined-modern-era), [DuckLake deep dive](https://motherduck.com/blog/ducklake-architecture-deep-dive/)). **Verdict: nothing at Stage 1–2. DuckLake only if an analytics copy of the data outgrows convenient Postgres storage.**

### MLflow — **skip the classic ML half; its GenAI half competes with tools you'll pick in Stage 2**
Classic MLflow (experiment tracking, model registry) assumes you train models regularly — polytoken doesn't. MLflow 3 pivoted to GenAI: tracing, LLM judges, eval datasets, pytest CI gating ([MLflow 3 release](https://mlflow.org/releases/3), [Databricks MLflow 3 GenAI](https://docs.databricks.com/aws/en/mlflow3/genai/)). It's credible, but it's a *server* to run, and polytoken already writes its own trace rows (`genui_generation_events`, `chat_run_events`, `chat_cost_ledger`) with domain-specific semantics no generic tracer would capture (trust tiers, routing reasons, cost circuit breaker). **Verdict: skip now. If tracing-as-a-product is wanted later, evaluate Langfuse (OSS, self-hostable, LLM-native) or MLflow 3 side by side at Stage 2/3; adopt MLflow's tracking half only if fine-tuning becomes routine.**

### pgvector scaling — **explicitly fine; do not shop for a vector DB**
2026 guidance: pgvector is production-ready to ~10M vectors/node, ~50M with pgvectorscale; migration triggers are billions of vectors, sub-20ms p99 requirements, or heavy re-embedding churn ([Instaclustr 2026 guide](https://www.instaclustr.com/education/vector-database/pgvector-key-features-tutorial-and-pros-and-cons-2026-guide/), [ClickHouse on scaling pgvector](https://clickhouse.com/resources/engineering/scale-vector-search-postgres)). Polytoken already uses `halfvec` (half-precision = half the RAM) and HNSW — the right calls. Knowledge-node counts will be orders of magnitude below any limit. **Verdict: pgvector is the endgame here, not a stepping stone.**

## 2. LLM side

### Fine-tuning / post-training (axolotl, Unsloth, HF TRL) — **premature until the correction dataset is big enough**
The 2026 landscape ([MarkTechPost framework comparison](https://www.marktechpost.com/2026/07/22/unsloth-vs-axolotl-vs-trl-vs-llama-factory-a-fine-tuning-framework-comparison-on-speed-vram-and-multi-gpu/), [Spheron comparison](https://www.spheron.network/blog/axolotl-vs-unsloth-vs-torchtune/)):

- **Unsloth** — best single-GPU LoRA/QLoRA economics (2–5× faster, 50–70% less VRAM); breaks on unsupported architectures. The default for a solo founder renting one GPU.
- **HF TRL** — the canonical SFT/DPO/GRPO trainers; reference implementation, broadest compatibility, not the fastest.
- **axolotl** — declarative YAML recipes, shines multi-GPU (DeepSpeed/FSDP); more machinery than one person needs at first.

**Repo reality check:** polytoken's extraction pipeline runs on Anthropic models (`anthropic>=0.40.0`; per CLAUDE.md constraints the product is Claude-based). Fine-tuning an *open-weights* model only makes sense for a narrow, high-volume, latency/cost-sensitive subtask — the obvious candidate is **structured field extraction** (`extracted_fields` prediction), where `corrected_fields` provides ground truth. Rule of thumb: don't bother below ~500–1,000 high-quality corrected examples per task; below that, few-shot retrieval (which the `autofill_retrieval_events` machinery already optimizes) beats a fine-tune. **Assumption (explicit): current corrected-extraction volume is far below that threshold — verify with a count over `extraction_records WHERE corrected_fields IS NOT NULL` before ever renting a GPU.**

**Weights handling, when it happens:** use `safetensors` only (never pickle), push adapters (LoRA deltas, tens of MB) to a private Hugging Face Hub repo rather than versioning merged weights; serve via vLLM or an inference host (Together/Fireworks/Modal) rather than self-managed GPUs. Keep base-model + adapter-hash + dataset-snapshot-hash in a small `fine_tunes` table — the same audit idiom as `genui_generation_events`.

### Evals — **the one LLM-side investment that is NOT overkill now**
Polytoken already has the hard part (persisted outcomes + human corrections). What's missing is a repeatable offline harness. 2026 consensus: solo devs start with **promptfoo** (CLI/YAML, free, regression + red-team; note OpenAI acquired it in March 2026 — core stays MIT but watch neutrality) or **DeepEval** (MIT, pytest-native, runs locally); platforms (Braintrust, LangSmith, Langfuse, Arize Phoenix) come later for annotation queues and dashboards ([Braintrust on Promptfoo alternatives](https://www.braintrust.dev/articles/best-promptfoo-alternatives-2026), [2026 framework benchmark](https://aiml.qa/llm-evaluation-framework-benchmark-2026/)). The pattern to converge on: lightweight CI gating tool + (later) a platform for human review ([Inference.net comparison](https://inference.net/content/llm-evaluation-tools-comparison/)). For polytoken specifically, the eval *dataset* should be generated by SQL from `extraction_records` (input component text → confirmed fields), not hand-written — that makes evals self-updating as usage grows.

### Communities / orgs worth following (low-noise, relevant to this stack)
- **DuckDB Labs / MotherDuck** (blog + Discord) — small-data analytics direction; DuckLake evolution.
- **dltHub** (Slack + blog) — if/when external-source importers arrive.
- **Supabase** (blog, launch weeks) — pgvector/pg_cron/queues features land here first and remove the need for third-party infra.
- **Hugging Face** (TRL/PEFT repos + blog) and **Unsloth** (GitHub/Discord) — post-training state of the art.
- **EleutherAI** — `lm-evaluation-harness`, the academic-benchmark reference if open-weight models enter the picture.
- **Hamel Husain / Shreya Shankar "AI Evals" material** and **Eugene Yan / applied-llms.org** — the best practitioner writing on evals-first LLM product development.
- **Latent.Space** (podcast/newsletter) — broad AI-engineering ecosystem radar.
- **MLOps Community / Small Data SF** — pragmatic "you don't need big data" engineering culture.

## 3. The 3-stage adoption ladder (tied to actual polytoken needs)

### Stage 1 — Now → ~10k emails / first paying users: **add zero infrastructure**
*Trigger: none — this is current state.*
1. **Keep Postgres as the only data system.** The hand-rolled patterns (append-only + idempotency key, status columns, query-time metric joins) are the correct DE architecture at this scale.
2. **Build the offline eval harness (the one new thing).** A script (TS like `retrieval-miss-rate.ts`, or Python under `apps/email-listener`) that snapshots confirmed `extraction_records` into a versioned eval set (JSONL in repo or Supabase Storage), replays extraction against it, and reports per-field accuracy. Wire into CI as a non-blocking report first. Promptfoo or DeepEval optional wrappers; the dataset-from-SQL part is the value.
3. **Periodic jobs via `pg_cron`/scripts, not an orchestrator.** Miss-rate report weekly; embedding backfill as needed.
4. **Watch two numbers monthly:** corrected-extraction count (fine-tune readiness) and `knowledge_nodes` row count (pgvector headroom — irrelevant until ~10^6).

### Stage 2 — Growth (~10k–500k emails, a few external integrations, eval suite is load-bearing): **adopt point tools, still no platforms**
*Triggers: an analytics query you can't comfortably express/run in Postgres; a second external data source; eval runs becoming a manual chore.*
1. **DuckDB locally** for analytics over `genui_generation_events` / `chat_cost_ledger` / extraction accuracy cohorts, attaching to Postgres read-only; Parquet exports for anything cold.
2. **Polars** in Python scripts for eval-set and (future) training-set preparation.
3. **dlt** for the first true external importer (Gmail backfill, Notion, CRM) instead of hand-rolling incremental cursors.
4. **Eval platform decision:** if human review volume justifies it, self-host Langfuse or trial Braintrust; keep the SQL-generated dataset as the source of truth either way.
5. Still no orchestrator, no lakehouse, no MLflow, no vector DB.

### Stage 3 — Scale / model ownership (~10^6+ rows, ≥1k corrected examples on one task, unit economics pressure): **first training run, first orchestration**
*Triggers: `corrected_fields` count ≥ ~1k on a single extraction task AND Claude API cost or latency is a real constraint on that task; or a multi-step batch graph needs backfills.*
1. **Fine-tune a small open-weights extractor with Unsloth (QLoRA, single rented GPU); TRL if Unsloth doesn't support the chosen base model.** Dataset built by Polars from `extraction_records`; gated by the Stage-1 eval harness (fine-tune ships only if it beats the Claude few-shot baseline on the frozen eval set). Adapters in safetensors on private HF Hub; serve via a managed inference host.
2. **Track runs** in a `fine_tunes` audit table first; adopt MLflow tracking only if training becomes a recurring loop.
3. **Dagster (not Airflow)** only if the batch graph (backfill → embed → synthesize → eval → publish) genuinely needs asset lineage; otherwise stay on pg_cron.
4. **DuckLake/Parquet archive tier** only if Postgres storage costs or analytics contention force it.
5. **pgvector stays** unless embeddings exceed ~10M or re-embedding churn causes bloat — neither plausible at this stage.

**One-line summary of the ladder:** Stage 1 = evals on top of the tables you already have; Stage 2 = DuckDB/Polars/dlt as libraries, not platforms; Stage 3 = one Unsloth fine-tune justified by ≥1k human corrections and gated by the Stage-1 evals. Everything else on the standard DE menu (Spark, Beam, Airflow, Iceberg, vector DBs, MLflow servers) is overkill for a solo founder whose entire dataset fits in one Postgres instance.

## Sources
- https://motherduck.com/learn/duckdb-vs-postgres-embedded-analytics/
- https://github.com/duckdb/pg_duckdb
- https://motherduck.com/blog/pg-duckdb-release/
- https://www.zenml.io/blog/orchestration-showdown-dagster-vs-prefect-vs-airflow
- https://www.getorchestra.io/blog/dagster-vs-prefect-vs-airflow-complete-data-orchestration-comparison-2026
- https://dlthub.com/docs/intro
- https://www.modern-datatools.com/tools/dlthub
- https://dev.to/alexmercedcoder/lakehouse-table-formats-in-2026-iceberg-delta-lake-hudi-paimon-and-ducklake-how-they-work-p1k
- https://endjin.com/blog/introducing-ducklake-lakehouse-architecture-reimagined-modern-era
- https://motherduck.com/blog/ducklake-architecture-deep-dive/
- https://www.instaclustr.com/education/vector-database/pgvector-key-features-tutorial-and-pros-and-cons-2026-guide/
- https://clickhouse.com/resources/engineering/scale-vector-search-postgres
- https://mlflow.org/releases/3
- https://docs.databricks.com/aws/en/mlflow3/genai/
- https://www.marktechpost.com/2026/07/22/unsloth-vs-axolotl-vs-trl-vs-llama-factory-a-fine-tuning-framework-comparison-on-speed-vram-and-multi-gpu/
- https://www.spheron.network/blog/axolotl-vs-unsloth-vs-torchtune/
- https://www.braintrust.dev/articles/best-promptfoo-alternatives-2026
- https://aiml.qa/llm-evaluation-framework-benchmark-2026/
- https://inference.net/content/llm-evaluation-tools-comparison/
- https://datalakehousehub.com/blog/2025-09-2026-guide-to-data-lakehouses/
