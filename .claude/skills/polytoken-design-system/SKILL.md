---
name: polytoken-design-system
description: Polytoken web design system — token source, @polytoken/ui conventions, and the shadcn CLI + registry vendor-and-adapt workflow. Use when building, styling, or reviewing any UI in apps/web or packages/ui.
---

# Polytoken Design System

## Stack pin (hard constraints)

- Tailwind **v4** (`@theme inline` + oklch tokens, CSS-first config) + React **19** + Next 15.
  Migrated in Phase 55 (STCK-01/STCK-02) — `packages/ui/components.json`'s `tailwind.config`
  is blank (`""`) per the v4 registry-install shape.
- Primitives: **Radix** (`@radix-ui/react-*`) — DECIDED, documented in
  [`docs/design/radix-vs-base-ui.md`](../../../docs/design/radix-vs-base-ui.md) (STCK-03).
  Upstream shadcn defaults to Base UI since July 2026, but its own changelog states Radix is
  not deprecated. `-b radix` is `shadcn init`-only (verified: no `--base` flag exists on
  `add` in the installed CLI) — never re-run `init` against this repo's `components.json`
  without it. This repo's existing `style: "new-york"` already pins canonical `@shadcn` `add`
  calls to Radix with no flag needed (verified live). Third-party registries (`@kibo-ui`,
  `@magicui`, `@coss`) have no Radix/Base-UI toggle at all — diff any payload before vendoring
  regardless.
- Third-party registry payloads are increasingly Tailwind v4-native (`@theme`, oklch) — this
  is now this repo's own shape too, so a v4/oklch payload usually needs **no adaptation**
  (see STCK-04 proof: a direct `shadcn add @kibo-ui/rating` install required zero v3/Base-UI
  changes). Still inspect every payload via `--dry-run --view` first — never auto-install
  blindly — but "adapt Tailwind v4 syntax to v3" is no longer a default step, only a
  contingency if a payload assumes a different token shape than this repo's.

## Where things live

- Components: `packages/ui/src/*.tsx` — FLAT, one file per component
  (no `components/ui/` nesting). Includes vendored clones from Magic UI
  (border-beam, marquee, confetti, number-ticker, …) and Kibo UI (code-block,
  dropzone, dialog-stack, tags, …) — already adapted to Tailwind v3; their
  keyframes live in `packages/tailwind-config/web.ts`.
- `cn` util: exported from the `@polytoken/ui` root (`packages/ui/src/index.ts`).
- Tokens: `apps/web/src/app/globals.css` — full-color-function CSS variables
  (`oklch(...)`), shadcn v4 `@theme inline` convention. Brand primary
  `oklch(38.9% 0.053 173.7)`. Sidebar tokens extended in
  `packages/ui/tailwind.config.ts` (IntelliSense-only file). Call sites read
  the var directly (`var(--primary)`), never re-wrapped in `hsl(...)`.
- Tailwind preset: `@polytoken/tailwind-config/web`.
- Import convention: `import { Button } from "@polytoken/ui/button"`,
  `import { cn } from "@polytoken/ui"`.
- This is an **npm workspaces** monorepo (NOT pnpm).
  Typecheck: `npm run typecheck -w @polytoken/ui`.

## Component discovery — read the catalog, don't search

**When composing a page, read `references/component-catalog.md` FIRST.** It
pre-enumerates every available component — all 55 local `@polytoken/ui` components
(including vendored Magic UI effects and Kibo UI utilities) plus all ~900
registry items (@shadcn, @kibo-ui, @magicui, @coss) with descriptions — so you
never need to stop and run `shadcn search` mid-build. Prefer local components
first; they have zero adaptation cost.

Refresh the catalog when registries drift or new components are vendored:
`node .claude/skills/polytoken-design-system/scripts/build-catalog.mjs`

## shadcn CLI workflow (vendor + adapt)

`packages/ui/components.json` wires the CLI and registries — `tailwind.config` is
blank (v4 shape, per shadcn v4 docs: "For Tailwind CSS v4, leave this blank"). Run
from `packages/ui/`.

