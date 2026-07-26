"""
Application settings hierarchy.

BaseAppSettings -> DevSettings / StagingSettings / ProdSettings
AWS Secrets Manager JSON envelope parsing preserved for production.
"""

from __future__ import annotations

import json
import os
from enum import StrEnum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Default Bedrock Claude model id (overridable via BEDROCK_MODEL_ID env var).
# Uses the inference-profile id for Claude on Bedrock; pin/upgrade via env.
# claude-sonnet-4-6 is the active profile verified on account 271369143207;
# the prior claude-sonnet-4-20250514 id is legacy.
DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6"

# GenUI generation layer model IDs (D-04, D-05)
DEFAULT_GENUI_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
DEFAULT_GENUI_ESCALATION_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
# Code-island (Phase 20/21) emits ARBITRARY UI code — quality- and size-critical, low-volume,
# NOT cacheable. So it defaults to Sonnet (design quality + reliable tool-calling), NOT Haiku,
# with a much larger token budget (a full custom design far exceeds the compact-spec budget).
DEFAULT_GENUI_CODE_MODEL_ID = "us.anthropic.claude-sonnet-4-6"
DEFAULT_GENUI_CODE_ESCALATION_MODEL_ID = "us.anthropic.claude-sonnet-4-6"


def parse_secret_value(value: str | None, key: str, environment: str) -> str:
    """Extract a value from an AWS Secrets Manager JSON envelope.

    Always strips leading/trailing whitespace to prevent mismatches
    caused by trailing newlines in .env files or Docker secrets.
    """
    if not value:
        return ""
    value = value.strip()
    if environment.lower() in ("production", "staging") and value.startswith("{"):
        try:
            extracted = json.loads(value).get(key, value)
            return extracted.strip() if isinstance(extracted, str) else str(extracted)
        except json.JSONDecodeError:
            pass
    return value


