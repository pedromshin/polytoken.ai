---
status: partial
phase: 22-chat-spine-persistence-streaming
source: [22-VERIFICATION.md]
started: 2026-07-04T00:00:00Z
updated: 2026-07-04T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live end-to-end streamed conversation in a real browser (send → stream → persist → reload)
expected: Message streams token-by-token, generating indicator shows, persists across reload, matches 22-UI-SPEC.md visually
result: [pending]

### 2. WebGPU browser: select the Qwen3-4B in-browser model, watch it download (~2.5GB first run), stream a reply, persist across reload
expected: Progress states (Downloading → Loading into WebGPU → Ready), local streamed reply, canonical-shape persistence, correct model actually loads (Qwen3-4B, matching the picker's advertised name)
result: [pending]

### 3. Non-WebGPU browser: confirm the browser-locus picker entry renders disabled with the explanatory caption
expected: Row disabled + "Your browser doesn't support WebGPU — choose another model." caption
result: [pending]

### 4. Visual/UX conformance to 22-UI-SPEC.md (typography 2-weight system, token colors, rail 280px/0px collapse, Send↔Stop morph with no layout shift, cost meter subtlety, model picker capability-row formatting, sibling-nav chevrons, error/cost-cap card styling)
expected: Rendered UI matches the UI-SPEC's literal visual/interaction contract
result: [pending]

### 5. Regenerate → ‹ 1/2 › sibling navigation and inline-error Retry in a live running conversation
expected: Regenerate produces a navigable second sibling; a forced provider failure shows Retry with the composer draft intact
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
