# Data Science & Data Engineering — Assessment Lane (2026-07-24)

## What polytoken actually is (grounding, not aspiration)

polytoken is **not** an ML shop. It is an **LLM-driven document/email extraction product**:

- `apps/email-listener/pyproject.toml:*` — the only "AI" dependency is `anthropic>=0.40.0`. No `torch`, `sklearn`, `pandas`, `numpy`, `transformers`, no embeddings client, no vector DB, no `mlflow`/`wandb`. Extraction is Claude + `pypdf` / `pdfminer-six` / `pdf2image` for PDF→text/image, and `jsonschema>=4.26.0` for output validation.
- README: an email-driven "Data-Entry Brain" — inbound email → structured data on a Supabase/Postgres substrate, Next.js chat/canvas on top.
- `packages/capabilities/src/{table,canvas,vetting}.ts` — the value the product produces is *structured records vetted by a human*, not trained models.

**Consequence for this lane:** 90% of the classic "data science / data engineering" toolbox (MLflow, W&B, ClearML, Spark, Beam/Dataflow, feature stores, DVC, fine-tuning pipelines, GPU orchestration) is **enterprise-only or premature** here. The one place data-engineering rigor pays off *immediately* for a solo builder is **measuring extraction quality and LLM cost** — because that is literally the product's core function, and right now there is **zero eval harness in the tree** (grep finds no eval/metrics/golden-dataset scaffolding beyond `jsonschema` validation, which checks *shape*, not *correctness*).

This lane's recommendation is therefore inverted from the naive reading: don't add MLOps infra. Add a **thin extraction-eval + LLM-observability layer**, and keep a DuckDB/Polars analytics escape hatch for ad-hoc questions. Treat everything else as "know it exists, do not adopt."

---

## Tier 1 — Realistically relevant to this solo builder NOW

### 1. Extraction-quality evals (the actual gap) — **highest ROI in this lane**

The product succeeds or fails on "did we pull the right fields off this email/PDF." That is a measurable ML task with a standard metric set, and none of it is in the repo.

- **Metric to adopt (from 2026 extraction literature):** *field-level micro-F1* (per-field precision/recall, exact-match for categoricals, ±tolerance for numerics) plus *document accuracy* (fraction of docs where **every** field is right). This is the standard reported in the 2026 Structured Output Benchmark / ExtractBench work and is trivial to implement against a hand-labeled golden set. Cost/accuracy anchors from the same literature: field-level extraction lands ~95–96% accuracy at ~$0.005–0.05/doc depending on model — useful sanity numbers when you set targets.
- **How to run it (pick ONE, keep it in CI):**
  - **promptfoo** — MIT, runs entirely local, config-as-YAML, purpose-built for "did this prompt/model change regress." Turns prompt edits into CI-gated regression tests; also does red-teaming. *2026 note: acquired by OpenAI (Mar 2026) with a public commitment to stay OSS + model-agnostic — watch that commitment, but the MIT core can't be un-shipped.* **Best fit for a solo builder** who wants a gate, not a platform.
  - **DeepEval** — pytest-style; strongest if you want evals to live *inside* the existing `uv run pytest` suite (which polytoken already runs). Natural because the listener is Python and already has pytest + CI.
  - **Braintrust / LangSmith** — skip. Braintrust is a $249/mo production-quality-loop platform for mixed eng/product teams; LangSmith only earns its keep if you're on LangChain/LangGraph (you're not). Both are overkill for one person.
- **The real work is the dataset, not the tool:** 30–100 hand-labeled email/PDF → expected-JSON pairs. That golden set is the durable asset; the runner is swappable. Build it from real (redacted) inbound mail — but respect the harness guardrail: **do not read raw email content / S3 objects** to assemble it; label from already-extracted records + your own test fixtures.

  **Maturity flag:** promptfoo ownership change (OpenAI) is a real governance risk for a tool you'd wire into CI. DeepEval hedges that — it's a plain library with no acquirer. If you want zero vendor risk, DeepEval-in-pytest is the conservative pick; promptfoo if you value the multi-model comparison UX.

### 2. LLM observability + cost tracking — **second-highest ROI**

You have exactly one paid dependency whose spend scales with usage (Anthropic) and no visibility into per-call cost, latency, or which extractions are failing in prod. This is the data-engineering discipline that matters most for a live product.

