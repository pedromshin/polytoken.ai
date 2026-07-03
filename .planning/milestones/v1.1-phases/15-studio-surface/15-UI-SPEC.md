---
phase: 15
phase_name: studio-surface
status: approved
design_system: shadcn (pre-existing — no new tokens, no new initialization)
registry: shadcn official only
generated: "2026-06-27"
reviewed_at: "2026-06-27"
---

# UI-SPEC — Phase 15: Studio Surface

## Scope

This phase delivers ONE new route: `/studio` (the studio landing), a developer-facing surface with
two tab-switched sections — **Catalog Browser** (STDO-01) and **Generation Sandbox** (STDO-02 /
STDO-03 / STDO-04) — mounted inside the existing frosted app shell.

The existing `/studio/preview` route is kept as-is (the Phase 12 hardcoded showcase + JSON split).
The sidebar "Studio" nav item is repointed from `/studio/preview` to `/studio` (D-14).

**This spec EXTENDS Phase 12 (12-UI-SPEC). It introduces NO new design system, NO new tokens, NO
new fonts, and NO new color roles.** Every design decision in §§1-4 below is inherited directly
from 12-UI-SPEC. Only the layout, component inventory additions, interaction contract, states,
copywriting, and a11y sections contain new material.

---

## 1. Design System

**Tool:** shadcn (pre-existing, no new initialization needed)
**Source:** `apps/web/src/app/globals.css` — tokens already defined; `packages/ui/src/` — ~35
components available.

No new components installed. No new tokens introduced. Registry: shadcn official only.
No third-party registries. Safety gate: not applicable.

**Binding constraint (D-13):** The studio must look and behave like an extension of
`/studio/preview`. A reviewer should not be able to distinguish the shell chrome of
`/studio` from `/studio/preview`.

---

## 2. Spacing

Inherited verbatim from 12-UI-SPEC §2. No exceptions declared for this phase.

| Token | px | Usage |
|-------|----|-------|
| 4px   | 1  | icon gap, inline badge/chip padding |
| 8px   | 2  | intra-section gap, compact padding, tab trigger gap |
| 16px  | 4  | card padding, section gap, tab content padding |
| 24px  | 6  | between split panes (ResizablePanelGroup horizontal gap) |
| 32px  | 8  | page-level breathing |
| 48px  | 12 | not used this phase |
| 64px  | 16 | not used this phase |

**Touch targets:** icon-only buttons minimum 44px × 44px (inherited convention).

---

## 3. Typography

Inherited verbatim from 12-UI-SPEC §3. Exactly 3 sizes, 2 weights.

| Role | Size | Weight | Line-height | Class |
|------|------|--------|-------------|-------|
| Page heading / tab labels | 14px (text-sm) | 600 (font-semibold) | 1.25 | `text-sm font-semibold text-foreground` |
| Body / prop table labels / intent textarea | 14px (text-sm) | 400 (font-normal) | 1.5 | `text-sm text-foreground` |
| Meta / muted / chip labels / pane section headers | 12px (text-xs) | 400 (font-normal) | 1.4 | `text-xs text-muted-foreground` |

**JSON inspector pane:** `font-mono text-xs` — single exception to sans rule, same as 12-UI-SPEC.

**Catalog prop table type labels:** `font-mono text-xs` — code identifiers (Zod kind names, enum
values). Same mono exception as the JSON pane; applies only to the `typeLabel` column cells.

---

## 4. Color Contract

Inherited verbatim from 12-UI-SPEC §4. No new tokens.

### 60/30/10 Split

| Role | Token | Usage |
|------|-------|-------|
| 60% dominant surface | `--background` | Page surface, pane backgrounds, tab content area |
| 30% secondary | `--card` / `--muted` | Catalog entry cards (`bg-card`); JSON pane (`bg-muted`); sandbox result section background |
| 10% accent | `--primary` | Active nav item; **cache-hit chip** (see §8 generation states — this phase adds one new accent usage) |

### Semantic Colors — Reserved-For List (additive over Phase 12)

| Color | Token | Reserved exclusively for |
|-------|-------|--------------------------|
| Primary teal | `--primary` | Active nav item; **cache-hit "Cache hit · 0 LLM cost" chip** (new in this phase) |
| Destructive red | `--destructive` | **Fallback banner** (`bg-destructive/10 border-destructive/30 text-destructive`) — new in this phase; `NodeErrorFallback` (inherited) |
| Muted gray | `--muted` | JSON pane background; sandbox result section; catalog prop table row alternation |
| Border | `--border` | Pane dividers; header bottom border; card borders; tab container border |

**Phase 15 accent additions vs Phase 12:**
- `--primary` now also used for the cache-hit chip (teal `Badge variant="default"` or
  `className="bg-primary/10 text-primary border-primary/30"`).
- `--destructive` now used for the fallback banner. `NodeErrorFallback` usage is inherited.
- No other color additions. The cold-generation chip and escalated sub-flavor use
  `variant="secondary"` (muted gray) — no new color.

### Dark Mode

