# Polytoken Brand Guide

> Working reference doc, not marketing prose. Sits beside
> [`product-register-and-bans.md`](./product-register-and-bans.md), which stays authoritative
> for the absolute bans (glassmorphism, gradient text, etc.) — this guide references those bans,
> it never restates or contradicts them.

## 1. USER-LOCKED naming

**Verbatim user decision (2026-07-10):**

> "everything will be called polytoken and domain polytoken.ai. everything else is purged."

This is a USER-LOCK (D-47-01) that overrides all prior brand-direction research. Consequences:

- The product is named **polytoken** everywhere — every surface, every doc, every commit message.
- The domain of record is **polytoken.ai** — recorded here as the target domain; it has **not**
  been purchased (see §5).
- Every alternate brand direction previously explored during early v1.8 brand research (four
  named directions — see `.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md` for the
  historical record) is **purged**. Those direction names must never appear in app copy or
  committed docs (enforced by the repo-level brand guard, §7) — this guide does not repeat them.
- There is no rename pending. The name is permanently polytoken.

## 2. Voice principles

The warm polytoken voice register carries over from the research dossier's warm/companion
direction tone analysis (see `BRAND-IDENTITY-OPTIONS.md`) — **as a tone only, not as a name**.
No alternate naming survives the USER-LOCK in §1.

- **Warm, human, companion** — the product reads like a second brain that already knows you, not
  a console you operate.
- **First-person framing** — "your workspace," "your inbox," "pick up where you left off."
- **Reference points:** Notion AI, Mem — approachable daily-use software, not developer tooling.
- **Never infrastructure vocabulary** in user-facing copy — no "node," "pipeline," "daemon,"
  "compute," "mesh," or similar systems language reaching the UI (that vocabulary is fine in code
  and docs; it must not leak into copy the user reads).

### Do / Don't (before → after, from real shipped surfaces)

| Surface | Don't (systems register) | Do (warm polytoken register) |
|---|---|---|
| Login card title | "Sign in to Polytoken" | "Welcome back to your workspace" |
| Login card description | "Use your Google account to continue." | "Pick up right where you left off — sign in with Google." |
| Inbox page `<title>` | "Polytoken — Emails" | "Your inbox — Polytoken" |
| Chat home empty state heading | "Start a new conversation" | "Ask me anything" |
| Canvas empty state heading | "No panels yet" | "Panels will appear here" |
| Email reprocess success toast | "Email sent for reprocessing" | "On it — reprocessing this email" |

When writing new copy: keep error/warning toasts clear and actionable (do not soften urgency out
of them), and never stage a meta-critical aside about the product itself (banned — see
`product-register-and-bans.md` ban #13).

## 3. Mark usage

The mark is the `BrandMark` component
(`apps/web/src/components/brand-mark.tsx`) plus the static favicon it mirrors
(`apps/web/src/app/icon.svg`).

- **Geometry:** two interlocking soft-edged "lobe" shapes (an organic, brain-like reading) plus
  one small bridging circle "node" (a node-cluster reading) — deliberately not sharp graph lines
  and not a hand-drawn doodle (see ban #11).
- **Variants:** `variant="glyph"` is the square mark alone (sidebar avatar slot, login card
  header, favicon). `variant="lockup"` pairs the glyph with the "Polytoken" wordmark — reserved
  for future header/marketing-facing chrome (Phase 49), not consumed by any surface yet.
- **Tones:** `tone="brand"` (default) keeps the secondary lobe at `opacity-55` for the softer
  two-tone read. `tone="mono"` drops that opacity split to a single flat fill — **use `mono` at
  any render size at or below ~16px** (favicon, small avatar slots) where a semi-transparent
  overlap turns muddy.
- **Color:** the mark is `currentColor`-driven — it always inherits the `text-*` context it
  renders in (both current call sites use `text-primary`, i.e. `hsl(164 39% 22%)`). Never hardcode
  a color onto the mark; change the surrounding `text-*` class instead.
- **Clear space:** keep a minimum clear margin around the glyph equal to the width of the smaller
  "node" circle (roughly 1/8 of the glyph's bounding box) — do not crop the lobes or crowd the
  glyph against adjacent text/icons.
- **Minimum size:** do not render the glyph below `size-4` (16px); below that the two-lobe
  overlap and the small node circle stop reading clearly even in `mono` tone.
- **Never:** stretch the mark to a non-square aspect ratio, recolor individual shapes with
  separate raw colors, or add drop shadows/gradients/blur to the mark (glassmorphism ban, §6
  below).

## 4. Accepted collision (recorded risk, not a mitigation)

An existing local-first AI coding-agent dev tool is **also named `polytoken`**
(`docs.polytoken.dev`, npm package `polytoken`, `polytoken.com` registered) — an exact-name
collision in an adjacent (AI agent tooling) space, surfaced during v1.8 brand research
(`.planning/research/v1.8-design/BRAND-IDENTITY-OPTIONS.md`).

The user **explicitly accepted this collision on 2026-07-10** as part of the USER-LOCK in §1.
This is recorded here as an **accepted risk**, not something the product's copy or brand voice is
designed to work around. Do not write copy that dances around the collision, disclaims it, or
otherwise references it in-product — the warm polytoken voice register (§2) is a tone choice
grounded in the product's own north star, not a mitigation for this collision.

## 5. NOT done — user-gated

The following are explicitly **not done** and require the user's direct action (external
dashboards, purchases, legal filings — out of scope for any autonomous phase):

- **Domain purchase** — `polytoken.ai` is the domain of record per §1 but has **not** been
  purchased/registered.
- **Trademark search / filing** — no trademark search or filing has been performed for
  "polytoken" in any jurisdiction. The accepted collision in §4 means a search is advisable before
  any commercial launch, but it has not happened.

No other user-gated items exist for the brand decision itself.

## 6. Bans this guide never overrides

`product-register-and-bans.md` remains authoritative for the app's absolute design bans (the
13-item checklist, including item 3's glassmorphism ban and item 11's hand-drawn-illustration
ban). This brand guide does not license blur, frosted-glass panels, gradients, or sketchy
illustration on the mark or anywhere else — see that doc for the full list.

## 7. Repo-level brand guard

None of the superseded direction names from `BRAND-IDENTITY-OPTIONS.md` (§1) may appear in app
source (`apps/web/src`) or any committed doc under `docs/`. This is enforced by a repo-level grep
guard scoped to those two paths — see `47-03-PLAN.md`'s acceptance criteria for the exact command.
Historical research files under `.planning/research/` are intentionally exempt and retained as a
record of the superseded directions.

---

*Phase: 47-brand-foundation-verification-tooling*
*Established: 2026-07-10 (D-47-01, D-47-02, D-47-03)*
