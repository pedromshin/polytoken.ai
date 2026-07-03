---
phase: 12
phase_name: catalog-spec-schema-and-trusted-interpreter
status: approved
design_system: shadcn (existing — detected via packages/ui + globals.css tokens)
registry: shadcn official only
generated: "2026-06-27"
reviewed_at: "2026-06-27"
---

# UI-SPEC — Phase 12: Catalog, Spec Schema, and Trusted Interpreter

## Scope

This phase delivers ONE new route: `/studio/preview`. It is a thin developer-facing surface that mounts the hardcoded sample spec side-by-side with its raw JSON. No input controls, no intent field, no generation states — those are Phase 15. This spec covers only what Phase 12 must render.

The `/studio/preview` page is a **client island** (`dynamic(ssr:false)`), identical to the `/knowledge` pattern. It lives inside the existing app shell (frosted left rail + SidebarInset).

---

## 1. Design System

**Tool:** shadcn (pre-existing, no new initialization needed)
**Source:** `apps/web/src/app/globals.css` — tokens already defined; `packages/ui/src/` — ~35 components available

No new components need to be installed. No new tokens are introduced. Registry: shadcn official only. No third-party registries. Safety gate: not applicable.

---

## 2. Spacing

Standard 8-point scale. All spacing uses multiples of 4px only.

| Token | px | Usage |
|-------|----|-------|
| 4px   | 1  | icon gap, inline badge padding |
| 8px   | 2  | intra-section gap, compact padding |
| 16px  | 4  | card padding, section gap |
| 24px  | 6  | between split panes (horizontal gap) |
| 32px  | 8  | page-level top/bottom breathing |
| 48px  | 12 | (not used this phase) |
| 64px  | 16 | (not used this phase) |

**Touch targets:** icon-only buttons minimum 44px × 44px (sidebar ThemeToggle sets precedent at h-11).

**No exceptions declared for this phase.**

Source: project convention (existing routes use Tailwind spacing; no deviations detected).

---

## 3. Typography

Exactly 3 sizes, 2 weights. Matches existing app-wide convention extracted from `knowledge/page.tsx` and `app-sidebar.tsx`.

| Role | Size | Weight | Line-height | Class |
|------|------|--------|-------------|-------|
| Page heading | 14px (text-sm) | 600 (font-semibold) | 1.25 | `text-sm font-semibold text-foreground` |
| Body / labels | 14px (text-sm) | 400 (font-normal) | 1.5 | `text-sm text-foreground` |
| Meta / muted | 12px (text-xs) | 400 (font-normal) | 1.4 | `text-xs text-muted-foreground` |

No custom font stack. System `sans` (`fontFamily.sans`) as set in `apps/web/tailwind.config.ts`.

**JSON inspector pane:** uses `font-mono text-xs` — the single exception to the sans rule, required for code readability. This is the same `fontFamily.mono` already in the tailwind config.

---

## 4. Color Contract

Pre-populated from `globals.css`. No new tokens are introduced this phase.

### 60/30/10 Split

| Role | Token | HSL (light) | Usage |
|------|-------|-------------|-------|
| 60% dominant surface | `--background` | `0 0% 100%` | Page surface, pane backgrounds |
| 30% secondary | `--card` / `--muted` | `0 0% 100%` / `0 0% 96.1%` | JSON inspector pane background (`bg-muted`), rendered-output card border |
| 10% accent | `--primary` | `164 39% 22%` | Active sidebar nav item (`bg-primary/10 text-primary`); **no new accent usage added this phase** |

### Semantic Colors (reserved-for list)

| Color | Token | Reserved exclusively for |
|-------|-------|--------------------------|
| Primary teal | `--primary` | Active nav item highlight only (inherited from shell) |
| Destructive red | `--destructive` | Not used this phase |
| Muted gray | `--muted` | JSON pane background, `NodeErrorFallback` background |
| Border | `--border` | Divider between render pane and JSON pane; header bottom border |

### Node Error Fallback Color

`NodeErrorFallback` uses `bg-destructive/10 border border-destructive/30 text-destructive` — the only place destructive color appears, and only for isolated node errors. This matches the pattern set by `alert.tsx` with `variant="destructive"`.

### Dark Mode

All tokens already have `.dark` overrides in `globals.css`. No additions. The studio preview inherits the existing system-theme toggle.

---

## 5. Component Inventory