- **Langfuse** — leading OSS/self-hostable option; tracing + evals + cost tracking in one, free when self-hosted. Best single choice if you want one box that does traces *and* can host your eval datasets. Python + TS SDKs (covers listener + web).
- **Helicone** — fastest path to *cost* tracking specifically: a proxy in front of the Anthropic call, near-zero code change. Good if all you want this quarter is "how much am I spending and where."
- **Arize Phoenix / OpenLLMetry** — Phoenix is source-available (Elastic License 2.0), OTel-native; OpenLLMetry/Traceloop is the vendor-neutral OTel instrumentation standard that pipes into Grafana/Datadog/whatever you already run. Right answer *if you already have an OTel/observability backend*; otherwise it's more plumbing than a solo builder needs.

  **Recommendation:** Langfuse self-hosted (covers observability *and* doubles as eval-dataset store, collapsing Tier-1 items 1 and 2 into one system), OR Helicone if you only want the cost number this month. Don't run both.

  **Maturity flag:** self-hosting Langfuse adds a Postgres+Clickhouse footprint to babysit. For a solo builder, Langfuse Cloud free tier or Helicone-as-proxy avoids new infra — weigh "another service to operate" against your prod-landmine reality (you already have SES/Terraform drift; adding self-hosted Clickhouse is more surface).

### 3. Ad-hoc analytics on the Postgres substrate — **DuckDB (+ Polars)**

When you want to answer "what's my extraction success rate by sender / field / week," you do **not** want pandas choking on a Supabase dump, and you do **not** want to hand-write reporting SQL against prod.

- **DuckDB** — an analytical DB *inside* a Python script; SQL-first, vectorized, out-of-core (analyzes files bigger than RAM). It reads Postgres directly (`postgres` extension) and Parquet/CSV. For a solo builder this is the single highest-leverage data-eng tool: point it at a read-replica or a nightly dump and answer any question in SQL, zero infra. **Respect the harness guardrail — no direct prod-DB psql; run against a dump/replica, not live prod.**
- **Polars** — Rust-based, lazy, multi-core DataFrames; reach for it when a transform is more DataFrame-shaped than SQL-shaped. Complements DuckDB (many pipelines: DuckDB for prep/SQL, Polars for intermediate transforms).
- **pandas** — keep only for glue/ecosystem interop; it's the "out-of-memory error" tool at any real volume in 2026. Don't build reporting on it.

  **Recommendation:** DuckDB is the default; add Polars only when you hit a DataFrame-shaped transform. Neither is a service — they're libraries, near-zero maintenance risk. This is the safest adoption in the whole lane.

---

## Tier 2 — Know it exists; do NOT adopt yet

