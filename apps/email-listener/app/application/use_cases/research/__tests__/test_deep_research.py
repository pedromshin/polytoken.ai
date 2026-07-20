"""Tests for DeepResearch — the bounded multi-round research loop (Phase 69 / RSRCH-01).

RED (this file) exercises the loop through FAKE ports only — no Bedrock, no
web_search infra — mirroring the fake-double convention of
test_evaluate_anticipatory_candidates.py (application-layer tests define their
doubles LOCALLY, never importing app.infrastructure, to stay lint-imports-clean).

The four things this proves (Phase 69 acceptance):
  1. the multi-round loop actually runs (>1 search dispatch, plan->...->synthesize);
  2. the adversarial-verify step can REJECT a claim (kept != drafted);
  3. the output shape scores under the REAL RSRCH-05 rubric
     (`scripts/research_eval/rubric.py`) — RSRCH-05 measures RSRCH-01;
  4. the cost ceiling aborts the run FAIL-CLOSED (no fabricated claims past the cap).
"""

from __future__ import annotations

import json
from typing import Any

import pytest

# The REAL rubric — importing it here (a test, not app source) is how we prove
# the report shape scores directly. run_eval.py imports it the same way.
from scripts.research_eval.rubric import score_research_run

# The app-source loop under test.
from app.application.use_cases.research.deep_research import (
    Claim,
    DeepResearch,
    ResearchBudget,
    ResearchReport,
    Source,
    build_deep_research_tool,
    define_research_capability,
)
from app.domain.ports.chat_provider import StreamEnd, TextDelta, UsageDelta
from app.domain.ports.tool_executor import MAX_TOOL_OUTPUT_CHARS, ToolExecutionResult

_MODEL_ID = "test-model"
_IMPORTER = "importer-abc"


# ---------------------------------------------------------------------------
# Fake ports (defined locally — application-layer test, no infra import).
# ---------------------------------------------------------------------------


class FakeChatProvider:
    """Scripted ChatProvider: dispatches a canned JSON reply by matching the phase
    tag baked into each step's system prompt, and emits a UsageDelta per call.

    Matching on the phase word (PLAN/DRAFT/VERIFY/SYNTHESIZE) rather than call
    order keeps the fake robust to the loop reordering its steps.
    """

    def __init__(self, replies: dict[str, str], *, usage_per_call: int = 100) -> None:
        self._replies = replies
        self._usage = usage_per_call
        self.calls: list[str] = []

    def _phase_for(self, system: str) -> str:
        for tag in ("PLAN", "DRAFT", "ADVERSARIAL-VERIFY", "SYNTHESIZE"):
            if tag in system:
                return tag
        return ""

    async def stream(
        self,
        *,
        model_id: str,
        system: str | list[dict[str, Any]],
        messages: Any,
        tools: Any = (),
        max_tokens: int,
        temperature: float = 1.0,
    ):
        del model_id, messages, tools, max_tokens, temperature
        phase = self._phase_for(system if isinstance(system, str) else "")
        self.calls.append(phase)
        yield TextDelta(text=self._replies.get(phase, "{}"))
        yield UsageDelta(input_tokens=self._usage, output_tokens=self._usage)
        yield StreamEnd(stop_reason="end_turn")


class FakeSearchExecutor:
    """Scripted ToolExecutor returning a web_search-shaped envelope per query.

    Records every (query, importer_id) so the test can assert multi-round
    dispatch AND that the tenant id is threaded through unchanged.
    """

    def __init__(self, envelopes: list[dict[str, Any]]) -> None:
        self._envelopes = envelopes
        self.calls: list[tuple[str, str]] = []

    async def execute(self, *, name: str, arguments: dict[str, Any], importer_id: str) -> ToolExecutionResult:
        del name
        index = len(self.calls)
        self.calls.append((str(arguments.get("query", "")), importer_id))
        envelope = self._envelopes[index] if index < len(self._envelopes) else {"mode": "web_search", "results": []}
        return ToolExecutionResult(tool_use_id="", content=json.dumps(envelope), is_error=False)