All components sourced from `packages/ui/src/` (`@nauta/ui`). No new installs.

### Shell Components (inherited — no new work)

| Component | Import | Purpose |
|-----------|--------|---------|
| `Sidebar` family | `@nauta/ui/sidebar` | Left rail (already in layout.tsx) |
| `SidebarInset` | `@nauta/ui/sidebar` | Content slot (already in layout.tsx) |
| `Toaster` | `@nauta/ui/sonner` | Toast notifications (already in layout.tsx) |

### New Components for `/studio/preview`

| Component | Import | Purpose in this phase |
|-----------|--------|-----------------------|
| `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` | `@nauta/ui/resizable` | Horizontal split: rendered output (left) / JSON inspector (right) |
| `ScrollArea` | `@nauta/ui/scroll-area` | Scrollable JSON inspector pane |
| `Badge` | `@nauta/ui/badge` | Registry version chip in header; `NodeErrorFallback` type label |
| `Separator` | `@nauta/ui/separator` | Header bottom border (or use `border-b border-border/50` class — either) |

### Catalog Components (rendered BY the interpreter — not imported by the page)

These are the components the `SpecRenderer` will resolve from `COMPONENT_REGISTRY`. The page itself does not import them directly; `renderNode()` does.

| Spec type key | `@nauta/ui` component | Notes |
|--------------|----------------------|-------|
| `text` | None (renders `<p>` / `<span>`) | House-built leaf |
| `badge` | `@nauta/ui/badge` | `variant` is LLM-settable |
| `button` | `@nauta/ui/button` | `variant`, `size` are LLM-settable; `onClick` is locked (ActionRegistry) |
| `card` | `@nauta/ui/card` | Named slots: `header`, `footer`, `children` |
| `key-value-list` | None (renders `<dl>`) | House-built leaf |
| `separator` | `@nauta/ui/separator` | `orientation` is LLM-settable |
| `alert` | `@nauta/ui/alert` | `variant` LLM-settable (`default`/`destructive`) |
| `table` | `@nauta/ui/table` | `columns` + `rows` as prop arrays |
| `stack` | None (renders `<div className="flex flex-col">`) | House-built layout |
| `grid` | None (renders `<div className="grid">`) | House-built layout; `cols` prop |

### Error Boundary Fallback (new — not in `@nauta/ui`)

`NodeErrorFallback` is a minimal inline component defined in `packages/genui`. It receives `{ nodeType: string; error: Error }` and renders a contained error card. It does NOT use `@nauta/ui/alert` to avoid circular dependency during the error render path.

```
[!] Unknown "badge" node — prop validation failed
```

Displayed as: `bg-destructive/10 text-destructive text-xs rounded-md px-3 py-2 border border-destructive/30`

---

## 6. Layout: `/studio/preview`

### Page Shell