| Tool / category | Verdict for polytoken | Why |
|---|---|---|
| **MLflow (3.x)** | Not yet | Experiment/run tracking + model registry. Free OSS, the sane default *if you were training models*. You aren't. Its GenAI-tracing features overlap Langfuse but are weaker for pure LLM apps. Revisit only if you start tuning a Haiku classifier. |
| **Weights & Biases** | No | Best-in-class live training dashboards (loss curves, GPU util) — irrelevant with zero training. Cost trap: teams report $180k/yr bills where MLflow OSS covered 80%. |
| **ClearML** | No | Experiment tracking + orchestration + compute scheduling. Solves problems (remote GPU runs, pipeline orchestration) you don't have as a solo LLM-API builder. |
| **DVC** | No (for now) | Git-for-data / dataset+pipeline versioning. *Marginally* interesting for versioning your eval golden-set — but a folder of JSON in git + a hash does the same at your scale. Adopt only if the golden set grows large/binary. |
| **Spark** | No | Distributed compute for data that doesn't fit one machine. You are nowhere near this; DuckDB out-of-core covers you for years. |
| **Dataflow / Apache Beam** | No | Managed streaming/batch pipelines (GCP-flavored). Enterprise ETL. Your "pipeline" is one FastAPI listener — a durable job queue (you're already eyeing graphile-worker per the task list) is the right tool, not Beam. |
| **Fine-tuning / post-training / weights handling** | **Blocked + not worth it** | Anthropic exposes **no fine-tuning via public API in 2026**; the only path is Claude 3 Haiku SFT on **Amazon Bedrock (us-west-2)**. Worth it *only* for narrow, latency/cost-sensitive classification (200–500 examples) where Haiku pricing beats Sonnet and prompt-caching isn't enough. For an extraction product, **structured prompting + prompt caching + a good eval loop dominates** fine-tuning on ROI. Also: the Jan-2026 constitution refresh means SFT layers on top of a fixed safety prior — you can't override behavior, only nudge it. **Do not go down this road; it's a multi-week detour into AWS for a marginal gain.** |
| **Instructor / structured-output libs** | Maybe (TS side) | `instructor` (Pydantic-based, ~3M downloads/mo) is the popular way to get validated structured output. polytoken already hand-rolls this with `jsonschema` + the Anthropic SDK's tool/JSON mode. Not worth a rewrite; note it as prior art if the validation code gets gnarly. |

---

## Communities / orgs / packages worth following (signal, not noise)

- **Eval/observability:** promptfoo (now under OpenAI — watch governance), Langfuse, Arize (Phoenix + the AI-observability blog), Traceloop/OpenLLMetry (OTel-GenAI semantic conventions — the standard to bet on for vendor-neutrality), DeepEval/Confident AI, RAGAS (only if you add retrieval).
- **Structured extraction:** 567-labs/**instructor** (the reference implementation + community), the 2026 **Structured Output Benchmark / ExtractBench / JSONSchemaBench** line of arXiv work (steal their metric definitions).
- **Local data engineering:** **DuckDB Labs** (MotherDuck ecosystem, but the OSS engine is the thing), **Polars** (fast-moving Rust project — pin versions, API still churns). These two + the "small-data / single-node analytics" movement are the most relevant DE community for a solo builder in 2026.
- **General MLOps (context only):** MLflow (now Linux Foundation-ish governance, GenAI features growing), the "MLOps community" newsletter/slack for landscape awareness — read, don't adopt.

**Maintenance-risk flags to carry:**
- **promptfoo → OpenAI acquisition (Mar 2026):** wiring an OpenAI-owned tool into a Claude product's CI is a governance smell; the MIT core protects you, but prefer DeepEval if you want zero acquirer exposure.
- **Polars API churn:** pin exact versions; it moves fast and breaks minor things.
- **Self-hosted Langfuse = new Clickhouse/Postgres footprint** to operate on top of your existing SES/Terraform surface. For a solo builder, prefer a proxy (Helicone) or hosted free tier over standing up more infra you'll have to babysit.
- **Anthropic fine-tuning is Bedrock-only + capability-limited** — do not architect anything that assumes API-native fine-tuning; it doesn't exist.

---

## Bottom line for the strategy doc

The data-science/data-engineering "opportunity" for polytoken is **not** an MLOps stack — adopting MLflow/W&B/Spark/Beam/DVC/fine-tuning would be pure premature complexity for a one-person LLM-API product. The real, unmet, high-ROI move is a **thin extraction-quality layer that doesn't exist today**:

1. **Golden-set + field-F1 eval in CI** (DeepEval-in-pytest, or promptfoo) — turns "is extraction good?" from vibes into a gated number. *This is the single most valuable addition in this lane.*
2. **LLM cost + trace observability** (Langfuse self-host, or Helicone proxy for cost-only) — you have one spend-scaling dependency and no visibility into it.
3. **DuckDB (+ Polars) for ad-hoc analytics** against a Postgres dump/replica — zero-infra escape hatch, respects the no-prod-psql guardrail.

Everything else in this lane is enterprise-only or blocked-by-Anthropic and should be explicitly *declined* in the plan, not deferred — declining it is the judgment call.

---

### Sources
- [LLM Evaluation Framework Benchmark 2026 (aiml.qa)](https://aiml.qa/llm-evaluation-framework-benchmark-2026/) · [Promptfoo vs DeepEval (genai.qa)](https://genai.qa/blog/promptfoo-vs-deepeval/) · [LLM Evaluation Tools Comparison (inference.net)](https://inference.net/content/llm-evaluation-tools-comparison/)
- [Best LLM Observability Tools 2026 (SigNoz)](https://signoz.io/comparisons/llm-observability-tools/) · [Open Source LLM Observability (OpenObserve)](https://openobserve.ai/blog/llm-observability-tools/) · [Best LLM Observability Tools (Firecrawl)](https://www.firecrawl.dev/blog/best-llm-observability-tools)
- [Pandas vs Polars vs DuckDB 2026 (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2026/05/pandas-vs-polars-vs-duckdb/) · [DuckDB vs DataFrame libs benchmark (codecentric)](https://www.codecentric.de/en/knowledge-hub/blog/duckdb-vs-dataframe-libraries)
- [MLflow vs W&B vs DVC 2026 (TechPlained)](https://www.techplained.com/mlflow-vs-wandb-vs-dvc) · [ClearML vs MLflow vs W&B (Slashdot)](https://slashdot.org/software/comparison/ClearML-vs-MLflow-vs-Weights-Biases/)
- [The Structured Output Benchmark (arXiv 2604.25359)](https://arxiv.org/html/2604.25359v1) · [Instructor (567-labs)](https://github.com/567-labs/instructor)
- [Claude Fine-Tuning Patterns on Bedrock 2026 (callsphere)](https://callsphere.ai/blog/vw8g-anthropic-claude-fine-tuning-patterns-bedrock-2026) · [Prompt engineering best practices (Anthropic)](https://claude.com/blog/best-practices-for-prompt-engineering)