class _EventSink:
    """Collects emitted ChatRunEvents for assertions."""

    def __init__(self) -> None:
        self.events: list[Any] = []

    async def __call__(self, event: Any) -> None:
        self.events.append(event)


# ---------------------------------------------------------------------------
# Fixtures / builders
# ---------------------------------------------------------------------------


def _envelope(*hits: dict[str, str]) -> dict[str, Any]:
    return {"mode": "web_search", "results": list(hits)}


def _good_replies() -> dict[str, str]:
    """Scripted replies for a healthy run: 2 queries, 2 drafted claims, both verified supported."""
    return {
        "PLAN": '{"sub_questions": ["what", "why"], "queries": ["rubric judge reliability", "calibration anchors"]}',
        "DRAFT": (
            '{"claims": ['
            '{"text": "A reliable LLM-as-judge uses a scored rubric with explicit dimensions.", "source_ids": ["s1"]},'
            '{"text": "The judge must be calibrated against human labels.", "source_ids": ["s2"]}'
            "]}"
        ),
        "ADVERSARIAL-VERIFY": (
            '{"verdicts": ['
            '{"claim_index": 0, "supported": true, "reason": "excerpt states rubric dimensions"},'
            '{"claim_index": 1, "supported": true, "reason": "excerpt states calibration"}'
            "]}"
        ),
        "SYNTHESIZE": '{"report": "A reliable judge combines a scored rubric with calibration against human labels."}',
    }


def _two_envelopes() -> list[dict[str, Any]]:
    return [
        _envelope({"title": "Rubric design", "url": "https://ex.com/rubric", "snippet": "A rubric scores explicit dimensions rather than a single vibe score."}),
        _envelope({"title": "Calibration", "url": "https://ex.com/calibrate", "snippet": "Judges must be calibrated against human labels and anchors."}),
    ]


# ---------------------------------------------------------------------------
# 1. The multi-round loop actually runs.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_multi_round_loop_runs_all_phases() -> None:
    chat = FakeChatProvider(_good_replies())
    search = FakeSearchExecutor(_two_envelopes())
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)
    sink = _EventSink()

    report = await loop.run(question="What makes an LLM judge reliable?", importer_id=_IMPORTER, question_id="q1", emit=sink)

    # More than one search round dispatched — this is a multi-round loop, not a single pass.
    assert len(search.calls) == 2
    assert [q for q, _ in search.calls] == ["rubric judge reliability", "calibration anchors"]
    # Tenant id threaded through every dispatch unchanged.
    assert {imp for _, imp in search.calls} == {_IMPORTER}
    # All four LLM phases ran, in order.
    assert chat.calls == ["PLAN", "DRAFT", "ADVERSARIAL-VERIFY", "SYNTHESIZE"]
    # Two verified claims, each resolving to a gathered source; a non-empty body.
    assert len(report.claims) == 2
    assert report.report
    assert not report.aborted
    assert report.rounds_used == 2
    # Progress streamed as run events reusing the existing shapes.
    types = [e.type for e in sink.events]
    assert types[0] == "started"
    assert types.count("server_tool_call") == 2
    assert types.count("server_tool_result") == 2
    assert types[-1] == "completed"


# ---------------------------------------------------------------------------
# 2. The adversarial-verify step can REJECT a claim.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verify_step_rejects_unsupported_claim() -> None:
    replies = _good_replies()
    # Verifier now rejects claim 1 (unsupported) and keeps claim 0.
    replies["ADVERSARIAL-VERIFY"] = (
        '{"verdicts": ['
        '{"claim_index": 0, "supported": true, "reason": "supported"},'
        '{"claim_index": 1, "supported": false, "reason": "excerpt does not state this"}'
        "]}"
    )
    chat = FakeChatProvider(replies)
    search = FakeSearchExecutor(_two_envelopes())
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    report = await loop.run(question="What makes an LLM judge reliable?", importer_id=_IMPORTER, question_id="q1")

    # Exactly one claim survived; the rejected one is recorded, not silently dropped.
    assert len(report.claims) == 1
    assert report.claims[0].source_ids == ("s1",)
    assert len(report.rejected_claims) == 1
    assert "calibrated" in report.rejected_claims[0].text
    # The rejected claim's source is not carried into the report (only cited sources remain).
    assert {s.id for s in report.sources} == {"s1"}