```
┌─ SidebarInset (full viewport minus sidebar width) ───────────────────────────┐
│  ┌─ header (h-12, border-b border-border/50) ──────────────────────────────┐ │
│  │  "Component Showcase"   [text-sm font-semibold]   [v badge] [version id] │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│  ┌─ ResizablePanelGroup (horizontal, flex-1, min-h-0) ────────────────────┐  │
│  │  ┌─ Panel defaultSize=55 ──────────┐  │  ┌─ Panel defaultSize=45 ───┐  │  │
│  │  │                                 │  │  │                           │  │  │
│  │  │   SpecRenderer output           │  │  │  ScrollArea               │  │  │
│  │  │   (client island)               │  │  │  ┌──────────────────────┐ │  │  │
│  │  │                                 │  │  │  │  <pre>JSON</pre>      │ │  │  │
│  │  │   bg-background                 │  │  │  │  font-mono text-xs    │ │  │  │
│  │  │   p-6                           │  │  │  │  bg-muted             │ │  │  │
│  │  │   overflow-y-auto               │  │  │  │  p-4                  │ │  │  │
│  │  │                                 │  │  │  └──────────────────────┘ │  │  │
│  │  └─────────────────────────────────┘  │  └───────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Dimensions:**
- Header: `h-12 shrink-0 px-4` — matches `/knowledge` page header exactly
- Body: `flex-1 min-h-0` — fills remaining viewport height
- Render pane: `defaultSize={55}` (55% of available width), `minSize={30}`, padded `p-6`, `overflow-y-auto`
- JSON pane: `defaultSize={45}` (45% of available width), `minSize={25}`, `bg-muted`
- ResizableHandle: default shadcn handle (no `withHandle` grip needed — this is a developer tool)

**No mobile breakpoints.** This is a developer-only surface. No responsive layout required this phase.

---

## 7. Interaction Contract

### `/studio/preview` Page

This page is **read-only this phase**. No user input, no form controls, no mutations.

| Interaction | Element | Behavior |
|-------------|---------|----------|
| Resize pane | `ResizableHandle` | Drag to redistribute render / JSON split |
| Scroll JSON | `ScrollArea` (JSON pane) | Scroll long spec JSON independently |
| Scroll render | `overflow-y-auto` (render pane) | Scroll rendered output if it exceeds viewport |
| No click targets in rendered demo | — | The hardcoded spec may include a `button` component; button click is handled by `ActionRegistry` (which is an empty context this phase — clicks are no-ops, no error thrown) |
| Error boundary trigger | `NodeErrorFallback` | Malformed node renders inline error card; surrounding nodes continue rendering normally |

### Sidebar Navigation

Add "Studio" to `LIVE_NAV_ITEMS` in `app-sidebar.tsx`. Use `FlaskConical` icon from `lucide-react` (developer tool convention). Route: `/studio/preview`.

```typescript
{ href: "/studio/preview", label: "Studio", icon: FlaskConical }
```

Active state follows the exact same `isActiveRoute` logic and `bg-primary/10 text-primary` classes already used by all other nav items.

**No "Soon" badge.** Studio is live this phase (the preview subpage ships).

---

## 8. States

### Render Pane States

| State | Trigger | Visual |
|-------|---------|--------|
| Normal render | Valid hardcoded spec | Components rendered normally via `SpecRenderer` |
| Node error | `NodeErrorFallback` triggered by one malformed node | Inline error card at that node's position; siblings unaffected |
| Loading (SSR: false island) | Page first load | Next.js `dynamic` loading state — use `null` fallback (no skeleton; this is an instant-load static spec, not a data fetch) |

No empty state. The hardcoded spec always has content. No loading spinner needed because the spec is static (no network request).

### JSON Pane States

One state: always shows the spec JSON. No loading, no empty, no error.

---

## 9. Copywriting Contract

### Header

- Page label: **"Component Showcase"** — describes what the hardcoded demo is (generic showcase per D-17)
- Version chip label: **"v1"** — the `v` field from the spec root (`z.literal(1)`)
- Registry version label: **"Registry"** prefix + truncated content hash (first 8 chars) — e.g. `Registry a3f1bc42`

### JSON Pane Label

- Section label: **"Spec JSON"** — `text-xs font-semibold text-muted-foreground uppercase tracking-wide` above the `<pre>` block

### Node Error Fallback

- Template: `[!] "{type}" node — {reason}`
- Specific messages:
  - Prop validation failed: `[!] "badge" node — prop validation failed`
  - Unknown component: `[!] "foobar" node — component not in registry`

### Sidebar Navigation

- Nav label: **"Studio"** (not "Studio Preview", not "Gen UI" — single word, matches existing label style: "Inbox", "Knowledge")

### Empty `ActionRegistry` (no-op actions this phase)

No user-facing copy needed. Button `onClick` is silently no-op. No toast, no error. This is by design — Phase 13 wires real handlers.

### No destructive actions this phase.

---

## 10. Accessibility Contract

### Role Assignments

| Element | Role / Attribute |
|---------|-----------------|
| Render pane container | `role="region" aria-label="Rendered output"` |
| JSON pane container | `role="region" aria-label="Spec JSON"` |
| `NodeErrorFallback` | `role="alert"` (renders immediately on mount, no dismissal) |
| Resize handle | Default shadcn `ResizableHandle` — already has `role="separator"` and keyboard support |
| Sidebar "Studio" nav item | `aria-current="page"` when active (existing `isActiveRoute` pattern) |

### Keyboard

| Key | Target | Behavior |
|-----|--------|----------|
| Tab | ResizableHandle | Focusable; left/right arrows resize (shadcn default) |
| Tab | Sidebar nav | Full keyboard nav (existing shell) |

### Color Contrast

All text uses `text-foreground` (AA compliant — dark text on white, or white on dark). `text-muted-foreground` is used only for secondary labels where contrast ratio meets AA at 4.5:1 (existing project tokens). `NodeErrorFallback` uses `text-destructive` on `bg-destructive/10` — verify at AA in both themes.

### `aria-hidden`

Decorative icons in rendered catalog components (e.g. badge, alert) use `aria-hidden` — enforce in the catalog manifest entries under `lockedProps` or in the component's own implementation.

---

## 11. Component Catalog Manifest Visual Contract

The manifest itself is not a UI surface — it lives in `packages/genui/src/catalog/`. However, the following visual decisions constrain what the manifest must declare per component:

### Required a11y Props Per Component (CTLG-02 / D-04)

| Component | Required a11y prop | Zod constraint |
|-----------|--------------------|----------------|
| `button` | `aria-label: z.string()` | Required in `propsSchema` |
| `alert` | `title: z.string()` | Required (acts as accessible label) |
| `table` | `caption: z.string()` | Required |
| `badge` | No additional (text content is the label) | — |
| `text` | No additional (`children` is the text) | — |
| `card` | No additional | — |
| `key-value-list` | `label: z.string()` (list `aria-label`) | Required |
| `separator` | `aria-hidden: z.literal(true)` | Must be locked (decorative) |
| `stack` | `aria-label: z.string().optional()` | Optional (only required when stack is a landmark) |
| `grid` | `aria-label: z.string().optional()` | Optional |

### Locked Props (cannot be LLM-set)

| Component | Locked props |
|-----------|-------------|
| `button` | `type` (always `"button"` — never `"submit"` in generated UI), `onClick` (ActionRegistry dispatch only) |
| `separator` | `aria-hidden` (always `true`) |
| All | `key` (set by interpreter as structural-position key, never from spec) |
| All | `ref` |
| All | `dangerouslySetInnerHTML` (categorically absent from all manifest entries) |

---

## 12. Registry Version Chip — Visual Spec

Location: right side of header, aligned with `ml-auto`.

```
[Registry a3f1bc42]
```

Implementation: `<Badge variant="secondary" className="font-mono text-xs">Registry {version.slice(0, 8)}</Badge>`

Font: `font-mono` (exception — code identifier). Size: `text-xs`. The only place `font-mono` appears in the page chrome (as opposed to the JSON pane content).

---

## 13. Pre-Population Source Table

| Decision | Source |
|----------|--------|
| Design system = shadcn, existing tokens | `globals.css` (detected) |
| Primary color teal `164 39% 22%` | `globals.css` `--primary` |
| Typography scale (text-sm, text-xs, font-mono) | Existing routes (`knowledge/page.tsx`, `app-sidebar.tsx`) |
| Spacing (8-point scale) | Existing Tailwind usage across all routes |
| Sidebar nav pattern + active state | `app-sidebar.tsx` |
| Client island pattern (`dynamic ssr:false`) | `knowledge/_components/knowledge-graph-island.tsx` |
| Header height `h-12` | `knowledge/page.tsx` line 21 |
| ResizablePanel pattern | `@nauta/ui/resizable` (used in inbox three-pane) |
| No mobile breakpoints | CONTEXT.md D-17 (developer-only surface this phase) |
| NodeErrorFallback color | `destructive` token (D-14, SPEC-03) |
| Registry version as content hash | CONTEXT.md D-07 |
| "Studio" nav item | CONTEXT.md + ROADMAP.md Phase 12 success criterion 2 |
| JSON inspector side-by-side | CONTEXT.md D-19 |
| ActionRegistry is empty no-op this phase | CONTEXT.md deferred section |
| Spec `v: 1` in header badge | CONTEXT.md D-10 |
| Generic showcase (not Nauta-flavored) | CONTEXT.md D-17 |

---

## 14. What This Phase Does NOT Spec

These are explicitly out of scope (deferred per CONTEXT.md). Do not implement:

- Intent input field, generate button, streaming progress — Phase 15
- Generation-state indicators (streaming / validation failure / cache-hit) — Phase 15
- Catalog browser / browseable component list — Phase 15
- Error state for failed Bedrock generation — Phase 13
- Any tRPC procedure for generation — Phase 13
- `ui_spec_templates` database table — Phase 14
- Nauta-flavored spec (email/entity-bound) — v1.2 convergence

---

## 15. Open Questions (none)

All design questions were answered by CONTEXT.md decisions (D-01..D-24) and existing codebase patterns. No questions were escalated to the user.
