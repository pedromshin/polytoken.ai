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
    APP_NAME: str = "Nauta Email Listener"
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

    # --- Tenant (single-tenant for now; D-05 keeps rows importer-scoped) ---
    DEFAULT_IMPORTER_ID: str = "00000000-0000-0000-0000-000000000001"

    # --- GenUI generation layer (D-04, D-05, D-16, D-17) ---
    GENUI_MODEL_ID: str = ""  # quarantine (Call A) + generator (Call B) primary model
    GENUI_ESCALATION_MODEL_ID: str = ""  # generator escalation on attempt 3 (D-05)
    GENUI_TIMEOUT_SECONDS: float = 15.0  # per-call asyncio.timeout (D-17)
    GENUI_QUARANTINE_MAX_TOKENS: int = 1024  # Call A max_tokens (D-16)
    GENUI_GENERATOR_MAX_TOKENS: int = 3000  # Call B (declarative spec) max_tokens (D-16)

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
