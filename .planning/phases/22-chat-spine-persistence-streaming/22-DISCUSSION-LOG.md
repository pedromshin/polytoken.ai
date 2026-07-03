# Phase 22: Chat Spine + Persistence + Streaming - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 22-chat-spine-persistence-streaming
**Areas discussed:** Agent identity & genui emission (incl. multi-provider model system), Conversation management UX, Streaming & turn mechanics, Cost circuit breaker policy `[auto]`, Architecture & plumbing `[auto]`
**Mode note:** Areas 1–3 interactive; user invoked `/gsd:autonomous` mid-discussion, so Area 4 +
the pre-requested second-round areas were auto-resolved with recommended defaults (marked `[auto]`).

---

## Agent identity & genui emission

| Option | Description | Selected |
|--------|-------------|----------|
| Nauta workspace agent (Recommended) | Product-aware persona, forward-compatible with Phase 24 | |
| GenUI design partner | Studio-flavored, UI-iteration-focused agent | |
| Minimal neutral assistant | Plain helpful assistant, persona deferred | ✓ |

**User's choice:** Minimal neutral assistant.

| Option | Description | Selected |
|--------|-------------|----------|
| Sonnet primary (Recommended) | Sonnet 4.6 for all turns, breaker guards cost | |
| Haiku primary → Sonnet escalation | Cheap default matching declarative genui path | |
| Configurable per conversation | Model picker in chat UI | ✓ (expanded) |

**User's choice (free text):** Configurable per conversation **including non-Anthropic options**
(Gemma, DeepSeek, Qwen, GLM 5.x) **and self-running in-browser options**. Curated "best options
only", kept up to date, but multi-option.

| Option | Description | Selected |
|--------|-------------|----------|
| Agent-decided tool call (Recommended) | emit_ui_spec tool; AI SDK generative-UI pattern; sets up Phase 24 | ✓ |
| Explicit user request only | Specs only on explicit ask | |
| Every turn attempts a spec | Studio-like; max cost | |

**User's choice:** Agent-decided tool call.

| Option | Description | Selected |
|--------|-------------|----------|
| No data access in 22 (Recommended) | Chat + genui only; data via allowlist gate in Phase 24 | ✓ |
| Read-only tools now | 2-3 read tools in 22 | |
| You decide | | |

**User's choice:** No data access in 22.

### Follow-up round: multi-provider scope

| Option | Description | Selected |
|--------|-------------|----------|
| Abstraction + picker, Anthropic first (Recommended) | Registry + picker in 22, other providers later | |
| Must include 1+ non-Anthropic hosted model | Prove abstraction cross-provider | |
| Full menu in 22 incl. in-browser | Hosted multi-provider AND WebLLM in 22 | ✓ (expanded) |

**User's choice (free text):** Full menu, optimizable for the user's GPU. Disclosed north star:
**sovereign/distributed inference** — users pool GPU resources, earn credits for lending hardware,
cash out or spend on AI; desktop-native app for direct hardware access. "Very difficult to plan
architecture for at this point… options should be open."

| Option | Description | Selected |
|--------|-------------|----------|
| Schema-level seams only (Recommended) | Execution locus + metered ledger + one provider port; no credits/pooling in 22 | ✓ |
| Seams + usage-accounting spike | Also a design doc mapping metering → future credits | |
| You decide | | |

**User's choice:** Schema-level seams only.

| Option | Description | Selected |
|--------|-------------|----------|
| Bedrock Anthropic + OpenRouter (Recommended) | Two adapters cover the curated menu | ✓ (expanded) |
| OpenRouter for everything | One adapter, abandons Bedrock IAM path | |
| Bedrock + direct provider APIs | Most maintenance | |

**User's choice (free text):** Bedrock Anthropic + OpenRouter **+ architecture open/capable of
run-it-yourself** (self-hosted endpoints) — the sovereign-inference door stays open at the
provider-port level. Separately (transport question): wants "most options with least friction,"
with an easy way to estimate which model to choose, cost, and what each is best for → picker
guidance requirement (D-06).

| Option | Description | Selected |
|--------|-------------|----------|
| Capability flags per model (Recommended) | Registry declares tools/genui/streaming/context; picker honest | ✓ |
| Offer genui everywhere | Fallback absorbs weak models | |
| GenUI = Anthropic-only in 22 | Least work, weakest proof | |

