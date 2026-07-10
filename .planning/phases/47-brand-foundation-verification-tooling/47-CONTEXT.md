# Phase 47: Brand Foundation + Verification Tooling - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Mode:** Smart discuss, autonomous — grey areas resolved with dossier-grounded recommendations
auto-accepted under the user's explicit "DO EVERYTHING" mandate (2026-07-10). Every decision below
is reversible and documented; none involves purchases, registrations, or external dashboards.

<domain>
## Phase Boundary

The product gains a documented, applied polytoken brand identity (voice + logo mark + brand guide) and
a working visual-verification toolchain (Playwright browsers + a screenshot harness) that every
subsequent v1.8 phase uses as its review instrument. This phase does NOT re-skin surfaces beyond
brand-copy/mark touchpoints (that is Phase 49), does NOT add tokens (Phase 48), and never touches
external dashboards (no domain purchase, no trademark filing, no OAuth work).

</domain>

<decisions>
## Implementation Decisions

### D-47-01 (USER-LOCKED 2026-07-10): Brand name = polytoken, domain = polytoken.ai
The user locked this mid-run: "everything will be called polytoken and domain polytoken.ai.
everything else is purged." ALL alternate brand names/directions (Cortex/Nodal/Lattice/
Constellation) are purged from product copy and docs — the product always names itself polytoken.
The known CLI-tool name collision (docs.polytoken.dev) was explicitly ACCEPTED by the user: record
as accepted risk in the brand guide; do NOT frame product copy around avoiding it.
Voice/copy REGISTER (tone only): warm, human, companion — "remember, recall, connect, your
workspace"; first-person surface framing; Notion AI / Mem approachability; never infra vocabulary
in user-facing copy. (Tone grounded in VISION's north star; carries over from the dossier's
Direction B ANALYSIS only — no alternate naming survives.)

### D-47-02 (LOCKED): Logo mark
Rounded, organic node/brain hybrid — interlocking soft-edged shapes, NOT sharp graph lines, NOT an
infrastructure diagram. Anchored on existing `color.primary` teal (164 39% 22%); may add ONE softer
secondary accent inside the mark only (not a new token — Phase 48 owns tokens). Deliverables:
committed SVG assets (full mark + square glyph for favicon/avatar slots), replacing the current "P"
letter avatar in the sidebar brand slot, the login card header, and the favicon. Monochrome variant
included for small sizes.

### D-47-03 (LOCKED): Brand guide lives in-repo
`docs/design/brand-guide.md` (sits beside the existing `docs/design/product-register-and-bans.md`,
which stays authoritative for bans — glassmorphism ban etc. — the brand guide references it, never
contradicts it). Contents: voice principles + do/don't table, mark usage (clear space, min sizes,
monochrome rules), the USER-LOCKED naming record (polytoken / polytoken.ai; alternates purged; the `polytoken`
CLI-tool collision at docs.polytoken.dev explicitly accepted by the user 2026-07-10), and an
explicit "user-gated" list (domain purchase, trademark search/filing).

### D-47-04 (LOCKED): Playwright toolchain shape
`@playwright/test` as a devDependency (workspace root or apps/web per repo convention — planner
researches which; chromium builds already at %LOCALAPPDATA%/ms-playwright, firefox needs
`npx playwright install firefox`). A minimal `playwright.config.ts` with two projects
(chromium, firefox). The two parked specs must pass: `apps/web/e2e/code-island-isolation.spec.ts`
on BOTH engines (closes DEF-20-01 + todo 2026-07-10, resolves_phase: 47) and
`apps/web/e2e/auth-redirect.spec.ts` (signed-out → /login redirect; runs without OAuth setup since
it never signs in). Auth-dependent E2E beyond that stays out of scope (OAuth client is user-gated).

### D-47-05 (LOCKED): Screenshot harness
A committed script (npm script, e.g. `screenshot:review`) driving Playwright to capture the app's
main surfaces (login, inbox, /chat, /knowledge, /studio, /settings/forwarding) across viewports
(mobile 390px / desktop 1440px). Signed-out surfaces capture as-is; auth-gated surfaces are
best-effort — if no session is available, capture the redirect target and document the limitation
(the harness must not fake auth). Output: timestamped PNG set + an index markdown under
`.planning/ui-reviews/` (gitignored per the existing `.planning/ui-reviews/.gitignore` convention)
— an artifact the UI reviewer and later phases consume. Per-pack capture applies only to surfaces
where a pack switcher exists (studio); others capture the default pack.

### D-47-06 (LOCKED): Copy sweep scope for BRND-01
This phase updates BRAND-visible copy only: login card, sidebar chrome (brand name/avatar slot,
sign-out affordance labels), page `<title>`s, empty states, and toast messages that exist today.
It does NOT restructure layouts or components (Phase 49). Tone shift examples the planner should
encode concretely: "Sign in to continue" → warm first-person equivalents; empty inbox → companion
framing. All copy changes are string-level.

### Claude's Discretion
- Exact SVG geometry of the mark (within D-47-02 constraints), asset file locations, favicon
  generation approach (static .svg/.ico in apps/web per Next.js conventions).
- Screenshot harness internals (single spec file vs script + CLI runner).
- Whether firefox install lands in package.json postinstall or documented command (document-only is
  fine; CI is out of scope this phase).
</decisions>

<code_context>
## Existing Code Insights

- Sidebar brand slot: `apps/web/src/components/app-sidebar.tsx` (Phase 42 set the "P" avatar
  glyph + polytoken name; 43-02 added the sign-out button beside it).
- Login card: `apps/web/src/app/login/page.tsx` + `_components/google-signin-button.tsx`.
- E2E specs already authored: `apps/web/e2e/{code-island-isolation,auth-redirect}.spec.ts` —
  written for @playwright/test, never executed on real browsers.
- Design bans: `docs/design/product-register-and-bans.md` (glassmorphism ban item 3 — the brand
  guide must not license new blur).
- `.planning/ui-reviews/` exists with a .gitignore (created by the 45 UI review) — reuse it.
- Dev server needs root `.env.local` via `dotenv -e ../../.env.local -- next dev`; NEXT_PUBLIC
  Supabase vars present; local supabase = old nauta containers, up.

</code_context>

<specifics>
## Specific Ideas

- The mark should read as both "node cluster" and something organic — the dossier's phrase is
  "node/brain hybrid"; secondary motif license: "borrow node/constellation geometry as a secondary
  visual motif" (Recommendation paragraph).
- VRFY-01's spec run is the acceptance gate that finally closes the chain: DEF-20-01 (v1.2) →
  999.3 → 46-01 blocked → todo → HERE.

</specifics>

<deferred>
## Deferred Ideas

- (superseded) Any product rename — PURGED by the user 2026-07-10: the name is polytoken, permanently.
- Marketing-site brand application — post-v1.8.
- CI integration of Playwright runs — local-only this milestone.

</deferred>

---

*Phase: 47-brand-foundation-verification-tooling*
*Context gathered: 2026-07-10 via autonomous smart discuss*