- Discover: catalog first (above); fall back to `npx shadcn@latest search @kibo-ui -q <term>`
- Inspect: `npx shadcn@latest add <item> --dry-run --view`
  (import rewriting to `@polytoken/ui` conventions is correct in the payload; `-b`/`--base` is
  `init`-only in the installed CLI — there is no per-`add` override, see
  `docs/design/radix-vs-base-ui.md` §4)
- Diff vendored components against canonical: `npx shadcn@latest diff <name>`
- **DO NOT run plain `add`** — it resolves the write path through the package
  `exports` map and targets `src/index.ts/<name>.tsx` (broken). Instead:
  1. Copy the payload from `--dry-run --view` into `packages/ui/src/<name>.tsx`.
  2. **Since this repo's own tokens are now Tailwind v4/oklch (Phase 55), a v4-native
     payload usually needs NO adaptation** — verified live for `@kibo-ui/rating`
     (STCK-04 proof: the payload's classes, imports (`@polytoken/ui` convention
     already matched), and Radix-based runtime hook all landed unmodified). Only
     adapt if the payload assumes a different token/class shape than this repo's.
  3. Confirm the payload's own primitive import is Radix (`@shadcn` items: this repo's
     `style: "new-york"` already pins that with no flag needed, verified live; third-party
     registries have no toggle — read the payload's own imports at `--dry-run --view` time).
     If a needed component is Base-UI-only, treat that as the re-evaluation trigger in
     `docs/design/radix-vs-base-ui.md`, not a silent exception.
  4. Add runtime deps to `packages/ui/package.json` (check first — a dep may
     already be present, e.g. `@radix-ui/react-use-controllable-state` was
     already installed for `relative-time`/`dialog-stack`/`code-block`); `npm
     install` at root if a new one is needed.

## Approved external sources

| Registry | Use for | Caveat |
|---|---|---|
| `@shadcn` (canonical) | app UI staples | Base UI default since 2026-07 — diff first |
| `@kibo-ui` | complex app components (Gantt, Kanban, AI chat, dropzone) | v4-leaning payloads |
| `@coss` (ex-Origin UI) | input/button/dialog variants | Base UI-based now |
| `@magicui` | animated effects, polish | v4 + Motion; v3 legacy docs at v3.magicui.design |
| `@tweakcn` | theme presets | generate, then hand-port variables into globals.css `:root` |

- 21st.dev Magic MCP: do not use (abandoned early 2026).
- shadcn MCP server: intentionally not wired — the skills + CLI path is
  preferred (lower token cost; GSD subagents with `tools:` restrictions
  can't see MCP tools anyway).

## Gotchas

- Edits to `packages/tailwind-config/web.ts` (keyframes/animations) do NOT
  reach a dev server whose `apps/web/.next/cache` predates the edit — the
  transpiled preset is cached. Fix: stop the server, delete
  `apps/web/.next/cache`, restart.
- Stopping `npm run dev` on Windows can orphan the `next dev` child, which
  keeps holding the port. Verify with `Get-NetTCPConnection -LocalPort <port>`
  and kill the owning PID.
- Visual smoke surface: `/dev/components` renders every vendored
  registry component (apps/web/src/app/dev/components/page.tsx) — extend it
  when vendoring more.
- Consultation page: `/dev/design` is the generated design-system reference —
  every component rendered live (49/55; variant matrices driven by extracted
  CVA data) alongside all tokens with light/dark values, motion utilities, and
  each component's props/defaults/variants/token-refs. Preview registry:
  `apps/web/src/app/dev/design/previews-*.tsx`. Regenerate the data after
  token or component changes:
  `node .claude/skills/polytoken-design-system/scripts/build-design-data.mjs`

## Design quality bar

- The `frontend-design` plugin skill (user scope) sets the aesthetic floor —
  follow it for any new surface.
- Verify UI work visually: run the app and screenshot via the existing
  playwright-core loop before declaring it done.
- GSD integration: this file is auto-read by `gsd-ui-researcher` during
  `/gsd:ui-phase` and by `gsd-ui-auditor` during `/gsd:ui-review`. Keep it
  current when tokens or conventions change.