All tokens have `.dark` overrides in `globals.css`. No additions. The studio landing inherits
the existing system-theme toggle from the shell.

---

## 5. Component Inventory

All components from `packages/ui/src/` (`@nauta/ui`). No new installs.

### Shell Components (inherited — no new work)

| Component | Import | Purpose |
|-----------|--------|---------|
| `Sidebar` family | `@nauta/ui/sidebar` | Left rail (layout.tsx) |
| `SidebarInset` | `@nauta/ui/sidebar` | Content slot (layout.tsx) |
| `Toaster` | `@nauta/ui/sonner` | Toast notifications (layout.tsx) |

### Components inherited from `/studio/preview` (reused verbatim)

| Component | Import | Purpose |
|-----------|--------|---------|
| `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle` | `@nauta/ui/resizable` | 55/45 render-JSON split in sandbox (STDO-03) |
| `ScrollArea` | `@nauta/ui/scroll-area` | JSON pane scroll; catalog card scroll |
| `Badge` | `@nauta/ui/badge` | Registry version chip; generation-state chips; prop table locked marker |
| `Separator` | `@nauta/ui/separator` | Header bottom border; pane section dividers |

### New Components for `/studio` landing

| Component | Import | Purpose |
|-----------|--------|---------|
| `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` | `@nauta/ui/tabs` | Catalog / Sandbox / Showcase tab switcher (D-01) |
| `Textarea` | `@nauta/ui/textarea` | Natural-language intent input (STDO-02) |
| `Button` | `@nauta/ui/button` | "Generate" button (STDO-02); "Advanced" toggle for raw-content field |
| `Card` / `CardHeader` / `CardContent` | `@nauta/ui/card` | Per-catalog-entry cards in the browser (STDO-01) |
| `Input` | `@nauta/ui/input` | Optional inline filter over catalog entries (D-12, Claude's Discretion) |

### Client Islands (new — `"use client"` modules)

| Island | File | Purpose |
|--------|------|---------|
| `SpecRendererIsland` | `studio/_components/spec-renderer-island.tsx` (lifted from `preview/_components/`) | Shared `dynamic(ssr:false)` wrapper — used by both `/studio` and `/studio/preview` |
| `CatalogBrowserIsland` | `studio/_components/catalog-browser-island.tsx` | Imports `NAUTA_CATALOG` directly (D-10); renders entry cards with live examples |
| `GenerationSandboxIsland` | `studio/_components/generation-sandbox-island.tsx` | Intent input, Generate button, four-state output, ResizablePanelGroup render+JSON split |

### Catalog Components (rendered BY the interpreter — not imported by the page)

Unchanged from 12-UI-SPEC §5. The 10 `NAUTA_CATALOG` entries (`text`, `badge`, `button`, `card`,
`key-value-list`, `separator`, `alert`, `table`, `stack`, `grid`) are resolved by `SpecRenderer`
from `COMPONENT_REGISTRY` — the page islands do not import them directly.

### Error Boundary Fallback

`NodeErrorFallback` inherited from Phase 12 (`bg-destructive/10 border border-destructive/30
text-destructive text-xs rounded-md px-3 py-2`). Unchanged.

---

## 6. Layout: `/studio` Landing Page

### Page Shell

```
┌─ SidebarInset (full viewport minus sidebar width) ────────────────────────────────────────────┐
│  ┌─ header (h-12, border-b border-border/50) ─────────────────────────────────────────────┐  │
│  │  "Studio"   [text-sm font-semibold]      [Registry a3f1bc42]  [v1]                     │  │
│  └────────────────────────────────────────────────────────────────────────────────────────┘  │
│  ┌─ Tabs (flex-1, min-h-0, flex flex-col) ────────────────────────────────────────────────┐  │
│  │  ┌─ TabsList (shrink-0, px-4, border-b border-border/50) ──────────────────────────┐   │  │
│  │  │  [Catalog]  [Sandbox]  [Showcase ↗]                                             │   │  │
│  │  └──────────────────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                                          │  │
│  │  ┌─ TabsContent "catalog" (flex-1, overflow-y-auto) ──────────────────────────────┐    │  │
│  │  │  [optional filter input]                                                        │    │  │
│  │  │  ┌─ card ─┐  ┌─ card ─┐  ┌─ card ─┐  …10 cards, 2-col grid on wide           │    │  │
│  │  │  │ type   │  │ type   │  │ type   │                                             │    │  │
│  │  │  │ desc   │  │ desc   │  │ desc   │                                             │    │  │
│  │  │  │ live   │  │ live   │  │ live   │                                             │    │  │
│  │  │  │ render │  │ render │  │ render │                                             │    │  │
│  │  │  │ props  │  │ props  │  │ props  │                                             │    │  │
│  │  │  │ slots  │  │ slots  │  │ slots  │                                             │    │  │
│  │  │  └────────┘  └────────┘  └────────┘                                             │    │  │
│  │  └────────────────────────────────────────────────────────────────────────────────┘    │  │
│  │                                                                                          │  │
│  │  ┌─ TabsContent "sandbox" (flex-1, flex flex-col) ────────────────────────────────┐    │  │
│  │  │  ┌─ intent bar (shrink-0, px-4 py-3, border-b border-border/50) ─────────────┐ │    │  │
│  │  │  │  [Textarea intent placeholder]                  [Generate]                 │ │    │  │
│  │  │  │  [Advanced ▾] → raw content Textarea (collapsible)                        │ │    │  │
│  │  │  └─────────────────────────────────────────────────────────────────────────── ┘ │    │  │
│  │  │  ┌─ result area (flex-1, min-h-0) ────────────────────────────────────────── ┐ │    │  │
│  │  │  │  [state chrome: spinner / fallback banner / cache chip / cold chip]        │ │    │  │
│  │  │  │  ┌─ ResizablePanelGroup horizontal ─────────────────────────────────────┐ │ │    │  │
│  │  │  │  │  Panel 55% — SpecRendererIsland output  │  Panel 45% — JSON pane     │ │ │    │  │
│  │  │  │  └──────────────────────────────────────────────────────────────────────┘ │ │    │  │
│  │  │  └──────────────────────────────────────────────────────────────────────── ── ┘ │    │  │
│  │  └────────────────────────────────────────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

### Header — `/studio` Page

- Height: `h-12 shrink-0 px-4` — matches `/studio/preview` and `/knowledge` exactly.
- Left: `<h1 className="text-sm font-semibold text-foreground">Studio</h1>`
- Right (`ml-auto flex items-center gap-2`):
  - Registry version chip: `<Badge variant="secondary" className="font-mono text-xs">Registry {REGISTRY_VERSION.version.slice(0, 8)}</Badge>` — rendered server-side (T-12-15, Node crypto constraint).
  - Spec version chip: `<Badge variant="secondary">v1</Badge>` — static, indicates the spec schema version the engine targets.

### Tab Structure (D-01)

Tab order: **Catalog** | **Sandbox** | **Showcase**

- `TabsList` is `shrink-0` — it does not scroll.
- `TabsTrigger` labels: `text-sm` weight follows shadcn Tabs default (semibold when active).
- "Showcase" tab: renders as an `<a>` link pointing to `/studio/preview` (not a `TabsTrigger`
  that loads a `TabsContent`). Implemented as a plain `next/link` styled to match the TabsList
  visually — `text-sm text-muted-foreground hover:text-foreground flex items-center gap-1`.
  An `ExternalLink` icon (`lucide-react`, `size-3`, `aria-hidden`) signals it navigates away.
  This keeps the two main sections in one surface while preserving the Phase 12 route intact.

### Catalog Browser (STDO-01) — TabsContent "catalog"

Layout: `flex flex-col gap-4 p-4 overflow-y-auto`

- **Optional filter row** (Claude's Discretion — include): `Input` with `placeholder="Filter components…"` and `aria-label="Filter catalog components"`. Filters `NAUTA_CATALOG` entries by matching `type` or `description` (case-insensitive substring). Rendered above the card grid. `className="max-w-sm"`.

- **Entry grid**: `grid grid-cols-1 gap-4 xl:grid-cols-2` — single column on narrow, two columns on wide developer screens (≥1280px). No mobile breakpoints.

- **Per-entry card** (`@nauta/ui/card`): `className="flex flex-col gap-0"` — no extra spacing added; Card primitives handle internal padding.

  **Card structure (top to bottom):**

  ```
  ┌─ CardHeader (pb-2) ────────────────────────────────────────┐
  │  <code className="font-mono text-xs bg-muted px-1.5 py-0.5
  │         rounded text-foreground">{entry.type}</code>
  │  <p className="text-sm text-muted-foreground mt-1">
  │     {entry.description}</p>
  └────────────────────────────────────────────────────────────┘
  ┌─ CardContent (pt-0 pb-3) — live example render ────────────┐
  │  <div role="region" aria-label={`Live example: ${entry.type}`}
  │       className="rounded-md border border-border/50
  │                  bg-background p-4 min-h-[60px]">
  │    <SpecRendererIsland spec={wrappedExample} />
  │  </div>
  └────────────────────────────────────────────────────────────┘
  ┌─ CardContent (pt-0 pb-3) — prop schema table ──────────────┐
  │  <p className="text-xs font-semibold uppercase tracking-wide
  │      text-muted-foreground mb-2">Props</p>
  │  <table aria-label={`Props for ${entry.type}`}>
  │    thead: Name | Type | Required | Locked
  │    tbody: one row per prop from describePropsSchema(...)
  │  </table>
  └────────────────────────────────────────────────────────────┘
  ┌─ CardContent (pt-0 pb-4) — slot rules ─────────────────────┐
  │  <p className="text-xs font-semibold uppercase tracking-wide
  │      text-muted-foreground mb-2">Slots</p>
  │  [chip per slot name]  [children: yes/no chip]
  └────────────────────────────────────────────────────────────┘
  ```

**Prop table visual spec:**

| Column | Content | Class |
|--------|---------|-------|
| Name | prop name string | `font-mono text-xs text-foreground` |
| Type | Zod kind label (see §11 introspection rules) | `font-mono text-xs text-muted-foreground` |
| Required | "required" or "—" | `text-xs text-muted-foreground`; "required" in `text-foreground` |
| Locked | Badge if in `lockedProps` | `<Badge variant="outline" className="text-xs">locked</Badge>` or "—" |

Table: `w-full text-left border-collapse`. `thead` cells: `text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b border-border/50 pb-1`. `tbody tr`: `border-b border-border/30 last:border-0`.

**Slot chips spec:**

Each named slot: `<Badge variant="secondary" className="text-xs font-mono">{slotName}</Badge>`
Children: `<Badge variant={entry.acceptsChildren ? "secondary" : "outline"} className="text-xs">children: {entry.acceptsChildren ? "yes" : "no"}</Badge>`
If `entry.slots` is empty/undefined and `acceptsChildren` is false: render `<span className="text-xs text-muted-foreground">none</span>`.

### Generation Sandbox (STDO-02 / STDO-03 / STDO-04) — TabsContent "sandbox"

Layout: `flex flex-col h-full min-h-0`

**Intent bar** (top, `shrink-0`): `border-b border-border/50 px-4 py-3 flex flex-col gap-2`

- `Textarea` for intent: `placeholder="Describe the UI you want to generate…"`, `rows={3}`, `className="resize-none"`, `aria-label="Generation intent"`. Full width.
- Row below textarea: `flex items-center justify-between gap-2`.
  - Left: "Advanced" toggle button — `<Button variant="ghost" size="sm" aria-expanded={...} aria-controls="sandbox-advanced">Advanced <ChevronDown className="size-3 ml-1" aria-hidden /></Button>`. When expanded: shows a second `Textarea` (`rows={4}`, `placeholder="Paste raw content (email body, document text, …) — optional"`, `aria-label="Raw content context"`, `id="sandbox-advanced"`).
  - Right: `<Button variant="default" size="sm" disabled={isPending || !intent.trim()} aria-busy={isPending}>Generate</Button>`.

**Result area** (flex-1): `flex flex-col min-h-0`

- **State chrome row** (shrink-0, rendered only after first generation or while pending): `px-4 py-2 flex items-center gap-2 border-b border-border/50`. Contains the generation-state chip or spinner (see §8 States for full treatment).
- **ResizablePanelGroup** (flex-1, horizontal): identical structure to `studio/preview/page.tsx`.
  - Left panel `defaultSize={55} minSize={30}`: `role="region" aria-label="Rendered output"` — `SpecRendererIsland` output, `p-6 overflow-y-auto`.
  - `ResizableHandle` (no `withHandle` — developer tool).
  - Right panel `defaultSize={45} minSize={25}`: `role="region" aria-label="Spec JSON"` — JSON pane, `bg-muted`, pane label `text-xs font-semibold uppercase tracking-wide text-muted-foreground`, `ScrollArea`, `<pre className="p-4 font-mono text-xs text-foreground">`.

**Empty state** (before any generation): The result area shows the empty state instead of the ResizablePanelGroup (see §8).

**No mobile breakpoints.** Developer-only surface.

---

## 7. Interaction Contract

### Tab Navigation

| Interaction | Element | Behavior |
|-------------|---------|----------|
| Click tab | `TabsTrigger` | Switches visible `TabsContent`; shadcn Tabs manages focus and `aria-selected` |
| Click "Showcase" link | `next/link` styled link | Navigates to `/studio/preview` (full page nav, not tab switch) |
| Keyboard tab | `TabsList` | Left/right arrows move between Catalog and Sandbox triggers (shadcn default) |

### Catalog Browser

| Interaction | Element | Behavior |
|-------------|---------|----------|
| Type in filter | `Input` | Filters entry cards in real-time (no debounce needed at 10 entries); no-results state (see §8) |
| Resize pane | (none in catalog — no split panel) | n/a |
| Scroll | `overflow-y-auto` on TabsContent | Entire catalog scrolls vertically |

### Generation Sandbox

| Interaction | Element | Behavior |
|-------------|---------|----------|
| Type in intent | `Textarea` | Updates local state; enables Generate button when non-empty |
| Toggle Advanced | `Button (ghost)` | Expands/collapses raw-content `Textarea`; `aria-expanded` toggles |
| Click Generate | `Button (default)` | Fires `refetch()` on the `genui.generate` query (D-06: `enabled:false`, manually triggered); button `disabled` and `aria-busy="true"` while `isPending` |
| Generation resolves | query settles | `deriveGenerationState` computes state; UI renders state chrome + ResizablePanelGroup with result |
| Drag resize handle | `ResizableHandle` | Redistributes render/JSON split (same as `/studio/preview`) |
| Scroll JSON pane | `ScrollArea` | Scrolls spec JSON independently |
| Scroll render pane | `overflow-y-auto` | Scrolls rendered output if it exceeds pane height |

### Button States

| Button | Normal | Disabled | Pending |
|--------|--------|----------|---------|
| Generate | `variant="default"` | `disabled` when intent empty or `isPending` | `aria-busy="true"`, shows spinner icon left of label ("Generating…") |

---

## 8. States

### Sandbox Empty State (before first Generate)

Rendered in place of the ResizablePanelGroup when no result exists and `isPending` is false.

```
┌─ result area ─────────────────────────────────────────────────────────────────┐
│                                                                                │
│              [FlaskConical icon, size-8, text-muted-foreground/50]             │
│              Enter an intent above and click Generate                          │
│              [text-sm text-muted-foreground, centered]                         │
│                                                                                │
└───────────────────────────────────────────────────────────────────────────────┘
```

Container: `flex flex-col items-center justify-center gap-3 flex-1 text-center p-8`.

### Catalog Filter No-Results State

Rendered in place of the entry grid when the filter matches zero entries.

```
No components match "{filterValue}"
[text-sm text-muted-foreground]
```

Container: `flex items-center justify-center py-16 text-sm text-muted-foreground`.

---

## 9. Generation States — Visual Spec (STDO-04)

All four states are mutually exclusive, derived from `deriveGenerationState({ isPending, outcome, cacheHit, reason })` (D-04). The pure helper returns `{ kind: "in_progress" | "fallback" | "cache_hit" | "cold"; escalated: boolean; reason?: string }`.

### State Chrome Location

The state chrome row sits between the intent bar and the ResizablePanelGroup. It is `shrink-0`, `px-4 py-2`, `border-b border-border/50`. It is rendered when `kind !== undefined` (i.e. a generation is in progress or has completed). It is NOT rendered in the empty state.

### (a) In-Progress — `kind === "in_progress"`

```
┌─ state chrome ──────────────────────────────────────────────────────────────┐
│  [Loader2 icon, size-4, animate-spin, text-muted-foreground]                 │
│  Generating…    [text-sm text-muted-foreground]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

- `Loader2` icon from `lucide-react`, `className="size-4 animate-spin text-muted-foreground"`, `aria-hidden`.
- Copy: `"Generating…"` — `text-sm text-muted-foreground`. NOT "Streaming" (D-02, honesty constraint).
- The ResizablePanelGroup is NOT shown while in-progress. The result area shows only the state chrome row + below it: the empty-state placeholder (skeleton-free; the empty state icon/copy is replaced by nothing — just the chrome and a blank flex-1 below it, `bg-muted/30`).
- `aria-live="polite"` on the state chrome container so screen readers announce state transitions.

### (b) Validation Failure + Fallback — `kind === "fallback"`

```
┌─ state chrome ──────────────────────────────────────────────────────────────┐
│  [AlertTriangle icon, size-4, text-destructive]                              │
│  Validation failed — showing a safe fallback   [text-sm text-destructive]    │
│  {reason if present — text-xs text-muted-foreground, truncated 1 line}       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Background of state chrome row: `bg-destructive/5` (a tint — not a full banner background, keeping visual weight proportional). The state chrome row gets `border-destructive/30`.

- `AlertTriangle` icon from `lucide-react`, `className="size-4 shrink-0 text-destructive"`, `aria-hidden`.
- Primary copy: `"Validation failed — showing a safe fallback"` — `text-sm text-destructive font-medium`.
- Secondary copy (reason): `{reason}` when present — `text-xs text-muted-foreground` truncated to one line with `truncate`. Omitted when `reason` is undefined.
- `role="alert"` on the state chrome container (immediately announces to screen readers).
- The ResizablePanelGroup IS shown — it renders the `SAFE_FALLBACK_SPEC`. The JSON pane shows the fallback spec JSON. The developer can inspect what the fallback looks like.

### (c) Cache Hit — `kind === "cache_hit"`

```
┌─ state chrome ──────────────────────────────────────────────────────────────┐
│  <Badge className="bg-primary/10 text-primary border-primary/30
│          border text-xs font-medium">Cache hit · 0 LLM cost</Badge>         │
└──────────────────────────────────────────────────────────────────────────────┘
```

- No icon separate from the chip. The chip is the full state signal.
- Copy: `"Cache hit · 0 LLM cost"` — a `Badge` with custom teal styling (`bg-primary/10 text-primary border border-primary/30`), `text-xs`.
- The `·` is a Unicode middle dot (U+00B7) — readable in mono and sans alike.
- State chrome background: default (`bg-background`) — no tint needed; the chip carries the signal.
- `aria-live="polite"` on state chrome container.
- The ResizablePanelGroup IS shown with the cached spec.

### (d) Cold Generation — `kind === "cold"`, `escalated === false`

```
┌─ state chrome ──────────────────────────────────────────────────────────────┐
│  <Badge variant="secondary" className="text-xs">Cold generation</Badge>      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Copy: `"Cold generation"` — `Badge variant="secondary"`, `text-xs`.
- Muted visual weight — cold generation is the baseline happy path, not a warning.
- State chrome background: default.
- `aria-live="polite"` on state chrome container.
- The ResizablePanelGroup IS shown with the generated spec.

### (d-escalated) Cold + Escalated Sub-Flavor — `kind === "cold"`, `escalated === true`

```
┌─ state chrome ──────────────────────────────────────────────────────────────┐
│  <Badge variant="secondary" className="text-xs">Cold · escalated to Sonnet  │
│  </Badge>                                                                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Copy: `"Cold · escalated to Sonnet"` — same `Badge variant="secondary"` treatment.
- This is a sub-flavor of cold (D-03d), not a fifth top-level state. Same visual weight as cold.
- The `·` separator matches the cache-hit chip convention.

### State Transition Summary

| `isPending` | `outcome` | `cacheHit` | `escalated` | `kind` | Visual |
|-------------|-----------|------------|-------------|--------|--------|
| true | any | any | any | in_progress | Spinner + "Generating…" |
| false | "fallback" | false | false | fallback | Destructive tint banner |
| false | "ok" | true | false | cache_hit | Teal chip |
| false | "ok" | false | false | cold | Muted "Cold generation" chip |
| false | "escalated" | false | true | cold (escalated=true) | Muted "Cold · escalated to Sonnet" chip |

---

## 10. Copywriting Contract

### Header (Phase 15 additions)

| Element | Copy |
|---------|------|
| Page label | `"Studio"` |
| Registry version chip | `"Registry {hash.slice(0, 8)}"` (inherited format) |
| Spec version chip | `"v1"` (static) |

### Tab Labels

| Tab | Copy | Notes |
|-----|------|-------|
| First tab | `"Catalog"` | Browseable component list |
| Second tab | `"Sandbox"` | Generation + preview surface |
| Third affordance | `"Showcase"` | Link to `/studio/preview`; no `TabsContent` |

### Intent Bar

| Element | Copy |
|---------|------|
| Textarea placeholder | `"Describe the UI you want to generate…"` |
| Generate button (idle) | `"Generate"` |
| Generate button (pending) | `"Generating…"` (with `Loader2` spinner icon left) |
| Advanced toggle (collapsed) | `"Advanced"` |
| Advanced toggle (expanded) | `"Advanced"` (chevron rotates 180deg via `rotate-180` class on icon) |
| Raw content placeholder | `"Paste raw content (email body, document text, …) — optional"` |

### Sandbox Empty State

| State | Copy |
|-------|------|
| No generation yet | `"Enter an intent above and click Generate"` |

### Catalog Filter

| State | Copy |
|-------|------|
| Filter input placeholder | `"Filter components…"` |
| No results | `"No components match \"{filterValue}\""` |

### Catalog Entry Cards

| Element | Copy |
|---------|------|
| Props section label | `"Props"` (uppercase via class) |
| Slots section label | `"Slots"` (uppercase via class) |
| Required prop marker | `"required"` |
| Locked prop badge | `"locked"` |
| Children: yes | `"children: yes"` |
| Children: no | `"children: no"` |
| No slots/children | `"none"` |

### Generation State Labels

| State | Copy | Location |
|-------|------|----------|
| In-progress | `"Generating…"` | State chrome, next to spinner |
| Fallback | `"Validation failed — showing a safe fallback"` | State chrome (destructive) |
| Fallback reason | `{reason}` if present | Truncated line below fallback label |
| Cache hit | `"Cache hit · 0 LLM cost"` | Teal chip in state chrome |
| Cold | `"Cold generation"` | Muted chip in state chrome |
| Cold escalated | `"Cold · escalated to Sonnet"` | Muted chip in state chrome |

### JSON Pane Label

`"Spec JSON"` — `text-xs font-semibold uppercase tracking-wide text-muted-foreground` (inherited from Phase 12).

### Sidebar Navigation Update

The "Studio" nav item copy stays `"Studio"`. Only `href` changes from `/studio/preview` to `/studio`. No copy change.

### No destructive confirmation dialogs this phase.

The fallback banner is informational, not an action. No destructive actions are initiated by the user in the studio.

---

## 11. Accessibility Contract

### Role Assignments (additions over Phase 12)

| Element | Role / Attribute |
|---------|-----------------|
| Tab container | shadcn `Tabs` — `role="tablist"` on `TabsList`; `role="tab"` + `aria-selected` on triggers; `role="tabpanel"` on `TabsContent` (shadcn handles) |
| "Showcase" link | `aria-label="Open Component Showcase"` (distinguishes from tab buttons) |
| Catalog tab content | `aria-label="Component catalog"` on `TabsContent` wrapper |
| Sandbox tab content | `aria-label="Generation sandbox"` on `TabsContent` wrapper |
| Intent Textarea | `aria-label="Generation intent"` |
| Raw content Textarea | `aria-label="Raw content context"`, `id="sandbox-advanced"` |
| Advanced toggle | `aria-expanded={isAdvancedOpen}`, `aria-controls="sandbox-advanced"` |
| Generate button (pending) | `aria-busy="true"` |
| State chrome container | `aria-live="polite"` (all states); `role="alert"` overrides for fallback state only |
| Live example region | `role="region" aria-label={`Live example: ${entry.type}`}` |
| Prop table | `aria-label={`Props for ${entry.type}`}` |
| Render pane | `role="region" aria-label="Rendered output"` (inherited) |
| JSON pane | `role="region" aria-label="Spec JSON"` (inherited) |
| Resize handle | Default shadcn `ResizableHandle` — `role="separator"` with keyboard support (inherited) |
| Catalog filter input | `aria-label="Filter catalog components"` |
| Filter no-results | `aria-live="polite"` on the card grid container |
| Loader2 spinner | `aria-hidden` |
| AlertTriangle icon | `aria-hidden` |
| ExternalLink icon (Showcase) | `aria-hidden` |
| ChevronDown icon (Advanced) | `aria-hidden` |

### Keyboard

| Key | Target | Behavior |
|-----|--------|----------|
| Tab | `TabsList` | Enters tab list |
| Left/Right arrows | `TabsTrigger` | Moves between Catalog / Sandbox triggers (shadcn default) |
| Tab (from last trigger) | "Showcase" link | Focus moves to the Showcase link |
| Enter / Space | `TabsTrigger` | Activates tab |
| Enter | "Showcase" link | Navigates to `/studio/preview` |
| Tab | Intent `Textarea` | Focuses intent input |
| Tab | Generate `Button` | Focuses Generate; Enter/Space fires generation |
| Tab | Advanced `Button` | Focuses Advanced toggle |
| Tab | `ResizableHandle` | Focusable; Left/Right arrows resize (shadcn default) |
| Tab | `ScrollArea` (JSON) | Enters scrollable region; arrow keys scroll |

### Color Contrast

All text uses `text-foreground` (AA compliant). `text-muted-foreground` used only for secondary labels (AA at 4.5:1 with existing project tokens). `text-destructive` on `bg-destructive/5` — verify AA in both themes (light: destructive HSL against near-white; dark: against near-black). `text-primary` on `bg-primary/10` — verify AA (teal on near-white in light; teal on near-black in dark).

The `bg-primary/10 text-primary` cache-hit chip is the same treatment used by the active nav item — already tested across both themes by the existing shell.

---

## 12. Prop Schema Introspection Rules (D-11 / `describePropsSchema`)

The pure `describePropsSchema(schema, lockedProps)` helper (unit-tested, immutable return) derives
human-readable prop rows from a `ZodObject`. Rules applied in order:

| Zod def kind | `typeLabel` output |
|-------------|-------------------|
| `ZodString` | `"string"` |
| `ZodNumber` | `"number"` |
| `ZodBoolean` | `"boolean"` |
| `ZodLiteral` | `"${value}"` (the literal value as string — e.g. `"true"`) |
| `ZodEnum` | values joined with pipe: `"body \| label \| caption \| heading"` |
| `ZodArray` | `"array"` (does not recurse into item type — keeps table readable) |
| `ZodObject` | `"object"` (nested schemas shown as opaque; introspection is one level deep) |
| `ZodRecord` | `"record"` |
| `ZodOptional` (wrapper) | unwrap and apply inner kind; mark `required = false` |
| `ZodDefault` (wrapper) | unwrap and apply inner kind; mark `required = false` |
| Any other kind | `"unknown"` |

`required` is `true` when the prop is non-optional in the schema (`!(schema._def.typeName === "ZodOptional")`).
`locked` is `true` when `propName` is in `lockedProps`.

**`describePropsSchema` does NOT throw.** If `schema._def.shape` is missing or throws, it returns
`[]` (empty rows) — the card renders "Props — (unavailable)" in `text-xs text-muted-foreground`.

---

## 13. Registry Version Chip — Visual Spec

Inherited verbatim from 12-UI-SPEC §12. Location: right side of `/studio` page header,
`ml-auto`. Format: `Registry {REGISTRY_VERSION.version.slice(0, 8)}`.
Rendered server-side in `studio/page.tsx` (Node crypto constraint, T-12-15).

The v1 spec-version chip is also server-side (static `SHOWCASE_SPEC.v` is `1`; the sandbox does
not display a per-result spec version chip to avoid cluttering the state chrome).

---

## 14. Catalog Entry Example — Wrapped SpecRoot Shape

Each catalog entry's live example (D-11 point 4) is rendered by wrapping `entry.example` in a
minimal `SpecRoot`:

```typescript
const wrappedExample: SpecRoot = {
  v: 1,
  root: {
    type: entry.type,
    props: entry.example,
    children: [],
  },
};
```

For layout/container types (`stack`, `grid`, `card`) the example renders the container shell with
no children — acceptable per D-11 ("layout/container entries render their example shell").

The `wrappedExample` is constructed inside `CatalogBrowserIsland` (client-side module). It is NOT
passed from a server component. `SpecRendererIsland` receives it directly.

---

## 15. Pre-Population Source Table

| Decision | Source |
|----------|--------|
| Design system = shadcn, pre-existing tokens | `globals.css` (detected), 12-UI-SPEC §1 |
| Primary color teal `164 39% 22%` | `globals.css` `--primary`, 12-UI-SPEC §4 |
| Typography scale (text-sm, text-xs, font-mono) | 12-UI-SPEC §3 |
| Spacing (8-point scale) | 12-UI-SPEC §2 |
| Header height `h-12 shrink-0 px-4` | `studio/preview/page.tsx` line 42, 12-UI-SPEC §6 |
| ResizablePanelGroup 55/45 split | `studio/preview/page.tsx` lines 65/82, 12-UI-SPEC §6 |
| JSON pane: `bg-muted font-mono text-xs ScrollArea` | `studio/preview/page.tsx` lines 82-99 |
| Registry version chip (server-side, font-mono) | `studio/preview/page.tsx` lines 54-57, 12-UI-SPEC §12 |
| `dynamic(ssr:false)` island pattern | `spec-renderer-island.tsx`, 12-UI-SPEC §6 |
| Sidebar nav pattern + `isActiveRoute` | `app-sidebar.tsx` lines 48-51 |
| Studio nav item: `href` changes to `/studio` | 15-CONTEXT.md D-14 |
| `FlaskConical` icon for Studio nav | `app-sidebar.tsx` line 43 |
| No mobile breakpoints | 15-CONTEXT.md D-13 (developer-only surface) |
| No new design tokens | 15-CONTEXT.md D-13 (binding constraint) |
| `NodeErrorFallback` color | 12-UI-SPEC §4/§5 |
| Four generation states + `deriveGenerationState` | 15-CONTEXT.md D-03/D-04 |
| Cache-hit chip = teal (primary/10) | 15-CONTEXT.md D-03c |
| Fallback banner = destructive/5 tint | 15-CONTEXT.md D-03b |
| Cold/escalated chip = secondary (muted) | 15-CONTEXT.md D-03d |
| "Generating…" label (not "Streaming") | 15-CONTEXT.md D-02 (honesty constraint) |
| Tabs (not sub-routes) for Catalog/Sandbox | 15-CONTEXT.md D-01 |
| Catalog: direct client import of NAUTA_CATALOG | 15-CONTEXT.md D-10 |
| Catalog: four facets per entry (type/desc/props/slots/example) | 15-CONTEXT.md D-11 |
| Catalog: Card grid layout (2-col xl) | 15-CONTEXT.md D-12 |
| Catalog filter: optional, included | 15-CONTEXT.md D-12 (Claude's Discretion) |
| Sandbox: `SpecRendererIsland` lifted to shared `studio/_components/` | 15-CONTEXT.md D-07 |
| Sandbox: `buildActionRegistry` wired (empty mutate seam) | 15-CONTEXT.md D-08 |
| Sandbox: ResizablePanelGroup render+JSON split (same structure) | 15-CONTEXT.md D-09 |
| Advanced raw-content field: collapsible | 15-CONTEXT.md (Claude's Discretion) |
| Generation metadata (attempts/latency): off | 15-CONTEXT.md (Deferred — requires new fields) |
| `describePropsSchema` introspection rules | 15-CONTEXT.md D-11, Claude's Discretion |
| Showcase as link (not tab with content) | 15-CONTEXT.md D-01, Claude's Discretion |

---

## 16. What This Phase Does NOT Spec

These are explicitly out of scope. Do not implement:

- True token-streaming UI (SSE, partial spec rendering) — v1.2
- Template browser / stored-template gallery — v1.2 (FLY-01/02)
- Mutation action wiring in the sandbox (mutate seam stays empty) — v1.2
- Generation metadata chips (attempts, latency, token counts) — requires new backend fields, deferred
- Server-built serialized catalog descriptor / per-tenant catalog filtering — v1.2 seam
- Nauta-flavored product wiring (email/entity surfaces) — post-v1.1
- Mobile/responsive studio layout — developer-only surface
- axe-core a11y CI on generated UI, eval/regression harness — v1.2
- Converting `genui.generate` to a tRPC mutation — clean follow-up

---

## 17. Open Questions

None. All design questions resolved from 15-CONTEXT.md decisions (D-01..D-15), 12-UI-SPEC
verbatim reuse, and Claude's Discretion areas applied with sensible defaults:

- Showcase affordance: link (not embedded tab content) — keeps Phase 12 route intact, avoids
  a third `SpecRendererIsland` mount in an idle tab.
- Catalog filter: included (one `Input`, real-time substring match, client-side).
- `SpecRendererIsland`: lifted to `studio/_components/` (shared between `/studio` and `/studio/preview`).
- `describePropsSchema` introspection: one-level deep, opaque `"array"`/`"object"` for nested,
  deterministic `"unknown"` fallback, never throws.
- Advanced raw-content: collapsible `<details>`-style via `aria-expanded` button — default
  collapsed so the demo surface is clean for intent-only generation.
- Generation metadata: OFF (requires new backend fields beyond D-05 scope).
