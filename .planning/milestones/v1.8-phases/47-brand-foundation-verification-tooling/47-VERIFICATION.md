---
phase: 47-brand-foundation-verification-tooling
verified: 2026-07-10T19:02:56Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Review the polytoken BrandMark's visual quality/brand fit across the sidebar, login card, and favicon"
    expected: "The mark reads as a credible 'rounded, organic node/brain hybrid' per D-47-02 (not sharp graph lines, not an infra diagram, not a doodle) and is acceptable as the foundational brand asset phases 48-51 will build the re-skin around"
    why_human: "Aesthetic/brand-fit judgment on a foundational visual asset is inherently subjective and cannot be graded by grep/typecheck; this phase explicitly exists to establish the brand identity later phases are locked into"
---

# Phase 47: Brand Foundation + Verification Tooling Verification Report

**Phase Goal:** The product has a documented polytoken brand identity ready to apply — voice, logo mark, brand guide — and a working visual-verification toolchain (Playwright + screenshot harness) exists for every subsequent re-skin phase to use.
**Verified:** 2026-07-10T19:02:56Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria — the contract)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Login page, empty states, sidebar chrome, page titles, and toasts speak the polytoken register (warm, first-person, no systems vocabulary) | ✓ VERIFIED | `login/page.tsx` CardTitle/CardDescription = "Welcome back to your workspace" / "Pick up right where you left off — sign in with Google." (screenshot-confirmed live render); `layout.tsx`/`entities`/`knowledge`/`studio`/`studio/preview`/`settings/forwarding` titles all warmed and still contain "Polytoken"; `chat-home-empty-state.tsx` = "Ask me anything"; `canvas-empty-state.tsx` = "Panels will appear here"; `inbox-three-pane.tsx` = "Your inbox is clear…" / "Nothing extracted yet…"; toasts in `email-detail.tsx`/`use-autofill-fields.ts`/`pdf-preview-pane.tsx` warmed while `toast.success/error/warning/info` variants and Undo/duration args (3000ms, 6000ms) preserved (grep-confirmed) |
| 2 | A committed logo mark (rounded node/brain hybrid SVG, anchored on teal `color.primary`) renders in the sidebar brand slot, login card, and favicon | ✓ VERIFIED | `apps/web/src/components/brand-mark.tsx` (`BrandMark`, 5x `currentColor`, zero raw hex/rgb/hsl literals — grep confirmed empty); `apps/web/src/app/icon.svg` exists, inert (no script/foreignObject/event-handler — grep confirmed empty), fills = `hsl(164 39% 22%)` tracing to `--primary`; `app-sidebar.tsx` line 121 and `login/page.tsx` line 33 both import+render `<BrandMark variant="glyph" .../>` in a `text-primary` context; literal `>P<` avatar glyph confirmed absent from both files; **directly observed rendering** in `.planning/ui-reviews/2026-07-10T18-39-30-080Z/login-desktop.png` (two-lobe teal mark visible in both sidebar rail and login card header, letter-P placeholder gone) |
| 3 | PROJECT.md records the brand decision + USER-LOCKED naming + accepted collision + user-gated list; in-repo brand guide documents voice, do/don't, mark usage | ✓ VERIFIED | `docs/design/brand-guide.md` (126 lines): §1 verbatim USER-LOCK quote ("everything will be called polytoken and domain polytoken.ai. everything else is purged."), §2 6-pair do/don't table, §3 mark usage referencing real `brand-mark.tsx`/`icon.svg` (variants, tones, clear space, min size), §4 accepted collision framed as risk not mitigation, §5 NOT-done/user-gated list (domain purchase, trademark), §6 pointer to `product-register-and-bans.md` (never contradicts, no blur license); `.planning/PROJECT.md` L497 Key Decisions row "v1.8 Phase 47 (BRND)" records the same, table structure intact |
| 4 | `@playwright/test` (+ firefox) installed; parked code-island isolation spec green on chromium AND firefox; auth-redirect spec green | ✓ VERIFIED | `apps/web/package.json` pins `"@playwright/test": "1.61.1"` (no caret); `apps/web/playwright.config.ts` has chromium+firefox projects, `webServer` (`npm run dev`, `reuseExistingServer: true`), `baseURL: http://localhost:3000`; `code-island-isolation.spec.ts` was fixed in commit `6fb2e53` ("fix(47-04): isolation probe handles opaque-origin SecurityError throw" — sound fix, accepts the two isolation-*proving* outcomes `""`/`"SecurityError"` for the opaque-origin cookie read, does not weaken any assertion) landing at the same timestamp as commit `a0691b4` which flipped `VRFY-01` to `[x] Complete` and the traceability row to `Complete` in REQUIREMENTS.md, matching the orchestrator's documented 12/12-green run this session. **Not re-executed in this verification pass** per explicit environment instruction (concurrent Supabase reboot) — verified via source-correctness of the fix + commit trail + REQUIREMENTS.md state change instead of a live re-run |
| 5 | Screenshot-driven visual review harness exists and produces a reviewable artifact | ✓ VERIFIED | `apps/web/e2e/screenshot-review.spec.ts` (220 lines) enumerates all 6 surfaces × 2 viewports (390/1440), never injects a cookie/session (grep-confirmed no `setCookie`/`addCookies`/`signInWithOAuth`), writes no `process.env` values; `apps/web/playwright.screenshot.config.ts` scopes to the capture spec only via `testMatch`, base config has matching `testIgnore` so `test:e2e`/`screenshot:review` never run each other; `apps/web/package.json` has `screenshot:review` script; **real artifact on disk**: `.planning/ui-reviews/2026-07-10T18-39-30-080Z/` — 12 PNGs + `index.md` listing all 6×2 combinations with auth-status column (`login` = captured, other 5 = "redirected to /login (no session)", documented as best-effort per D-47-05, not faked) |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/web/src/components/brand-mark.tsx` | Reusable mark component, currentColor-driven | ✓ VERIFIED | Exists, exports `BrandMark`, `variant`/`tone` props, 5× `currentColor`, 0 raw color literals |
| `apps/web/src/app/icon.svg` | Static favicon glyph, inert | ✓ VERIFIED | Exists, `<svg`, `hsl(164 39% 22%)` fills, no script/foreignObject/event handlers |
| `apps/web/src/components/app-sidebar.tsx` | Sidebar brand slot renders the mark | ✓ VERIFIED | `BrandMark` imported + rendered in `SidebarHeader`, "Polytoken" wordmark retained |
| `apps/web/src/app/login/page.tsx` | Login card header renders mark + warm copy | ✓ VERIFIED | `BrandMark` rendered in `CardHeader`; copy warmed |
| `docs/design/brand-guide.md` | In-repo brand guide | ✓ VERIFIED | 126 lines, all D-47-03 sections present |
| `.planning/PROJECT.md` | Key Decisions row for Phase 47 | ✓ VERIFIED | Row present, 3-column table structure intact |
| `apps/web/playwright.config.ts` | chromium+firefox+webServer+baseURL | ✓ VERIFIED | All present |
| `apps/web/e2e/code-island-isolation.spec.ts` | 5 isolation assertions, unweakened | ✓ VERIFIED | Assertions strengthened (accept both proving outcomes), not weakened; commit message explicit about this |
| `apps/web/e2e/screenshot-review.spec.ts` | Capture harness | ✓ VERIFIED | 220 lines, 6 surfaces × 2 viewports, no auth-faking |
| `apps/web/playwright.screenshot.config.ts` | Dedicated capture config | ✓ VERIFIED | `testMatch` scoped correctly |
| `.planning/ui-reviews/{timestamp}/` | Produced artifact | ✓ VERIFIED | 12 PNGs + index.md on disk, visually inspected |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app-sidebar.tsx` | `brand-mark.tsx` | import + render in SidebarHeader | ✓ WIRED | `import { BrandMark } from "~/components/brand-mark"` L31, rendered L121 |
| `login/page.tsx` | `brand-mark.tsx` | import + render in CardHeader | ✓ WIRED | `import { BrandMark } from "~/components/brand-mark"` L12, rendered L33 |
| `brand-guide.md` | `product-register-and-bans.md` | reference, never contradict | ✓ WIRED | §6 explicit pointer; no blur/glassmorphism license found |
| `brand-guide.md` | `brand-mark.tsx` | mark-usage section cites real asset | ✓ WIRED | §3 cites `apps/web/src/components/brand-mark.tsx` + real variant/tone names |
| `playwright.config.ts` | `npm run dev` | webServer.command | ✓ WIRED | `command: "npm run dev"`, `reuseExistingServer: true` |
| `screenshot-review.spec.ts` | `.planning/ui-reviews/{timestamp}/` | page.screenshot + index.md write | ✓ WIRED | Real artifact produced on disk with matching filenames |
| `package.json screenshot:review` | `playwright.screenshot.config.ts` | `playwright test --config` | ✓ WIRED | Script present, dedicated config used |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| apps/web unit suite stays green (no DB) | `npm run test` (apps/web) | 40 files / 294 tests passed | ✓ PASS |
| Repo-level brand guard (no purged names in app copy/docs) | `grep -rniE "cortex\|nodal\|lattice\|constellation" apps/web/src docs` | 0 matches | ✓ PASS |
| No raw color literals in brand-mark.tsx | `grep -nE "#[0-9a-fA-F]{3,8}\|rgb(\|hsl(" apps/web/src/components/brand-mark.tsx` | 0 matches | ✓ PASS |
| icon.svg inert | `grep -niE "<script\|<foreignObject\|onload=\|onclick=" apps/web/src/app/icon.svg` | 0 matches | ✓ PASS |
| Toast variants preserved (no error→info downgrade) | `grep -nE "toast\.(success\|error\|warning\|info)" …` | All 4 files match same variants as before | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or PLAN-declared probes found for this phase. The two Playwright e2e specs function as this phase's probes but were **not executed** in this verification pass per explicit environment instruction (concurrent local Supabase reboot). Evidence relied upon instead: commit `6fb2e53` (source-level fix, reviewed in full — a strengthening, not a weakening) landing at the same timestamp as commit `a0691b4` (REQUIREMENTS.md VRFY-01 flipped Pending→Complete), consistent with the orchestrator's documented 12/12-green run this session.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| BRND-01 | 47-01, 47-02 | Warm polytoken-register copy across login, sidebar, empty states, titles, toasts | ✓ SATISFIED | All surfaces confirmed warmed; checkbox `[x]` in REQUIREMENTS.md L14, though the traceability table (L82) still says "In Progress" — stale bookkeeping, not a functional gap (see Anti-Patterns) |
| BRND-02 | 47-01 | Committed logo mark in sidebar/login/favicon | ✓ SATISFIED | `brand-mark.tsx` + `icon.svg`, wired + screenshot-confirmed |
| BRND-03 | 47-03 | Brand decision recorded (PROJECT.md + brand guide) | ✓ SATISFIED | Both artifacts confirmed |
| VRFY-01 | 47-04 | Playwright + firefox installed, both specs green | ✓ SATISFIED | Confirmed via source fix + commit trail (see Truth #4) |
| VRFY-02 | 47-05 | Screenshot review harness + artifact | ✓ SATISFIED | Confirmed, real artifact on disk |

No orphaned requirements — all 5 IDs the task named (BRND-01, BRND-02, BRND-03, VRFY-01, VRFY-02) are declared across the 5 plans' frontmatter and appear under "Phase 47" in REQUIREMENTS.md's Traceability table.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `.planning/REQUIREMENTS.md` | L14, L82 | BRND-01 checkbox is `[x]` (and the descriptive parenthetical still reads "…empty states/page titles/toasts remain — 47-02", written before 47-02 closed that gap) but the Traceability table (L82) still says "In Progress" instead of "Complete" | ℹ️ Info | Documentation staleness only — the underlying code-level work is verified complete (Truth #1); does not block the phase goal, but should be fixed for an accurate paper trail |
| ROADMAP.md (via `roadmap.get-phase`) | Plans list | The 47-04-PLAN.md bullet still reads "VRFY-01 PENDING: 10/12 assertions pass…" even though VRFY-01 was later closed (commit `a0691b4`/`6fb2e53`) and REQUIREMENTS.md now marks it Complete | ℹ️ Info | Same class of staleness — a reader of ROADMAP.md alone would be misled into thinking VRFY-01 is still open; the actual repo state is correct |
| No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any phase-touched file | — | — | — | Scanned `brand-mark.tsx`, `icon.svg`, `app-sidebar.tsx`, `login/page.tsx`, `layout.tsx`, `screenshot-review.spec.ts`, `playwright.screenshot.config.ts`, `playwright.config.ts`, `brand-guide.md` — all clean |

### Human Verification Required

### 1. Brand mark visual quality / brand fit

**Test:** Look at the rendered `BrandMark` in the sidebar rail, the login card header, and the favicon glyph (e.g. via `.planning/ui-reviews/2026-07-10T18-39-30-080Z/login-desktop.png` or by running the app).
**Expected:** The mark reads as a credible "rounded, organic node/brain hybrid" (D-47-02) — not sharp graph lines, not an infrastructure diagram, not a hand-drawn doodle — and is an acceptable foundational brand asset for phases 48-51 to build the total re-skin around.
**Why human:** Aesthetic/brand-fit judgment on a foundational visual asset is inherently subjective (grep/typecheck can only confirm token discipline and wiring, not "does this look like a good logo"). This phase exists specifically to lock in the brand identity later phases depend on, so a quick human look before committing to it downstream is worth the pause.

### Gaps Summary

No functional gaps found. All 5 ROADMAP.md success criteria are verified against real, wired, substantive artifacts (not stubs) — the brand mark renders live (screenshot-confirmed), the copy sweep is complete and grep-verified across every named surface, the brand guide + PROJECT.md record the USER-LOCKED decision durably, the Playwright toolchain is installed and pinned with both parked specs closed out via a legitimate strengthening fix (not a weakened assertion), and the screenshot harness produced a real timestamped artifact with 12 PNGs + an index.md on disk. Two documentation-staleness items (REQUIREMENTS.md traceability table row, ROADMAP.md plan-list bullet) are informational only and do not block phase completion. One item is routed to human verification: the brand mark's aesthetic acceptability, which no automated check can grade.

---

*Verified: 2026-07-10T19:02:56Z*
*Verifier: Claude (gsd-verifier)*