@pytest.mark.asyncio
async def test_verify_rejects_claim_with_only_dangling_citation() -> None:
    """A claim the verifier 'supports' but whose only citation does not resolve is still rejected (fail-closed)."""
    replies = _good_replies()
    replies["DRAFT"] = '{"claims": [{"text": "A dangling claim.", "source_ids": ["s99"]}]}'
    replies["ADVERSARIAL-VERIFY"] = '{"verdicts": [{"claim_index": 0, "supported": true, "reason": "yes"}]}'
    chat = FakeChatProvider(replies)
    search = FakeSearchExecutor(_two_envelopes())
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    report = await loop.run(question="q", importer_id=_IMPORTER, question_id="q1")

    assert report.claims == ()
    assert len(report.rejected_claims) == 1


# ---------------------------------------------------------------------------
# 3. The output shape scores under the REAL RSRCH-05 rubric.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_output_scores_under_the_real_rubric() -> None:
    chat = FakeChatProvider(_good_replies())
    search = FakeSearchExecutor(_two_envelopes())
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    report = await loop.run(question="What makes an LLM judge reliable?", importer_id=_IMPORTER, question_id="rsrch-eval-01")

    # A golden question shaped like scripts/research_eval/questions.json.
    question = {
        "id": "rsrch-eval-01",
        "expected_source_substrings": ["rubric", "calibrat"],
        "expected_claims": [
            {"id": "01-rubric", "keywords": ["rubric"]},
            {"id": "01-calibration", "keywords": ["calibrat"]},
        ],
    }

    # The rubric consumes the report's dict projection with NO translation.
    scored = score_research_run(question, report.as_run_output())

    assert scored.question_id == "rsrch-eval-01"
    # Every claim is cited and resolves; nothing fabricated.
    assert scored.by_name("cited-sources").score == 1.0
    assert scored.by_name("claims-resolve").score == 1.0
    assert scored.by_name("no-fabrication").score == 1.0
    # Golden anchors hit -> full coverage; healthy total.
    assert scored.by_name("coverage").score == 1.0
    assert scored.total > 0.95


def test_report_dataclass_fields_match_rubric_contract() -> None:
    """The dataclass projection carries exactly the keys the rubric normaliser reads."""
    report_dict = _sample_report().as_run_output()
    assert set(report_dict) == {"question_id", "sources", "claims", "report"}
    assert set(report_dict["sources"][0]) == {"id", "url", "excerpt", "title"}
    assert set(report_dict["claims"][0]) == {"text", "source_ids"}


def _sample_report() -> ResearchReport:
    return ResearchReport(
        question_id="q",
        sources=(Source(id="s1", url="u", excerpt="e", title="t"),),
        claims=(Claim(text="c", source_ids=("s1",)),),
        report="body",
    )


# ---------------------------------------------------------------------------
# 4. The cost ceiling aborts the run FAIL-CLOSED.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cost_ceiling_aborts_fail_closed() -> None:
    # A tiny ceiling: the single PLAN call (200 tokens) already breaches it, so
    # the loop must abort BEFORE any search / draft / verify / synthesize.
    chat = FakeChatProvider(_good_replies(), usage_per_call=200)
    search = FakeSearchExecutor(_two_envelopes())
    budget = ResearchBudget(max_total_tokens=100, max_rounds=4)
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID, budget=budget)
    sink = _EventSink()

    report = await loop.run(question="q", importer_id=_IMPORTER, question_id="q1", emit=sink)

    assert report.aborted is True
    assert report.abort_reason == "token_ceiling"
    # FAIL-CLOSED: no claims and no sources were fabricated past the ceiling.
    assert report.claims == ()
    assert report.sources == ()
    # It stopped before spending on search — the expensive open-internet fan-out never happened.
    assert search.calls == []
    assert chat.calls == ["PLAN"]  # only the one call that tripped the ceiling
    # The stop is surfaced as a cost event, never a silent drop.
    assert any(e.type == "cost_capped" and e.data.get("breached_cap") == "research_token_ceiling" for e in sink.events)


