# v1.x Close-Out Reconciliation — v1.10 + v1.11

_Synthesized 2026-07-25 from three area audits (v1.10 Phases 55–63; v1.11 Phases 64/68–72 +
advance slices 65/66; carried human-gated legs). Grep-confirmed against main._

---

## 1. The honest headline

**The product is well ahead of its ledger. The unticked boxes are mostly bookkeeping, not missing
software.** Both milestones were largely built during the 2026-07-20 night-run "build march"
(squash-merged to main via PR #1 / `0851cf9`) with code that never got GSD phase dirs, PLANs, or
checkbox reconciliation. The roadmap prose reads "carried / verification owed / NOT wired"; the code
reads *shipped and live-by-default*.

The real numbers, evidence-grounded:

| | Requirements | Truly shipped in code | Code-complete but human-gated (pixels) | Genuine code-missing |
|---|---|---|---|---|
| **v1.10** (55–63) | 21 | ~15 (Phases 55–61, verified) | 3 (Phase 62: SURF-03/05/06 — redesigned surfaces + production states, self-marked in source, never eyeballed) | ~3 (Phase 63: RCNV-02 reconcile, RCNV-03 mount, RCNV-05 unbuilt) |
| **v1.11** (64/68–72) | 17 deliverables | ~13 (spine, research loop, docs-as-objects, mail rules, both advance slices; live by default) | 0 | 4 seams (REG-04 mount, RSRCH-03/RCNV-02 reconcile, DOCS-01 export entry, RSRCH-04 mid-stream refine) |

**Roughly 82% of v1.10+v1.11 is code-complete on main** (31/38 if you count the pixel-gated three as
done-pending-eyeball). What genuinely does not exist yet is **~6 concrete code seams** — and of those,
only two (RCNV-05 source-grounded panels, RSRCH-04 mid-stream refinement) are net-new builds rather
than a wiring/mount of code that already exists and is tested.

Note the RCNV-02 reconcile seam appears in **both** milestones (v1.10 RCNV-02 and v1.11 RSRCH-03
depend on the same `sourceNodeId()` materialization pass). It is one piece of work, not two.

The stale ledger claims specifically:
- ROADMAP Phases 68–72 all say *"NOT wired/verified through GSD — verification owed."* False for the
  code: `RESEARCH_TOOL_ENABLED`/`WEB_SEARCH_TOOL_ENABLED` both default `True`; `deep_research` is
  wired into the chat capability registry (`chat_turn_providers.py:278-288`). The spine, research
  loop, evals, docs-as-objects, and mail rules are live, not pending-wire.
- ROADMAP line 15 / STATE line 54 say Phases 62 **and** 63 are "pixel-gated on the user." True for 62.
  **False for 63** — Phase 63 has genuine code gaps (RCNV-02/03/05); its pixel gate is partly
  *code-blocked*, not human-blocked.

---

## 2. The genuinely code-missing punch-list (the only real build work)

Tight and concrete. Six items; two are net-new, four are wiring/mount of already-tested code.

1. **RCNV-02 / RSRCH-03 — the ledger→canvas reconcile Pass-2 (ONE piece of work, spans both milestones).**
   `use-canvas-persistence.ts:94-104` defines `sourceNodeId(sourceLedgerId)` and its header calls it
   "THE WIRING SEAM," but grep confirms it is **never called to materialize a node** — `chat-canvas.tsx:626`
   only builds a `Set` of *existing* source-node ids to exempt them from selection. Build the reconcile
   pass that reads `chat_source_ledger` rows and inserts source nodes (mirroring the existing
   `buildExpectedGenuiPanelSpecs` reconcile). Until this exists, auto-collected sources do **not**
   appear on the canvas — the headline "sources land without asking" is not true yet. _Unblocks #2._

2. **RCNV-03 — mount `<CanonToolbar>` in production JSX.** `canon-toolbar.tsx` and the pure
   `canon-selection.tsx` (toggle/clear/markConfirmed) and the promote route
   (`api/chat/sources/[ledgerId]/promote/route.ts` + listener `chat_sources.py`) are all built and
   tested; click-to-toggle is wired at `chat-canvas.tsx:657-665`. But `CapabilityConfirmCard`-style,
   `CanonToolbar` is mounted **only in its own test**. Mount it in the canvas. Small; depends on #1
   for real nodes to gather.

3. **DOCS-01 — the report/message → document export entry point.** The typeset-PDF pipeline is real
   and correct for a *stored* document (`api/documents/[id]/pdf/route.ts` prints
   `documents/[id]/print/typeset-document.tsx` headless). But `documents.create` only makes a **blank**
   doc (`documents/index.ts:138-161`, `blocks:[]`), and there is no "save this report/message as a
   document" affordance anywhere in `apps/web/src/app/chat`. The requirement's "**any** report/message
   exports" language is unmet at the entry point. Add the chat affordance that turns a message or a
   deep-research report into a stored document (real blocks) — after which the existing PDF export
   already applies.

4. **REG-04 (Phase 71) — mount the confirm card + the agent-emits-binding-spec path.** The binding
   machinery (`packages/genui/src/binding/bind-capability.ts`, fail-closed, zod boundary, risk gate)
   and its 21-test D2 proof are genuinely built. But grep confirms `CapabilityConfirmCard` is mounted
   **nowhere** in `apps/web/src` (only its own file + test); the card file itself says the mount seam
   "is another wave's file." Wire the live path: agent emits a genui spec that binds a registry
   capability → the confirm card renders → invocation runs through the resolver. Turns "proven in test"
   into "proven in product."

5. **RSRCH-04 (Phase 69) — mid-stream refinement into a running research job.** The collapse-to-one-line
   / re-expand trace UI is shipped (`research-trace.tsx`). The other half is not: `DeepResearch.run()`
   (`deep_research.py:302`) is a single non-interruptible call — no refinement-injection port. Add the
   path to feed a refinement into a running loop without restart. _Net-new build._

6. **RCNV-05 — source-grounded genui panel generation.** Genuinely unbuilt end-to-end: no
   grounded-from-canon generation path exists in `apps/web`, `packages/api-client`, or the listener
   (`deep_research.py` is the research use case, not canon-grounded panel generation). This is the one
   Phase 62/63 requirement with **zero** out-of-band code and the single largest genuine build item.
   _Net-new build._

Everything else claimed "open" in the ledger is either shipped-and-mislabeled or a pixel/live gate
(Section 3). **MCP projection is correctly NOT built** — it is v2.3 populate-the-registry territory
(INV-3), only referenced in `packages/capabilities/src/vetting.ts`. No action owed in v1.x.

---

## 3. The human-gated legs (each an exact ~2-minute action, no code)

Five legs. LIVE-03 → LIVE-04 → CLUS-07 form a dependency chain (sign-in → real email → six-leg
scenario). The two pixel gates are independent — **except** the Phase 63 pixel gate is partly
code-blocked (you cannot eyeball auto-appearing source nodes or a source-grounded panel until punch-list
#1 and #6 exist).

1. **LIVE-03 — Google OAuth live.** (a) Google Cloud Console: on the OAuth Web client, confirm scopes
   `openid`/`userinfo.email`/`userinfo.profile` and register the prod redirect URI
   `https://dazyccjijdahxyciptkp.supabase.co/auth/v1/callback`. (b) PROD Supabase Dashboard (project
   `dazyccjijdahxyciptkp`) → Authentication → Providers → Google → enable + paste client id + the
   correct client secret (ends **…EKM7**, NOT the stale …hRh6). Then at polytoken.ai click "Sign in with
   Google," reload (session persists), sign out. Runbook: `MORNING-CHECKLIST.md §A`. ~5–10 min.

2. **LIVE-04 — real email round-trip.** At `/settings/forwarding` copy your
   `u-{token}@magnitudetech.com.br` address → add it as a Gmail forwarding address (Gmail Settings →
   Forwarding and POP/IMAP → Add) → retrieve the Gmail confirmation code from the polytoken inbox and
   activate → send one real test email (with an attachment). Needs a live session first (depends on
   LIVE-03). `MORNING-CHECKLIST.md §B.3-6`. ~5 min.

3. **CLUS-07 — six-leg cluster scenario on the real inbox** (v1.9's declared acceptance bar). Run the
   walkthrough in `MORNING-CHECKLIST.md §H.4` on live prod: pick a real thread card on `/chat` canvas →
   Attach chat → `web_search` with thread in context → confirm a source capture (INFERRED `knowledge_nodes`
   row) → promote to EXTRACTED → a second thread-linked chat sees cluster context. Transitively gated on
   LIVE-03 + LIVE-04. ~15–20 min.

4. **Phase 62 pixel gate.** Open the redesigned `/knowledge`, `/studio`, `/settings/*`, `/login` on live
   polytoken.ai (or run `npm run screenshot:review` in `apps/web` against an already-running :3000 server
   and read the PNGs); trigger each empty/loading/error state; approve the look on the locked D-58-01
   identity. Code is done and self-marked "Phase 62 / SURF-0x"; jsdom cannot close this. ~10 min. Then
   create the Phase 62 dir + flip the ROADMAP checkbox.

5. **Phase 63 pixel gate (partial — see caveat).** Review on live prod: canon multi-select "add to
   canon" curation (`canon-selection.tsx`), and the source-node styling matches the Phase 59 identity, not
   stock. **Caveat:** the "sources auto-appear as canvas nodes" review is blocked until punch-list #1
   ships, and the "source-grounded panel" review is blocked until #6 ships — so this leg is only fully
   reviewable **after** those two code items land. ~10 min once unblocked. Then create the Phase 63 dir +
   flip the checkbox.

---

## 4. Ledger reconciliation — precise edits so the docs tell the truth

### `.planning/ROADMAP.md`
- **Line 15** (v1.10 one-liner): change "Phases 62/63 carried (pixel-gated on the user)" → "Phase 62
  carried (code-complete, pixel-gated on the user); Phase 63 carried (RCNV-02/03 wiring + RCNV-05 unbuilt —
  real code, not just pixels)."
- **Line 221** `- [ ] Phase 62`: leave unchecked **only** until the pixel gate (§3.4) is done, then `[x]`.
  Add inline note: "code-complete out-of-band (SURF-03/05/06 self-marked in source); pixel sign-off owed."
- **Line 222** `- [ ] Phase 63`: keep unchecked and correct the note to name the real remaining code:
  "RCNV-02 reconcile pass + RCNV-03 CanonToolbar mount + RCNV-05 source-grounded panels — genuine code,
  not pixel-only."
- **Lines 463, 467** — Phases **68** and **72**: change `[ ]`→`[x]` and delete "NOT wired/verified …
  verification owed." Replace with "shipped; live by default (RESEARCH/WEB_SEARCH default True); GSD
  paperwork backfilled 2026-07-25." (REG-01/02/03, MAIL-02 and RSRCH-05 are grep-verified shipped.)
- **Line 465** — Phase **70**: keep the code claim but narrow the open leg: "DOCS-02/03 shipped +
  DB-backed; DOCS-01 typeset-PDF shipped for stored docs — remaining: the report/message→document export
  entry point (documents.create makes blank docs today)." Tick only after punch-list #3.
- **Line 464** — Phase **69**: rewrite the note: "RSRCH-01/02 shipped and live (deep_research loop +
  pmark citations); remaining: RSRCH-03 canvas reconcile (shared with RCNV-02) + RSRCH-04 mid-stream
  refinement."
- **Line 466** — Phase **71**: rewrite: "REG-04 binding machinery + 21-test D2 proof shipped; remaining:
  mount CapabilityConfirmCard + the agent-emits-binding-spec live path (proven-in-test, not yet
  proven-in-product)."

### `.planning/STATE.md`
- **Front-matter `progress`**: `completed_phases: 1`→`3` (64, 68, 72 done), `percent: 16`→`50`.
- **Lines 44–49** ("Phases 68–72 BUILT-BUT-UNVERIFIED … NOT wired"): replace the blanket "NOT wired" with
  the truth: "68 and 72 shipped + live by default; 69/70/71 shipped-in-code with four named remaining
  seams (RCNV-02 reconcile, DOCS-01 export entry, REG-04 mount, RSRCH-04 refinement) — verification is
  wiring/mount + eyeball, not build-from-scratch."
- **Line 54** (v1.10 status): correct "both [62/63] pixel-gated" → "62 pixel-gated (code-complete); 63 has
  real code gaps (RCNV-02/03/05)."
- **Next Actions §1**: replace "Wire + verify Phases 68–72" with the concrete Section-2 punch-list
  (the six seams), so the next session builds the right thing.

### `.planning/MILESTONES.md`
- This file is a **shipped-milestone archive** — v1.10 and v1.11 have **no entries yet**. On formal close,
  add two entries mirroring the v1.9 format (phases, requirements X/Y satisfied, Known Gaps table):
  - **v1.10** — 15/21 shipped + 3 code-complete-pixel-gated (Phase 62); Known Gaps = Phase 63 code seams
    (RCNV-02/03/05) + the two pixel gates.
  - **v1.11** — 13/17 shipped; Known Gaps = the four seams (REG-04 mount, RSRCH-03/RCNV-02 reconcile,
    DOCS-01 export, RSRCH-04 refinement); MCP projection explicitly deferred to v2.3 (not a gap).
- Do **not** add these as "shipped" until Section 2 lands + milestones are formally closed; today they are
  honestly "in-progress, code-ahead-of-ledger."

---

## 5. Recommendation — can we "finish v1.x" by shipping the punch-list + closing?

**Yes — and it is genuinely small.** The honest picture is a product that is ~82% code-complete on main
with a stale ledger, not a half-built milestone. "Finishing v1.x" is three moves:

1. **Ship the six-seam punch-list (Section 2).** Four of six are wire/mount of already-tested code
   (RCNV-02 reconcile, RCNV-03 mount, DOCS-01 export entry, REG-04 mount) — low-risk, bounded, mostly
   glue against seams that already have their id-schemes, schemas, routes, and unit proofs. Only **two**
   are net-new builds: RSRCH-04 mid-stream refinement and RCNV-05 source-grounded panels. If you want the
   smallest honest "v1.x done," RCNV-05 is the single largest carve-out — it is defensible to defer it
   to a v1.12/v2.x "presentation" slice and close v1.10 on the reconcile+curation seams, since RCNV-05 is
   an additive generation feature, not a correctness gap.

2. **Reconcile the ledger (Section 4)** — flip 68/72 to shipped, narrow 69/70/71 to their real seams,
   correct the "63 is pixel-gated" lie, backfill the missing Phase 62/63/68–72 GSD dirs.

3. **Run the five human legs (Section 3)** — ~45–60 min of Pedro's console/eyeball time, zero code. These
   are the actual gate on calling the product "used live," and three of them (LIVE-03/04/CLUS-07) have
   been owed since v1.9.

**The honest call:** there is **no large hidden build** in v1.x. The remaining real engineering is ~4
small wiring items + ~2 feature builds, and if RCNV-05 is deferred (reasonable), the finish line is the
four wiring seams + the ledger truth-up + Pedro's ~1 hour of live/pixel actions. Do not let the roadmap's
"NOT wired / verification owed" prose convince anyone there is a milestone's worth of code left — there
isn't. The biggest risk here is the ledger continuing to under-report done work and someone rebuilding
what already ships.