**User's choice:** Capability flags per model.

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal honest prototype (Recommended) | One small model, text-only, persists via same API, no genui | ✓ (qualified) |
| Prototype with genui attempt | Also try genui from browser model | |
| You decide | | |

**User's choice (free text):** Minimal honest, **but architecture open** for later more complex
functionality per the sovereign-inference discussion.

| Option | Description | Selected |
|--------|-------------|----------|
| Sonnet 4.6 default (Recommended) | Best quality default | |
| Haiku 4.5 default | Cheap default | |
| Remember last used | Inherit previous conversation's model | ✓ |

**User's choice:** Remember last used.

---

## Conversation management UX

| Option | Description | Selected |
|--------|-------------|----------|
| Own rail inside /chat (Recommended) | ChatGPT-style collapsible rail; app sidebar gets one Chat item | ✓ |
| Inside the app sidebar | Conversations nested in app shell | |
| Command-K style switcher | cmdk dialog, no persistent list | |

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-title + manual rename (Recommended) | Haiku background title after first exchange | |
| Manual rename only | "New chat" until renamed | |
| First-message snippet | Truncated first user message | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Resume most recent (Recommended) | /chat opens last-active conversation | |
| Always a fresh chat | Every visit starts clean | |
| Conversation home screen | Landing list; pick or start new | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Hard delete + confirm (Recommended) | Gone after confirm; ledger rows may survive | ✓ |
| Soft-delete / archive | Recoverable, more query complexity | |
| You decide | | |

---

## Streaming & turn mechanics

| Option | Description | Selected |
|--------|-------------|----------|
| Keep partial, marked stopped (Recommended) | Partial stays in thread, flagged; run event records | ✓ |
| Discard partial | Removed from thread, kept in run events | |
| Keep partial + Continue button | Resume-from-cutoff affordance | |

| Option | Description | Selected |
|--------|-------------|----------|
| Replace (audit keeps old) (Recommended) | One active response per turn | |
| Versioned siblings < 1/2 > | Branching versions, ChatGPT-style nav | ✓ |
| You decide | | |

**Note:** user chose the higher-complexity branching model — message schema must support sibling
response versions; only the active version feeds context.

| Option | Description | Selected |
|--------|-------------|----------|
| Valid subtree + skeletons (Recommended) | Continuous partial-JSON parse; render valid subtrees live | ✓ |
| Whole-spec gate, streaming frame | Outline during stream, render at completion | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Freely interleaved parts (Recommended) | text → spec → text… ordered typed parts (FOUND-1) | ✓ |
| Text + at most one spec | Simpler renderer, artificial constraint | |
| You decide | | |

---

## Cost circuit breaker policy `[auto]`

Auto-resolved with recommended defaults after the user switched to `/gsd:autonomous`:
- Caps: per-turn / per-session / per-day, env-configurable, starting $0.50 / $2 / $5 (D-20)
- Fail-closed pre-turn gate + mid-stream abort keeping partial, "cost-capped" marker (D-21)
- Per-model pricing in registry; browser models $0 but usage still metered; fix the
  known token-capture gap (only quarantine tokens recorded today) (D-22)
- Subtle session cost meter + per-turn detail (D-23)

## Architecture & plumbing `[auto]` (second-round areas the user pre-requested)

- SSE transport: FastAPI StreamingResponse → Next route-handler proxy (server-side key) →
  browser stream; tRPC keeps CRUD (D-24)
- Disconnect/reload mid-stream: abort + mark interrupted/retryable; no re-attach in 22 (D-25)
- History context: token-budget trim recent-first via registry context-size (D-26)
- Run/event schema: minimal-but-real runs + append-only run_events, migration 0023+ (D-27)
- Markdown/code renderer: new dependency, researcher picks, sanitized output (D-28)

## Claude's Discretion

Home-screen composition; exact event taxonomy + sibling-version tree representation; partial-JSON
parse approach; WebLLM model choice + loading UX; markdown library choice; cap-default tuning +
estimate heuristic; composer details beyond CHAT-06.

## Deferred Ideas

- Sovereign/distributed inference play (GPU pooling, credits earn/spend/cash-out, desktop-native
  app, remote-peer locus) — north-star, seams only in 22
- Self-hosted inference endpoint adapter (run-it-yourself)
- LLM auto-titling of conversations
- Resumable streams / re-attach + "Continue generating"
- Nauta data tools for the agent (Phase 24 allowlist gate)
- Richer browser-model functionality (genui from in-browser models)