@pytest.mark.asyncio
async def test_provider_error_aborts_without_fabricating() -> None:
    class _ErroringProvider(FakeChatProvider):
        async def stream(self, **kwargs: Any):
            self.calls.append("PLAN")
            yield StreamEnd(stop_reason="error")

    chat = _ErroringProvider(_good_replies())
    search = FakeSearchExecutor(_two_envelopes())
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    report = await loop.run(question="q", importer_id=_IMPORTER, question_id="q1")

    assert report.aborted is True
    assert report.abort_reason.startswith("provider_error")
    assert report.claims == ()


@pytest.mark.asyncio
async def test_empty_search_yields_no_uncited_claims() -> None:
    """A run that gathers no sources produces zero claims — never an uncited assertion."""
    chat = FakeChatProvider(_good_replies())
    search = FakeSearchExecutor([_envelope(), _envelope()])  # both rounds return nothing
    loop = DeepResearch(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    report = await loop.run(question="q", importer_id=_IMPORTER, question_id="q1")

    assert report.claims == ()
    assert report.sources == ()
    assert not report.aborted  # an honest empty result, not an abort
    # Draft/verify/synthesize were skipped once search came back empty.
    assert chat.calls == ["PLAN"]


# ---------------------------------------------------------------------------
# The capability packaging helper.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_define_research_capability_shape_and_executor() -> None:
    chat = FakeChatProvider(_good_replies())
    search = FakeSearchExecutor(_two_envelopes())

    capability = define_research_capability(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    # The Capability carries the frozen metadata the registry keys on.
    assert capability.id == "deep_research"
    assert capability.id == build_deep_research_tool()["name"]
    assert capability.risk == "read"
    assert capability.cost == "expensive"
    assert capability.source == "builtin"
    assert capability.trust == "first-party"

    # Its executor runs the real loop and returns a capped web_search-style envelope.
    result = await capability.executor.execute(
        name="deep_research", arguments={"question": "What makes an LLM judge reliable?"}, importer_id=_IMPORTER
    )
    assert not result.is_error
    envelope = json.loads(result.content)
    assert envelope["mode"] == "deep_research"
    assert len(envelope["claims"]) == 2


@pytest.mark.asyncio
async def test_capability_executor_rejects_empty_question() -> None:
    chat = FakeChatProvider(_good_replies())
    search = FakeSearchExecutor(_two_envelopes())
    capability = define_research_capability(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    result = await capability.executor.execute(name="deep_research", arguments={"question": "  "}, importer_id=_IMPORTER)

    assert result.is_error is True
    assert search.calls == []


@pytest.mark.asyncio
async def test_capability_executor_oversized_report_stays_valid_json_under_cap() -> None:
    """A run whose report+sources exceed the cap must shrink to VALID JSON, never a mid-JSON slice.

    The old behavior sliced the dumped string at MAX_TOOL_OUTPUT_CHARS and appended
    a marker — invalid JSON, rejected by the envelope gate, failing every real
    (>2000-char) research run end-to-end.
    """
    replies = _good_replies()
    # Make the synthesized report enormous so the raw envelope blows the cap.
    replies["SYNTHESIZE"] = json.dumps({"report": "polytoken evidence " * 600})
    chat = FakeChatProvider(replies)
    search = FakeSearchExecutor(_two_envelopes())
    capability = define_research_capability(chat_provider=chat, search_executor=search, model_id=_MODEL_ID)

    result = await capability.executor.execute(
        name="deep_research", arguments={"question": "What makes an LLM judge reliable?"}, importer_id=_IMPORTER
    )

    assert not result.is_error
    assert len(result.content) <= MAX_TOOL_OUTPUT_CHARS
    envelope = json.loads(result.content)  # must parse — the whole point
    assert envelope["mode"] == "deep_research"
    assert envelope["truncated"] is True
    # Claims survive shrinking before the report body does (they carry the citations).
    assert envelope["claims"], "shrink stages must not silently drop all claims"