class Environment(StrEnum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class BaseAppSettings(BaseSettings):
    """Shared settings for all environments."""

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Application ---
    APP_NAME: str = "Polytoken Email Listener"
    APP_VERSION: str = "0.1.0"
    ENVIRONMENT: Environment = Environment.DEVELOPMENT
    DEBUG: bool = False

    # --- Server ---
    HOST: str = "0.0.0.0"  # nosec B104 — container requires binding to all interfaces
    PORT: int = 8000

    # --- Logging ---
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = False

    # --- Security ---
    API_KEY: str = ""
    API_KEY_HEADER: str = "X-API-Key"

    # --- Supabase ---
    SUPABASE_URL: str = ""
    SUPABASE_SECRET_KEY: str = ""  # new-format sb_secret_... key injected by ECS from Secrets Manager

    # --- AWS Bedrock (Claude transport; auth via ECS task IAM role, no secret) ---
    BEDROCK_REGION: str = ""  # defaults to the task region via property; e.g. us-east-1
    BEDROCK_MODEL_ID: str = ""  # overridable; defaults to current Claude model on Bedrock

    # --- AWS ---
    AWS_TEXTRACT_REGION: str = "us-east-1"

    # --- SES inbound (raw MIME store; auth via IAM role / default chain) ---
    SES_S3_BUCKET: str = "nauta-services-ses-inbound-emails"
    SES_S3_REGION: str = ""  # defaults to AWS_TEXTRACT_REGION

    # --- Attachments (Supabase Storage) ---
    ATTACHMENTS_BUCKET: str = "email-attachments"

    # --- Backfilled raw MIME (Supabase Storage; SES S3 is read-only for the task role) ---
    RAW_EMAILS_BUCKET: str = "raw-emails"

    # --- Tenant (single-tenant for now; D-05 keeps rows importer-scoped) ---
    DEFAULT_IMPORTER_ID: str = "00000000-0000-0000-0000-000000000001"

    # --- GenUI generation layer (D-04, D-05, D-16, D-17) ---
    GENUI_MODEL_ID: str = ""  # quarantine (Call A) + generator (Call B) primary model
    GENUI_ESCALATION_MODEL_ID: str = ""  # generator escalation on attempt 3 (D-05)
    GENUI_TIMEOUT_SECONDS: float = 15.0  # per-call asyncio.timeout (D-17)
    GENUI_QUARANTINE_MAX_TOKENS: int = 1024  # Call A max_tokens (D-16)
    GENUI_GENERATOR_MAX_TOKENS: int = 3000  # Call B (declarative spec) max_tokens (D-16)
    # Plan 52-05 (PANL-04): one-shot NL re-theme resolution — output is tiny
    # (a style_pack_id + at most 5 short token_overrides values), mirrors
    # GENUI_CODE_JUDGE_MAX_TOKENS's "judge output is small" sizing rationale.
    GENUI_RETHEME_MAX_TOKENS: int = 512

    # --- Code-island (Phase 20/21) — dedicated, larger tier for arbitrary UI code ---
    GENUI_CODE_MODEL_ID: str = ""  # primary (attempts 1-2); default Sonnet
    GENUI_CODE_ESCALATION_MODEL_ID: str = ""  # escalation (attempt 3); default Sonnet (set Opus via env if provisioned)
    GENUI_CODE_MAX_TOKENS: int = 8000
    # The code-island adapter STREAMS (rescheduling the deadline on every event), so this is an
    # INACTIVITY timeout — max seconds between stream events — NOT a total-time cap. A slow but
    # steady multi-minute generation completes; only a genuinely stalled stream fails. 90s is
    # very forgiving (Bedrock streams deltas sub-second when healthy).
    GENUI_CODE_TIMEOUT_SECONDS: float = 90.0

    # --- Chat spine (Phase 22) — multi-provider streaming (D-22, D-24) ---
    # Both server adapters STREAM (rescheduling the deadline on every event, same
    # idiom as the code-island adapter above), so this is an INACTIVITY timeout —
    # max seconds between stream events — NOT a total-time cap.
    CHAT_INACTIVITY_TIMEOUT_SECONDS: float = 90.0
    # OpenRouter transport (D-07) — server-side only; NEVER exposed to the client
    # (no client-visible-prefixed env var here; read only via the openrouter_api_key
    # property below, T-22-06).
    OPENROUTER_API_KEY: str = ""
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api/v1"

    # --- Cost circuit breaker (Phase 22-04, STREAM-03, FOUND-3, D-20/D-21) ---
    # A general budget ledger cap set — drawn on by chat (and later studio/agents),
    # not a chat-shaped guard. Raising a cap is a settings/env change; there is no
    # in-request parameter that can relax them (D-21).
    COST_CAP_PER_TURN_USD: float = 0.50
    COST_CAP_PER_SESSION_USD: float = 2.00
    COST_CAP_PER_DAY_USD: float = 5.00
    # COST-05 (Phase 35): a DISTINCT per-round ceiling — checked at tool-round
    # boundaries/mid-round — NOT a per-turn/session/day cap.
    COST_CAP_PER_ROUND_USD: float = 0.15

    # --- search_knowledge exposure gate (Phase 37, synthesis P6 rule) ---
    # The SearchKnowledgeExecutor and its full test suite exist regardless of this
    # flag; only container.py's production wiring reads it, gating whether
    # search_knowledge is ever offered to a real chat turn. Phase 38 (Plan 38-02,
    # QUAR-02) flipped the default to True after the full deterministic
    # adversarial-fixture suite (tests/evals/, 20-30 fixtures across 7
    # categories against the real wired executors) passed in the same
    # execution run (SC5 exposure gate) — the flag remains a real,
    # working kill-switch: SEARCH_KNOWLEDGE_TOOL_ENABLED=false still
    # structurally omits the tool. Plain bool field (no @property wrapper) —
    # mirrors ANTICIPATORY_PROMPTING_ENABLED's un-wrapped convention.
    SEARCH_KNOWLEDGE_TOOL_ENABLED: bool = True

    # --- web_search exposure gate (Phase 54, CLUS-03, T-54-02-04) ---
    # Same code-gated-exposure discipline as SEARCH_KNOWLEDGE_TOOL_ENABLED
    # above: WebSearchExecutor + its full test suite (incl. the 10-fixture
    # adversarial injection suite, tests/evals/test_web_search_injection_suite.py)
    # exist regardless of this flag; only container.py's production wiring
    # reads it. Flipped to True in THIS SAME execution run because the
    # adversarial suite passed against the real wired executor (54-02-PLAN.md's
    # exposure-gate rule, mirroring "Phase 38 flips the default after the
    # adversarial fixture suite passes"). Plain bool field (no @property
    # wrapper) -- mirrors SEARCH_KNOWLEDGE_TOOL_ENABLED's own convention.
    WEB_SEARCH_TOOL_ENABLED: bool = True

    # --- deep_research exposure gate (Phase 69, RSRCH-01) ---
    # Same code-gated-exposure discipline as the two flags above: the
    # DeepResearch loop + DeepResearchToolExecutor and their test suite
    # (app/application/use_cases/research/) exist regardless of this flag;
    # only container.py's production wiring reads it, gating whether
    # deep_research is ever offered to a real chat turn. Defaults True —
    # the loop is fail-closed by construction (ResearchBudget hard-caps
    # tokens AND rounds; an aborted run returns only already-verified
    # claims), so the flag is a kill-switch, not a quarantine. Setting
    # RESEARCH_TOOL_ENABLED=false structurally omits the capability from
    # the registry (never mutation). Plain bool field (no @property
    # wrapper) -- mirrors WEB_SEARCH_TOOL_ENABLED's own convention.
    RESEARCH_TOOL_ENABLED: bool = True

    # --- Canvas emit chat-tool exposure gate (Phase 73 Wave A, default OFF) ---
    # Two NEW model-callable chat tools (emit_canvas_node / emit_canvas_connect)
    # let the chat agent DRAW on the canvas by appending canvas_add_node /
    # canvas_connect message parts -- mirroring the emit_ui_spec emit-a-part
    # path EXACTLY (no server executor, no registry, no SES/mail/S3/Lambda
    # touch). Defaults OFF (fail-closed) so merging this into the LIVE mail
    # receiver is safe: the tools are structurally ABSENT from the model's tool
    # offer until this flag is explicitly set. Only chat_turn_providers.py's
    # wiring reads it (structural omission of the emit_canvas_tools tuple when
    # off -- never mutation). Mirrors INGEST_ENQUEUE_ENABLED's default-OFF
    # cutover convention (plain bool, no @property wrapper).
    CANVAS_EMIT_TOOL_ENABLED: bool = False

    # --- Chat turn agent (Phase 22-06, SEAM-04) ---
    # Hard cap on generated tokens for a single chat turn (always set, no implicit
    # default — required by the ChatProvider.stream contract).
    # 4096 truncated large emit_ui_spec tool calls mid-JSON (stream stops at the cap,
    # json.loads fails at finalize, the widget part is dropped) — found live 2026-07-06
    # on a "generate everything you can" prompt with 10k input tokens. 12000 gives a
    # full-page spec ~3x headroom while staying well under the $0.50 per-turn cost cap.
    CHAT_MAX_OUTPUT_TOKENS: int = 12000

    # --- Code-island parallel multi-candidate + judge (Phase 21) ---
    # N candidates generated CONCURRENTLY (varied temperature) then an LLM judge picks the best.
    # Same wall-clock as one generation (asyncio.gather), N-times the tokens, higher quality.
    # COST-CONSERVATIVE DEFAULTS: 2 candidates (set 1 to disable fan-out) + a Haiku judge (ranking
    # doesn't need Sonnet and Haiku input pricing is far cheaper for reading N candidate bodies).
    GENUI_CODE_CANDIDATES: int = 2
    GENUI_CODE_JUDGE_MODEL_ID: str = ""  # judge model; default Haiku (cheap)
    GENUI_CODE_JUDGE_MAX_TOKENS: int = 512  # judge output is tiny (best_index + reason)

    # --- Ingest-time entity resolution (AI-03) ---
    # Gates the post-persist ResolveIngestEntitiesUseCase stage: resolve the
    # email's classified entity regions against the identity corpus and propose
    # pending candidate links + suggested-tier knowledge edges (suggest-only,
    # human-gated). Default True (the vision's "AI establishes relationships
    # automatically"); set INGEST_ENTITY_RESOLUTION_ENABLED=false to turn the
    # stage OFF without a code change — the container then injects None and the
    # ingest pipeline structurally omits the stage (never a mutation). The use
    # case + its test suite exist regardless of this flag; only container.py's
    # wiring reads it. Plain bool field (no @property wrapper) — mirrors
    # SEARCH_KNOWLEDGE_TOOL_ENABLED's convention.
    INGEST_ENTITY_RESOLUTION_ENABLED: bool = True

    # --- Ingest cost cap (A1 — mail-bomb blast-radius limiter) ---
    # The cost circuit breaker gates only the CHAT path; the ingest pipeline
    # (segmentation / entity-type suggestion / entity resolution / embeddings) is
    # unmetered, so a flood of mail at a forwarding address is unbounded LLM spend
    # — a company-ending risk for a solo operator. When enabled, IngestBudgetGuard
    # caps how many emails PER IMPORTER PER UTC DAY receive the expensive
    # enrichment (counted on the server-stamped created_at, not sender-controlled
    # received_at). Past the cap the raw email STILL persists — only enrichment is
    # skipped, and the email finalizes 'degraded' with an ingest_cost_capped reason
    # (nothing is silently lost; reprocess re-enriches later). Fail-OPEN by design
    # (the guard never caps legitimate mail on a count error — see the service
    # docstring). Default OFF: flag-off is a byte-for-byte no-op (the container
    # injects None and the pipeline structurally omits the guard, mirroring
    # INGEST_ENTITY_RESOLUTION_ENABLED). The guard + its tests exist regardless of
    # the flag; only container wiring reads it.
    INGEST_DAILY_COST_CAP_ENABLED: bool = False
    # Emails per importer per UTC day past which enrichment is skipped. A generous
    # ceiling: a real prosumer rarely forwards this many/day, but it bounds a flood.
    INGEST_DAILY_EMAIL_CAP: int = 500

    # --- Durable ingestion cutover (Track 3a) ---
    # When True, the SNS receiver ENQUEUES a durable `ingest_inbound_email` job
    # (a {ses_message_id, recipients} pointer) via the JobEnqueuer instead of
    # running the heavy S3+MIME+OCR+Bedrock pipeline inline, and returns 500 on a
    # failed enqueue so SNS retries — strictly safer than today's silent-200 loss.
    # Default False: flag-OFF preserves the exact current inline path byte-for-byte.
    # The reversible cutover switch (flip without a redeploy); the worker that
    # drains the queue is deployed separately (Part B). Mirrors the plain-bool
    # convention of INGEST_ENTITY_RESOLUTION_ENABLED, but defaults OFF (a cutover,
    # not an always-on feature).
    INGEST_ENQUEUE_ENABLED: bool = False

    # --- Ingest fast-200 background bridge (no-infra stopgap vs. the durable worker) ---
    # CLAUDE.md landmine: the SNS handler runs ingest INLINE (await execute) then returns
    # 200. Heavy PDF emails enrich for minutes (hundreds of Bedrock calls), so SNS's ~15s
    # HTTP-delivery timeout fires and SNS RETRIES — re-running the full enrichment 2-3x per
    # email (wasted Bedrock spend) and leaving the UI at 'received' for minutes. The proper
    # fix is the durable worker (INGEST_ENQUEUE_ENABLED above), but that needs the
    # graphile-worker runtime provisioned. This is the NO-INFRA bridge: when this flag is ON
    # AND enqueue is OFF, the inline path SCHEDULES ingest as a FastAPI BackgroundTask and
    # returns 200 immediately so SNS gets its ack in <1s — no retry storm, no duplicate
    # enrichment. Default OFF = the exact current inline behavior byte-for-byte (await
    # execute, then INGEST_INLINE_RETRY_ON_FAILURE's 500-on-failure semantics). The accepted
    # tradeoff vs. the durable worker: a container restart mid-task loses the enrichment (the
    # email stays 'received' → reprocess / A2 recover). No effect while INGEST_ENQUEUE_ENABLED
    # is ON (the enqueue path already returns fast). Plain bool field (no @property wrapper) —
    # mirrors INGEST_ENQUEUE_ENABLED's default-OFF cutover convention.
    INGEST_BACKGROUND_ENABLED: bool = False

    # --- Inline ingest fail-loud (A2 — the no-worker silent-loss stopgap) ---
    # CLAUDE.md landmine: the SNS handler returns 200 on ANY inline ingest failure,
    # so a failure on the pre-persist critical path (S3 fetch / MIME parse / importer
    # resolve / email save — the "received but never even stored" cases) silently and
    # PERMANENTLY loses the mail (SNS never retries a 200). The durable fix is the
    # INGEST_ENQUEUE_ENABLED path above, but that needs the graphile-worker runtime
    # provisioned. Until then, this flag makes the INLINE path return 500 on such a
    # failure so SNS RETRIES — ingestion is idempotent (keyed on importer+message_id,
    # deterministic attachment ids, upserts), so a retry re-runs safely. Parse
    # failures still return 200 (a malformed envelope is permanent — no retry storm).
    # Default OFF preserves the exact pre-existing silent-200 behavior byte-for-byte.
    INGEST_INLINE_RETRY_ON_FAILURE: bool = False

    # --- SNS inbound authenticity (Track 4 S1 — SSRF + forgery hardening) ---
    # The /v1/emails/inbound-sns endpoint is unauthenticated (SNS cannot send an
    # X-API-Key). Two independent controls guard it:
    #   1. SubscribeURL / SigningCertURL host-pinning to sns.<region>.amazonaws.com
    #      (infrastructure/sns/verification.is_sns_host) is applied UNCONDITIONALLY
    #      by the handler — it closes the SSRF with zero false-positive risk (a real
    #      AWS URL always matches) and is deliberately NOT gated by a flag.
    #   2. Full AWS SNS message-signature verification, gated by the two flags below.
    # SNS_VERIFY_SIGNATURE (default True): verify every SubscriptionConfirmation /
    # Notification signature and LOG the outcome (`sns_signature_invalid` on failure).
    # On its own it NEVER rejects a message — so a verifier bug cannot drop live mail;
    # it only produces the telemetry that proves genuine AWS traffic verifies cleanly.
    SNS_VERIFY_SIGNATURE: bool = True
    # SNS_SIGNATURE_ENFORCED (default False): once the logs above are confirmed clean,
    # flip this True to actually REJECT (HTTP 403) any message whose signature fails —
    # the reversible cutover from observe to enforce. No effect while VERIFY is False.
    SNS_SIGNATURE_ENFORCED: bool = False

    # --- Anticipatory prompting SPIKE (Phase 25, ANTIC-01/02) ---
    # D-12: single global off switch. When False, run_triggers short-circuits to []
    # before any trigger evaluates — zero candidates produced, pipeline fully dark.
    # This is the ONE flag that gates the whole spike; every other field below is a
    # tunable that only matters once this is flipped True.
    ANTICIPATORY_PROMPTING_ENABLED: bool = False
    # Trigger-layer (D-04) idle threshold: seconds of inactivity after a settled
    # genui turn before the idle_after_genui trigger fires. 45s chosen (Claude's
    # discretion) to be long enough that a user mid-read isn't interrupted, short
    # enough to still feel "anticipatory" rather than stale.
    ANTICIPATORY_IDLE_THRESHOLD_SECONDS: float = 45.0
    # Appropriateness-eval (D-07) threshold: candidates scoring below this on the
    # 0-1 LLM-judge rubric are suppressed. 0.75 is deliberately conservative/high —
    # D-07 says bias hard toward NOT prompting, since false-positive prompting is
    # the spike's documented primary risk.
    ANTICIPATORY_APPROPRIATENESS_THRESHOLD: float = 0.75
    ANTICIPATORY_JUDGE_MODEL_ID: str = ""  # empty -> resolves to DEFAULT_GENUI_MODEL_ID (Haiku, D-09)
    ANTICIPATORY_JUDGE_MAX_TOKENS: int = 256  # judge output is a tiny score+reason, mirrors GENUI_CODE_JUDGE_MAX_TOKENS
    ANTICIPATORY_JUDGE_TIMEOUT_SECONDS: float = 30.0
    # Frequency cap (D-10): at most 1 proactive prompt per conversation per short
    # window, AND a per-conversation daily ceiling. Both must independently allow
    # a candidate through (D-08 — eval and cap are separate checks).
    ANTICIPATORY_CAP_PER_WINDOW: int = 1
    ANTICIPATORY_CAP_WINDOW_MINUTES: int = 10
    ANTICIPATORY_CAP_PER_DAY: int = 3

    # --- Self-assembling morning board (Phase 74, MORN-02/06) ---
    # The single global off switch for the overnight home-board assembly, sibling
    # to ANTICIPATORY_PROMPTING_ENABLED above and mirroring its posture EXACTLY.
    # When False (the default), the /v1/home/assemble-job route SHIPS DARK: the
    # AssembleMorningBoardUseCase short-circuits before it composes a snapshot or
    # touches the home canvas — it composes NOTHING and writes NOTHING (a genuine
    # kill-switch, structural, never a mutation). The route still EXISTS (so the
    # worker's re-entry contract is stable) and returns a 200 no-op. This lets the
    # whole feature merge into the LIVE mail receiver with zero behavioral change
    # until it is explicitly flipped True per-tester. The composer + writer + their
    # test suites exist regardless of this flag; only the composition provider reads
    # it (passed as the use case's `enabled` param). Plain bool field (no @property
    # wrapper) -- mirrors ANTICIPATORY_PROMPTING_ENABLED's own convention.
    MORNING_BOARD_ENABLED: bool = False

    @property
    def api_key(self) -> str:
        return parse_secret_value(self.API_KEY, "API_KEY", self.ENVIRONMENT.value)

    @property
    def supabase_url(self) -> str:
        return parse_secret_value(self.SUPABASE_URL, "SUPABASE_URL", self.ENVIRONMENT.value)

    @property
    def supabase_secret_key(self) -> str:
        return parse_secret_value(self.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY", self.ENVIRONMENT.value)

    @property
    def bedrock_region(self) -> str:
        """Region for Bedrock InvokeModel calls; falls back to the Textract region."""
        return (self.BEDROCK_REGION or self.AWS_TEXTRACT_REGION).strip()

    @property
    def ses_s3_region(self) -> str:
        """Region for the SES inbound S3 bucket; falls back to the Textract region."""
        return (self.SES_S3_REGION or self.AWS_TEXTRACT_REGION).strip()

    @property
    def ses_s3_prefix(self) -> str:
        """Object key prefix SES writes under for this environment (see infrastructure/aws/ses.tf)."""
        prefixes = {
            Environment.DEVELOPMENT: "inbound/local/",
            Environment.STAGING: "inbound/staging/",
            Environment.PRODUCTION: "inbound/prod/",
        }
        return prefixes[self.ENVIRONMENT]

    @property
    def bedrock_model_id(self) -> str:
        """Bedrock Claude model id; overridable via env, sensible default otherwise."""
        return (self.BEDROCK_MODEL_ID or DEFAULT_BEDROCK_MODEL_ID).strip()

    @property
    def genui_model_id(self) -> str:
        """Primary model for GenUI quarantine (Call A) and generator (Call B, attempts 1-2)."""
        return (self.GENUI_MODEL_ID or DEFAULT_GENUI_MODEL_ID).strip()

    @property
    def genui_escalation_model_id(self) -> str:
        """Escalation model for GenUI generator on attempt 3 (D-05)."""
        return (self.GENUI_ESCALATION_MODEL_ID or DEFAULT_GENUI_ESCALATION_MODEL_ID).strip()

    @property
    def genui_code_model_id(self) -> str:
        """Primary model for the code-island generator (arbitrary UI code; default Sonnet)."""
        return (self.GENUI_CODE_MODEL_ID or DEFAULT_GENUI_CODE_MODEL_ID).strip()

    @property
    def genui_code_escalation_model_id(self) -> str:
        """Escalation model for the code-island generator on attempt 3."""
        return (self.GENUI_CODE_ESCALATION_MODEL_ID or DEFAULT_GENUI_CODE_ESCALATION_MODEL_ID).strip()

    @property
    def genui_code_judge_model_id(self) -> str:
        """Model for the code-island candidate judge (ranks N candidates; default Haiku — cheap)."""
        return (self.GENUI_CODE_JUDGE_MODEL_ID or DEFAULT_GENUI_MODEL_ID).strip()

    @property
    def openrouter_api_key(self) -> str:
        """OpenRouter API key (T-22-06 — server-side only, never client-exposed)."""
        return parse_secret_value(self.OPENROUTER_API_KEY, "OPENROUTER_API_KEY", self.ENVIRONMENT.value)

    @property
    def anticipatory_judge_model_id(self) -> str:
        """Model for the anticipatory appropriateness judge (D-07/D-09; default Haiku — cheap)."""
        return (self.ANTICIPATORY_JUDGE_MODEL_ID or DEFAULT_GENUI_MODEL_ID).strip()


class DevSettings(BaseAppSettings):
    ENVIRONMENT: Environment = Environment.DEVELOPMENT
    DEBUG: bool = True


class StagingSettings(BaseAppSettings):
    ENVIRONMENT: Environment = Environment.STAGING
    LOG_JSON: bool = True


class ProdSettings(BaseAppSettings):
    ENVIRONMENT: Environment = Environment.PRODUCTION
    LOG_JSON: bool = True


_SETTINGS_BY_ENV: dict[str, type[BaseAppSettings]] = {
    "development": DevSettings,
    "staging": StagingSettings,
    "production": ProdSettings,
}


@lru_cache
def get_settings() -> BaseAppSettings:
    environment = os.getenv("ENVIRONMENT", "development").lower()
    settings_cls = _SETTINGS_BY_ENV.get(environment, DevSettings)
    return settings_cls()
