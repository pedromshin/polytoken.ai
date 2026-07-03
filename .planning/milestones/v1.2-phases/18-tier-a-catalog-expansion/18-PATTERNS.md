# Phase 18: Tier A — Catalog Expansion - Pattern Map

**Mapped:** 2026-06-30
**Files analyzed:** 14 new/modified files
**Analogs found:** 14 / 14

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/genui/src/catalog/manifest.ts` | catalog/manifest | CRUD | self (badge/button/card for @nauta/ui-wrap; stack/grid for house-built) | exact (extension) |
| `packages/genui/src/catalog/types.ts` | type contract | — | self | exact (SpecNodeType extension) |
| `packages/genui/src/schema/spec-schema.ts` | schema (wire) | request-response | self (ButtonNodeSchema, GridNodeSchema for container-with-children) | exact (extension) |
| `packages/genui/src/registry/component-registry.ts` | registry | — | self | exact (no change needed — auto-updates from NAUTA_CATALOG) |
| `packages/genui/src/registry/registry-version.ts` | utility (hash) | — | self | exact (SHA-256 auto-bumps on manifest change) |
| `packages/genui/src/renderer/render-node.tsx` | renderer | request-response | self (GridComponent child-iteration, positionalChildren pattern) | exact (colSpan extension) |
| `packages/genui/src/__tests__/manifest.test.ts` | test | — | self | exact (extension: add new entries + a11y blocks) |
| `packages/genui/src/studio/__tests__/catalog-example-render.test.tsx` | test | — | self | exact (extension: entry count + new types) |
| `packages/genui/src/studio/build-catalog-example-spec.ts` | utility | transform | self | exact (no change needed — generic over all entries) |
| `packages/genui/scripts/emit-bedrock-artifacts.ts` | script | file-I/O | self | exact (no change needed — calls buildGenuiPromptPayload which reads catalog) |
| `packages/genui/src/generation/artifact-builder.ts` | utility | transform | self | exact (no change needed — reads NAUTA_CATALOG dynamically) |
| `packages/genui/artifacts/spec.schema.json` | artifact | file-I/O | self (committed JSON Schema) | exact (re-emit after schema change) |
| `packages/genui/artifacts/genui-prompt.json` | artifact | file-I/O | self (committed prompt payload) | exact (re-emit after manifest change) |
| `packages/ui/src/avatar.tsx`, `input.tsx`, `tabs.tsx` | ui primitive | — | self (@nauta/ui shadcn/Radix primitives) | read-only source to wrap |

---

## Pattern Assignments

### 1. New `@nauta/ui`-backed leaf: `avatar` entry in `manifest.ts`

**Analog:** `badge` and `button` entries — the two simplest @nauta/ui wrappers.

**A. @nauta/ui import pattern** (`manifest.ts` lines 25-44 for existing leaves):
```typescript
import { Badge } from "@nauta/ui/badge";
import { Button } from "@nauta/ui/button";
// Phase 18 adds:
import { Avatar, AvatarImage, AvatarFallback } from "@nauta/ui/avatar";
import { Input } from "@nauta/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@nauta/ui/tabs";
```

**B. Type declaration pattern** (`manifest.ts` lines 63-75, BadgeProps/ButtonProps):
```typescript
// a11y-required prop (D-04) is NOT optional — hard-fail at parse if missing
type AvatarProps = {
  readonly src?: string;
  readonly alt: string;          // a11y-REQUIRED (D-04 / UI-SPEC §11) — NOT optional
  readonly fallback: string;     // initials — always present for image-load-fail path
  readonly size?: "sm" | "md" | "lg";
};
```

**C. Component function pattern** (`manifest.ts` lines 174-176, BadgeComponent = simplest wrap):
```typescript
function BadgeComponent({ label, variant = "default" }: BadgeProps): React.ReactElement {
  return React.createElement(Badge, { variant }, label);
}
// Avatar follows same shape but composes Avatar + AvatarImage + AvatarFallback:
function AvatarComponent({ src, alt, fallback, size = "md" }: AvatarProps): React.ReactElement {
  const sizeClass = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  return React.createElement(
    Avatar,
    { className: sizeClass },
    React.createElement(AvatarImage, { src, alt }),
    React.createElement(AvatarFallback, null, fallback),
  );
}
```

**D. ManifestEntry registration pattern** (`manifest.ts` lines 401-419, badge entry):
```typescript
badge: {
  type: "badge",
  description:
    "Inline badge chip for status labels...",
  example: {
    label: "Confirmed",
    variant: "default",
  },
  propsSchema: z
    .object({
      label: z.string(),
      variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
    })
    .strict(),       // .strict() is MANDATORY — Bedrock additionalProperties:false (D-22)
  lockedProps: [],
  acceptsChildren: false,
  component: BadgeComponent as AnyManifestEntry["component"],
},
// Avatar entry follows this shape; lockedProps: [] (no locked props on avatar)
```

**E. a11y-required field in propsSchema** — must be `z.string()` NOT `z.string().optional()`:
```typescript
// From manifest.ts lines 436-437 (button — the pattern to copy for alt/aria-label/label):
"aria-label": z.string(), // a11y-required: D-04 / UI-SPEC §11
// For avatar:
alt: z.string(),          // a11y-required (D-04) — same pattern, no .optional()
// For input:
label: z.string(),        // a11y-required (D-04) — rendered as associated <label>
// For nav:
"aria-label": z.string(), // a11y-required (D-04)
// For tabs:
"aria-label": z.string(), // a11y-required (D-04)
```

---

### 2. New `@nauta/ui`-backed leaf: `input` entry in `manifest.ts`

**Analog:** `button` entry — presentational leaf with a11y-required prop.

**Prop type** (presentational-only: no onChange/state — Phase 19):
```typescript
type InputProps = {
  readonly label: string;         // a11y-REQUIRED — rendered as <label> (D-04)
  readonly placeholder?: string;
  readonly type?: "text" | "email" | "password" | "number" | "search" | "tel" | "url";
  readonly disabled?: boolean;
  readonly defaultValue?: string;
};
```

**Component** (wraps `packages/ui/src/input.tsx` — `Input` is a plain `<input>` with CSS-var classes):
```typescript
// Input.tsx uses: bg-transparent, border-input, placeholder:text-muted-foreground
// focus-visible:ring-ring — all CSS-var tokens, no hardcoded colors (D-07/CTLG-09)
function InputComponent({ label, placeholder, type = "text", disabled = false, defaultValue }: InputProps) {
  const id = `input-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1.5" },
    React.createElement("label", { htmlFor: id, className: "text-sm font-medium text-foreground" }, label),
    React.createElement(Input, { id, type, placeholder, disabled, defaultValue }),
  );
}
```

**propsSchema** — `type` field is NOT locked (LLM may set it — it's an enum allowlist):
```typescript
propsSchema: z.object({
  label: z.string(),    // a11y-required
  placeholder: z.string().optional(),
  type: z.enum(["text", "email", "password", "number", "search", "tel", "url"]).optional(),
  disabled: z.boolean().optional(),
  defaultValue: z.string().optional(),
}).strict(),
lockedProps: [],   // no locked props — type is constrained by enum, not locked
```

---

### 3. New house-built composite: `nav` entry in `manifest.ts`

**Analog:** `key-value-list` entry — house-built composite with array of items, a11y-required label, no @nauta/ui component.

**Key-value-list pattern to copy** (`manifest.ts` lines 88-94, 230-249, 474-496):
```typescript
// Type: items array, required a11y label
type KeyValueListProps = {
  readonly label: string;    // a11y-required list aria-label
  readonly items: ReadonlyArray<{ readonly key: string; readonly value: string }>;
};
// Component: house-built <dl>
function KeyValueListComponent({ label, items }: KeyValueListProps): React.ReactElement {
  return React.createElement("dl", { "aria-label": label, className: "grid grid-cols-2 gap-1 text-sm" },
    ...items.map(({ key, value }) => React.createElement(React.Fragment, { key }, ...))
  );
}
// Entry: .strict(), acceptsChildren: false, lockedProps: []
```

**Nav specifics:**
```typescript
type NavProps = {
  readonly "aria-label": string;       // a11y-REQUIRED (D-04)
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly href: string;             // relative-only — validated by NavItemHrefSchema (see wire schema section)
    readonly current?: boolean;        // aria-current="page" when true
  }>;
  readonly orientation?: "horizontal" | "vertical";
};

function NavComponent({ "aria-label": ariaLabel, items, orientation = "horizontal" }: NavProps) {
  const isHorizontal = orientation === "horizontal";
  return React.createElement(
    "nav",
    { "aria-label": ariaLabel },
    React.createElement(
      "ul",
      { className: isHorizontal ? "flex flex-row gap-4" : "flex flex-col gap-1" },
      ...items.map(({ label, href, current }) =>
        React.createElement(
          "li",
          { key: href },
          React.createElement(
            "a",
            {
              href,
              "aria-current": current ? "page" : undefined,
              className: current
                ? "text-sm font-medium text-foreground underline underline-offset-4"
                : "text-sm text-muted-foreground hover:text-foreground transition-colors",
            },
            label,
          ),
        ),
      ),
    ),
  );
}
```

**nav propsSchema** — `href` validated against relative-href guard (see wire schema section):
```typescript
propsSchema: z.object({
  "aria-label": z.string(),   // a11y-required
  items: z.array(
    z.object({
      label: z.string(),
      href: z.string().startsWith("/").refine(noAbsoluteScheme, { message: "nav href must be relative" }),
      current: z.boolean().optional(),
    }).strict()
  ).min(1),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
}).strict(),
lockedProps: [],
acceptsChildren: false,
```

**CRITICAL — relative-href guard for nav.items[].href:**
Reuse `noAbsoluteScheme` and `ABSOLUTE_OR_SCHEME_PATTERN` from `packages/genui/src/schema/action-schema.ts` lines 75-83. The `NavigateActionSchema.href` field uses the same two-guard pattern (startsWith("/") + .refine(noAbsoluteScheme)):
```typescript
// action-schema.ts lines 75-97 — the pattern to COPY for nav item hrefs:
const ABSOLUTE_OR_SCHEME_PATTERN = /^([a-z][a-z0-9+\-.]*:|\/\/)/i;
function noAbsoluteScheme(href: string): boolean {
  return !ABSOLUTE_OR_SCHEME_PATTERN.test(href);
}
// manifest.ts nav items href field:
href: z.string()
  .startsWith("/", { message: "nav href must start with / (relative paths only)" })
  .refine(noAbsoluteScheme, { message: "nav href must not use an absolute scheme or //" }),
```

---

### 4. New house-built composite: `feed-item` entry in `manifest.ts`

**Analog:** `key-value-list` (house-built, no @nauta/ui component) + `card` (optional named slots pattern).

```typescript
type FeedItemProps = {
  readonly title: string;         // required — main label
  readonly subtitle?: string;
  readonly meta?: string;         // timestamp, category, etc.
  readonly avatarSrc?: string;    // optional leading media
  readonly avatarAlt?: string;    // required if avatarSrc is present — enforced by .refine()
  readonly avatarFallback?: string;
};

function FeedItemComponent({ title, subtitle, meta, avatarSrc, avatarAlt, avatarFallback }: FeedItemProps) {
  return React.createElement(
    "div",
    { className: "flex items-start gap-3 py-3 border-b border-border last:border-0" },
    avatarSrc !== undefined
      ? React.createElement(Avatar, { className: "h-9 w-9 shrink-0" },
          React.createElement(AvatarImage, { src: avatarSrc, alt: avatarAlt ?? "" }),
          React.createElement(AvatarFallback, null, avatarFallback ?? title.slice(0, 2)),
        )
      : null,
    React.createElement(
      "div",
      { className: "flex flex-col gap-0.5 min-w-0" },
      React.createElement("p", { className: "text-sm font-medium text-foreground truncate" }, title),
      subtitle !== undefined
        ? React.createElement("p", { className: "text-sm text-muted-foreground truncate" }, subtitle)
        : null,
      meta !== undefined
        ? React.createElement("p", { className: "text-xs text-muted-foreground" }, meta)
        : null,
    ),
  );
}
```

**Note on avatarAlt:** If `avatarSrc` is provided, `avatarAlt` is a11y-required. Use `.refine()` on the object schema:
```typescript
propsSchema: z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  avatarSrc: z.string().optional(),
  avatarAlt: z.string().optional(),
  avatarFallback: z.string().optional(),
}).strict().refine(
  (p) => p.avatarSrc === undefined || p.avatarAlt !== undefined,
  { message: "avatarAlt is required when avatarSrc is provided", path: ["avatarAlt"] },
),
lockedProps: [],
acceptsChildren: false,
```

---

### 5. New house-built (presentational): `tabs` entry in `manifest.ts`

**Analog:** `alert` entry (house-built shell around @nauta/ui, title a11y-required) + `tabs.tsx` from `packages/ui/src/tabs.tsx`.

The `@nauta/ui/tabs` (`packages/ui/src/tabs.tsx`) exports `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`. For presentational-only (declared `active` index, no click-switching), use Radix `defaultValue` set from the `active` prop. No `onValueChange` handler.

```typescript
type TabsProps = {
  readonly "aria-label": string;   // a11y-REQUIRED (D-04)
  readonly tabs: ReadonlyArray<{
    readonly label: string;
    readonly content: string;      // simple text content for Phase 18 (children = Phase 19)
  }>;
  readonly active?: number;        // 0-based index; defaults to 0
};

function TabsComponent({ "aria-label": ariaLabel, tabs, active = 0 }: TabsProps) {
  const activeTab = tabs[Math.max(0, Math.min(active, tabs.length - 1))];
  const defaultValue = String(active);
  return React.createElement(
    Tabs,
    { defaultValue, "aria-label": ariaLabel },
    React.createElement(
      TabsList,
      null,
      ...tabs.map((tab, i) =>
        React.createElement(TabsTrigger, { key: String(i), value: String(i), disabled: i !== active }, tab.label)
      ),
    ),
    // Render only the active panel (presentational: no click-switch in Phase 18)
    activeTab !== undefined
      ? React.createElement(TabsContent, { value: defaultValue }, activeTab.content)
      : null,
  );
}
```

**tabs propsSchema:**
```typescript
propsSchema: z.object({
  "aria-label": z.string(),     // a11y-required
  tabs: z.array(
    z.object({ label: z.string(), content: z.string() }).strict()
  ).min(1),
  active: z.number().int().min(0).optional(),
}).strict(),
lockedProps: [],
acceptsChildren: false,
```

---

### 6. New `section` layout primitive in `manifest.ts`

**Analog:** `stack` entry (house-built layout, no @nauta/ui, acceptsChildren: true).

**Stack pattern to copy** (`manifest.ts` lines 119-134, 318-334, 568-587):
```typescript
// stack type declaration:
type StackProps = {
  readonly direction?: "vertical" | "horizontal";
  readonly gap?: "none" | "sm" | "md" | "lg";
  readonly "aria-label"?: string;    // optional landmark
  readonly children?: React.ReactNode;
};
// stack component:
function StackComponent({ direction = "vertical", gap = "md", "aria-label": ariaLabel, children }: StackProps) {
  const gapClass = gap === "none" ? "gap-0" : gap === "sm" ? "gap-2" : gap === "lg" ? "gap-6" : "gap-4";
  const flexClass = direction === "horizontal" ? "flex flex-row" : "flex flex-col";
  return React.createElement("div", { className: `${flexClass} ${gapClass}`, "aria-label": ariaLabel }, children);
}
// stack propsSchema:
propsSchema: z.object({
  direction: z.enum(["vertical", "horizontal"]).optional(),
  gap: z.enum(["none", "sm", "md", "lg"]).optional(),
  "aria-label": z.string().optional(),
}).strict(),
lockedProps: [],
acceptsChildren: true,
```

**Section specifics** (house-built, titled page-section):
```typescript
type SectionProps = {
  readonly title?: string;        // optional heading for the section
  readonly "aria-label"?: string; // optional landmark label
  readonly gap?: "none" | "sm" | "md" | "lg";
  readonly children?: React.ReactNode;
};

function SectionComponent({ title, "aria-label": ariaLabel, gap = "md", children }: SectionProps) {
  const gapClass = gap === "none" ? "gap-0" : gap === "sm" ? "gap-2" : gap === "lg" ? "gap-6" : "gap-4";
  return React.createElement(
    "section",
    { "aria-label": ariaLabel ?? title, className: `flex flex-col ${gapClass}` },
    title !== undefined
      ? React.createElement("h2", { className: "text-xl font-semibold text-foreground tracking-tight" }, title)
      : null,
    children,
  );
}

// section propsSchema:
propsSchema: z.object({
  title: z.string().optional(),
  "aria-label": z.string().optional(),
  gap: z.enum(["none", "sm", "md", "lg"]).optional(),
}).strict(),
lockedProps: [],
acceptsChildren: true,
```

---

### 7. Wire schema additions: `spec-schema.ts`

**Pattern:** Every new catalog node MUST have a corresponding `*NodeSchema` in `spec-schema.ts`. The wire schema and render schema (manifest `propsSchema`) MUST be identical in shape — this is the Phase-17 `onClick` drift lesson.

**A. Leaf node schema pattern** (`spec-schema.ts` lines 65-72, TextNodeSchema; lines 91-106, ButtonNodeSchema):
```typescript
// Simple leaf — every field mirrors manifest propsSchema exactly:
const TextNodeSchema = z.object({
  type: z.literal("text"),
  content: z.string(),
  variant: z.enum(["body", "label", "caption", "heading"]).optional(),
  muted: z.boolean().optional(),
}).strict();

// a11y-required field is NOT optional in wire schema either (same as manifest):
const ButtonNodeSchema = z.object({
  type: z.literal("button"),
  label: z.string(),
  "aria-label": z.string(),  // NOT optional — matches manifest propsSchema exactly
  ...
}).strict();
```

**B. Container node schema pattern** (`spec-schema.ts` lines 183-201, StackNodeSchema/GridNodeSchema):
```typescript
// Container with children — z.lazy(lazySpecNode) on the children field ONLY:
const StackNodeSchema = z.object({
  type: z.literal("stack"),
  direction: z.enum(["vertical", "horizontal"]).optional(),
  gap: z.enum(["none", "sm", "md", "lg"]).optional(),
  children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,   // cast at field level only
}).strict();

const GridNodeSchema = z.object({
  type: z.literal("grid"),
  cols: z.number().int().min(1).max(12).optional(),
  gap: z.enum(["none", "sm", "md", "lg"]).optional(),
  children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
}).strict();
```

**C. New leaf node schemas for Phase 18** — must be added to the discriminated union in SECTION 5:
```typescript
// AvatarNodeSchema — matches AvatarProps / manifest propsSchema exactly:
const AvatarNodeSchema = z.object({
  type: z.literal("avatar"),
  alt: z.string(),        // a11y-required — NOT optional
  fallback: z.string(),
  src: z.string().optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
}).strict();

// InputNodeSchema:
const InputNodeSchema = z.object({
  type: z.literal("input"),
  label: z.string(),     // a11y-required — NOT optional
  placeholder: z.string().optional(),
  type: z.enum(["text","email","password","number","search","tel","url"]).optional(),
  disabled: z.boolean().optional(),
  defaultValue: z.string().optional(),
}).strict();
// NOTE: "type" is both the discriminant and a prop; rename prop to `inputType` in propsSchema
//       OR use a different field name to avoid the conflict. See GOTCHA section below.

// NavNodeSchema — inline relative-href guard (same as action-schema.ts NavigateAction.href):
const NavNodeSchema = z.object({
  type: z.literal("nav"),
  "aria-label": z.string(),   // a11y-required
  items: z.array(
    z.object({
      label: z.string(),
      href: z.string()
        .startsWith("/", { message: "nav href must start with / (relative only)" })
        .refine((h) => !/^([a-z][a-z0-9+\-.]*:|\/\/)/i.test(h), {
          message: "nav href must not use an absolute scheme or protocol-relative URL",
        }),
      current: z.boolean().optional(),
    }).strict()
  ).min(1),
  orientation: z.enum(["horizontal", "vertical"]).optional(),
}).strict();

// FeedItemNodeSchema:
const FeedItemNodeSchema = z.object({
  type: z.literal("feed-item"),
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  avatarSrc: z.string().optional(),
  avatarAlt: z.string().optional(),
  avatarFallback: z.string().optional(),
}).strict()
  .refine((p) => p.avatarSrc === undefined || p.avatarAlt !== undefined, {
    message: "avatarAlt is required when avatarSrc is provided",
    path: ["avatarAlt"],
  });

// TabsNodeSchema (presentational):
const TabsNodeSchema = z.object({
  type: z.literal("tabs"),
  "aria-label": z.string(),   // a11y-required
  tabs: z.array(z.object({ label: z.string(), content: z.string() }).strict()).min(1),
  active: z.number().int().min(0).optional(),
}).strict();

// SectionNodeSchema (layout primitive, acceptsChildren: true):
const SectionNodeSchema = z.object({
  type: z.literal("section"),
  title: z.string().optional(),
  "aria-label": z.string().optional(),
  gap: z.enum(["none", "sm", "md", "lg"]).optional(),
  children: z.lazy(lazySpecNode).array() as z.ZodTypeAny,
}).strict();
```

**D. Discriminated union extension** (`spec-schema.ts` lines 246-259, SECTION 5):
```typescript
// Add all new schemas to the z.discriminatedUnion options array:
const SpecNodeSchema = z.discriminatedUnion("type", [
  TextNodeSchema,
  BadgeNodeSchema,
  ButtonNodeSchema,
  SeparatorNodeSchema,
  AlertNodeSchema,
  KeyValueListNodeSchema,
  TableNodeSchema,
  CardNodeSchema,
  StackNodeSchema,
  GridNodeSchema,
  ListNodeSchema,
  ConditionalNodeSchema,
  // Phase 18 additions:
  AvatarNodeSchema,
  InputNodeSchema,
  NavNodeSchema,
  FeedItemNodeSchema,
  TabsNodeSchema,
  SectionNodeSchema,
]);
// _specNodeSchemaRef = SpecNodeSchema;  <-- this line must remain immediately after
```

---

### 8. Grid `colSpan` extension in `spec-schema.ts` and `manifest.ts`

**Analog:** `GridNodeSchema` + `GridComponent` in `manifest.ts` (lines 337-365).

**D-08 colSpan design:** colSpan is a per-child hint attached to grid-child nodes, NOT a GridNode prop. The renderer reads `node.colSpan` from each grid child and applies `grid-column: span N`.

**Wire schema change in GridNodeSchema** (GOTCHA: grid children must carry the colSpan through the discriminated union. The cleanest approach is to add `colSpan` as an optional field on each container-compatible node type, OR add it to the grid node and let the renderer pass it as a style prop to each child. The Phase-18 D-08 decision is to add `colSpan` as an optional field on children — each node in the discriminated union gets the optional field):

**Simpler approach:** Add `colSpan` as an optional numeric field to ALL node schemas (since any node can be a grid child). Use a post-process step in the renderer:

```typescript
// render-node.tsx — in renderPositionalChildren, read colSpan from each child:
function renderPositionalChildren(
  children: unknown,
  ctx: RenderContext,
  keyPrefix: string,
): React.ReactNode {
  if (!Array.isArray(children)) return null;
  return children.map((child: unknown, i: number) => {
    const c = child as Record<string, unknown>;
    const colSpan = typeof c["colSpan"] === "number" ? Math.max(1, Math.floor(c["colSpan"])) : undefined;
    const element = renderNode(child as SpecNode, ctx, `${keyPrefix}-${i}`);
    if (colSpan !== undefined) {
      // Wrap in a span-applying div — React style prop is safe (no eval, GR-01)
      return React.createElement("div", {
        key: `${keyPrefix}-${i}-span`,
        style: { gridColumn: `span ${colSpan}` },
      }, element);
    }
    return element;
  });
}
```

**Alternatively (cleaner, D-08 recommended):** Add `colSpan` to each leaf/container node schema as optional and strip it before `propsSchema.safeParse` in the renderer (same as `type`/`children` are stripped now):

```typescript
// In render-node.tsx SECTION "Props extraction" (lines 315-322):
// Add "colSpan" to the excluded keys:
for (const [k, v] of Object.entries(rawNode)) {
  if (k === "type" || k === "children" || k === "colSpan" || slotKeys.has(k)) continue;
  props[k] = v;
}
// Then apply colSpan as a wrapper style (same as above).
```

**GridComponent remains unchanged** — the `cols→child-count clamp` (lines 353-356) stays:
```typescript
// manifest.ts lines 350-364 — clamp remains; colSpan wrapping is handled by the renderer
const childCount = React.Children.count(children);
const requestedCols = Number.isFinite(cols) ? Math.floor(cols) : 2;
const effectiveCols = Math.max(1, Math.min(requestedCols, childCount || 1));
return React.createElement("div", {
  className: `grid ${gapClass}`,
  style: { gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` },
  "aria-label": ariaLabel,
}, children);
```

**Wire schema change** — add `colSpan` as optional on nodes that can appear as grid children. Simplest: add it to each leaf/container `*NodeSchema`. The renderer strips it before `propsSchema.safeParse` and applies it as a wrapper style.

---

### 9. `catalog/types.ts` — `SpecNodeType` extension

**Pattern** (`types.ts` lines 27-39):
```typescript
export type SpecNodeType =
  | "text" | "badge" | "button" | "card" | "key-value-list"
  | "separator" | "alert" | "table" | "stack" | "grid"
  | "list" | "conditional"
  // Phase 18 additions:
  | "avatar" | "input" | "nav" | "feed-item" | "tabs" | "section";
```

**Also extend the count in manifest.test.ts** (line 136):
```typescript
// Was: expect(REGISTERED_TYPES.length).toBe(10);
// Becomes (10 original + 6 new, minus list/conditional which are not in registry):
expect(REGISTERED_TYPES.length).toBe(16);
```

---

### 10. `COMPONENT_REGISTRY` + `registry-version.ts`

No changes needed to `component-registry.ts` or `registry-version.ts` directly.

- `COMPONENT_REGISTRY` (`component-registry.ts` line 32) is `NAUTA_CATALOG` — it auto-includes new entries the moment they are added to `manifest.ts`.
- `REGISTRY_VERSION.version` (`registry-version.ts` lines 84-90) is `computeRegistryHash(COMPONENT_REGISTRY)` — the SHA-256 auto-bumps because `computeRegistryHash` iterates `Object.keys(registry)` after sorting (line 52). Adding 6 new entries changes the key set → different hash → Phase-14 cache auto-invalidates.

**Confirm the hash sensitivity test still passes** (manifest.test.ts lines 172-186): the test adds a phantom entry and asserts the hash differs — this pattern already proves new entries flip the hash.

---

### 11. CI example test extensions

**A. `manifest.test.ts` — CTLG-04 loop** (lines 30-43) already covers ALL entries dynamically:
```typescript
// This block auto-covers new entries — no manual additions needed:
for (const [type, entry] of Object.entries(COMPONENT_REGISTRY)) {
  it(`manifest.${type}: example passes propsSchema`, () => {
    const result = typedEntry.propsSchema.safeParse(typedEntry.example);
    // ...
  });
}
```

**But:** add a11y negative-test blocks for each new a11y-required prop:
```typescript
// Pattern from lines 51-58 (button block) — copy for each new required prop:
it("avatar: omitting alt fails propsSchema", () => {
  const result = COMPONENT_REGISTRY.avatar?.propsSchema.safeParse({ fallback: "AB" });
  expect(result?.success).toBe(false);
});
it("input: omitting label fails propsSchema", () => {
  const result = COMPONENT_REGISTRY.input?.propsSchema.safeParse({ placeholder: "Enter..." });
  expect(result?.success).toBe(false);
});
it("nav: omitting aria-label fails propsSchema", () => {
  const result = COMPONENT_REGISTRY.nav?.propsSchema.safeParse({
    items: [{ label: "Home", href: "/" }],
  });
  expect(result?.success).toBe(false);
});
it("tabs: omitting aria-label fails propsSchema", () => {
  const result = COMPONENT_REGISTRY.tabs?.propsSchema.safeParse({
    tabs: [{ label: "Tab 1", content: "Content" }],
  });
  expect(result?.success).toBe(false);
});
```

**B. `catalog-example-render.test.tsx` — "covers all N catalog entries"** (line 52):
```typescript
// Was: expect(entries).toHaveLength(10);
// Becomes:
expect(entries).toHaveLength(16);
// All other assertions (SpecRootSchema.safeParse + no FALLBACK_MARKER) auto-cover new entries
// because they use `it.each(entries.map(...))`.
```

**C. Add a wire/render parity test** (D-05 of Phase 18 context — prevents onClick-style drift):
```typescript
// New block in manifest.test.ts — verifies spec-schema.ts and manifest propsSchema stay in sync:
import { SpecNodeSchema } from "../schema/spec-schema";

describe("Wire/render schema parity (Phase-18 D-05)", () => {
  for (const [type, entry] of Object.entries(COMPONENT_REGISTRY)) {
    it(`${type}: example passes SpecNodeSchema (wire)`, () => {
      const node = { type, ...entry.example };
      const result = SpecNodeSchema.safeParse(node);
      if (!result.success) {
        throw new Error(
          `${type} example failed SpecNodeSchema (wire/render drift!):\n${JSON.stringify(result.error.format(), null, 2)}`
        );
      }
      expect(result.success).toBe(true);
    });
  }
});
```

---

### 12. Bedrock artifact re-emit

**No code changes needed** to `emit-bedrock-artifacts.ts` or `artifact-builder.ts`. Both call `NAUTA_CATALOG` and `SpecRootSchema` dynamically. After Phase-18 code changes, run:
```bash
pnpm gen:artifacts   # runs: tsx scripts/emit-bedrock-artifacts.ts
```
This regenerates `artifacts/spec.schema.json` and `artifacts/genui-prompt.json`. The CI drift gate (`src/generation/__tests__/artifacts.test.ts`) then verifies the committed files match the freshly generated ones.

---

### 13. Token/theme layer (CTLG-09 — D-07)

**Pattern:** Existing components use CSS-variable Tailwind utilities — `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`, `border-input`, `text-destructive`, `ring-ring`. These resolve to `hsl(var(--foreground))` etc. via the Tailwind config's CSS-variable layer. No hardcoded hex colors anywhere.

**Evidence from existing components:**
- `TextComponent` (manifest.ts lines 144, 150, etc.): `"text-muted-foreground"`, `"text-foreground"` — CSS-var utilities.
- `Input` (`packages/ui/src/input.tsx` line 13): `"border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring disabled:opacity-50"` — all CSS-var.
- `Avatar` (`packages/ui/src/avatar.tsx` line 40): `"bg-muted"` — CSS-var.
- `Tabs` (`packages/ui/src/tabs.tsx` lines 13, 32, 42): `"bg-muted text-muted-foreground"`, `"ring-offset-background focus-visible:ring-ring"`, `"ring-offset-background"` — all CSS-var.

**New component rule:** Every new house-built component must use ONLY these Tailwind CSS-variable utilities. No `bg-blue-500`, no `text-gray-600`, no `#hex`. Full list of safe utilities: `text-foreground`, `text-muted-foreground`, `bg-background`, `bg-muted`, `bg-primary`, `text-primary-foreground`, `border-border`, `border-input`, `ring-ring`, `text-destructive`, `rounded-[--radius]` (or `rounded-md` which maps to `--radius`).

**ThemedRoot** (`spec-renderer.tsx` lines 166-179) wraps the tree only when `spec.style_pack_id` is set — catalog entry examples (no `style_pack_id`) render without the wrapper. New component components will inherit CSS vars from the ancestor ThemedRoot in themed generations automatically.

---

## Shared Patterns

### a11y-required prop contract
**Source:** `packages/genui/src/catalog/manifest.ts` lines 69, 89, 104, 109 (button.aria-label, key-value-list.label, alert.title, table.caption) + `packages/genui/src/__tests__/manifest.test.ts` lines 50-101 (D-04 negative tests)
**Apply to:** All 5 new manifest entries (avatar.alt, input.label, nav.aria-label, tabs.aria-label, feed-item is covered by .refine() rather than a top-level required field)
**Rule:** a11y-required props must be `z.string()` NOT `z.string().optional()` in BOTH the manifest `propsSchema` AND the wire `*NodeSchema`.

### `.strict()` on every Zod object
**Source:** `packages/genui/src/schema/spec-schema.ts` lines 72, 82, 106, 114, 124, 142, 161, 180, 191, 200 — every node schema ends with `.strict()`; `packages/genui/src/catalog/manifest.ts` lines 394-395, 411-413, etc.
**Apply to:** All new `*NodeSchema` in `spec-schema.ts` + all new manifest `propsSchema` entries.
**Rule:** Never `.object({...})` alone — always `.object({...}).strict()`. Bedrock requires `additionalProperties: false`.

### Wire/render lockstep (Phase-17 onClick lesson)
**Source:** `packages/genui/src/catalog/manifest.ts` lines 443-447 (button onClick comment about drift fix); `packages/genui/src/schema/spec-schema.ts` lines 101-103 (ButtonNodeSchema onClick matches manifest propsSchema exactly)
**Apply to:** All 6 new entries — each `*NodeSchema` in `spec-schema.ts` must have identical fields to its manifest `propsSchema`. Add the parity test (Section 11.C above) to lock it in CI.

### `React.createElement` (no JSX in manifest.ts)
**Source:** `packages/genui/src/catalog/manifest.ts` lines 146-171 (TextComponent), 174-176 (BadgeComponent), 178-199 (ButtonComponent), 201-228 (CardComponent), 230-249 (KeyValueListComponent), 318-334 (StackComponent), 337-365 (GridComponent)
**Apply to:** All new component functions in `manifest.ts`.
**Rule:** `manifest.ts` uses `React.createElement()` throughout — no JSX (`<Component />`). The file has no `.tsx` extension and no JSX pragma. All new component functions must follow the same `React.createElement(Component, props, ...children)` pattern.

### Named exports exclusively
**Source:** All project files — `types.ts` line 27 (`export type SpecNodeType`), `manifest.ts` line 379 (`export const NAUTA_CATALOG`), `component-registry.ts` line 32 (`export const COMPONENT_REGISTRY`).
**Apply to:** All new exports in all files.
**Rule:** No default exports. Named exports only (CLAUDE.md).

### Immutable patterns
**Source:** `manifest.ts` line 379: `Object.freeze({...})` on NAUTA_CATALOG; `registry-version.ts` lines 84-90: readonly interface; all prop types use `readonly`.
**Apply to:** All new type declarations and manifest entries. Use `readonly` on all fields. Use `ReadonlyArray<>` for arrays in prop types.

---

## Gotchas and Schema Discrepancies

### GOTCHA 1: `input` node `type` field collision
The `input` node has both a discriminant field `type: z.literal("input")` AND a user-settable prop `type` (text/email/password/...). These collide in the `*NodeSchema`. Two options:
- **Option A (recommended):** Rename the prop to `inputType` in BOTH `spec-schema.ts` and `manifest.ts` propsSchema to avoid the collision.
- **Option B:** Keep `type` as the prop name in the manifest `propsSchema` but in the wire schema use a different field name (breaks lockstep — avoid).

The renderer strips `type` from props before `propsSchema.safeParse` (render-node.tsx line 319), so it would be stripped even if `type` is used for both purposes. However, the manifest propsSchema and the wire schema would then diverge (the manifest propsSchema would have `type` as an enum field that the wire schema can't have). Use `inputType` in both schemas.

### GOTCHA 2: `FeedItemNodeSchema` has `.refine()` — discriminated union limitation
Schemas with `.refine()` are `ZodEffects`, not `ZodObject`. Zod v3 `discriminatedUnion()` requires all options to be `ZodObject`. The refine must be applied AFTER the discriminated union, or the condition must be a Zod-native construct.

**Solution:** Define `FeedItemNodeSchema` as a plain `.object(...).strict()` (no `.refine()`) for the wire schema. The semantic constraint (avatarAlt required when avatarSrc present) is enforced by the manifest `propsSchema` only (the manifest propsSchema does not need to be in the discriminated union). The wire schema is for Bedrock grammar generation — Bedrock's constrained decoding cannot enforce cross-field `.refine()` anyway.

```typescript
// Wire schema (no .refine() — must be ZodObject for discriminatedUnion):
const FeedItemNodeSchema = z.object({
  type: z.literal("feed-item"),
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  avatarSrc: z.string().optional(),
  avatarAlt: z.string().optional(),
  avatarFallback: z.string().optional(),
}).strict();

// Manifest propsSchema (CAN use .refine() — not part of discriminatedUnion):
propsSchema: z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  meta: z.string().optional(),
  avatarSrc: z.string().optional(),
  avatarAlt: z.string().optional(),
  avatarFallback: z.string().optional(),
}).strict().refine(
  (p) => p.avatarSrc === undefined || p.avatarAlt !== undefined,
  { message: "avatarAlt required when avatarSrc is provided", path: ["avatarAlt"] },
),
```

### GOTCHA 3: `SectionNodeSchema` requires `z.lazy` for `children` — same cast as StackNodeSchema
Section is a container (acceptsChildren: true). Its children field must use the same `z.lazy(lazySpecNode).array() as z.ZodTypeAny` cast that StackNodeSchema and GridNodeSchema use. Without the cast, TypeScript cannot satisfy the `ZodDiscriminatedUnionOption` constraint.

### GOTCHA 4: `catalog-example-render.test.tsx` asserts `entries.toHaveLength(10)` — will fail
After adding 6 entries, this assertion fails. Update to `16` (10 + 6). Also update `manifest.test.ts` line 136: `REGISTERED_TYPES.length` to `16`.

### GOTCHA 5: `build-catalog-example-spec.ts` children injection covers `section`
`buildCatalogExampleSpec` (lines 60-62) already injects `children: []` for any entry with `acceptsChildren: true`. `section` has `acceptsChildren: true`, so its example spec will get `children: []` injected automatically. No change needed to this file — verify the example in the `section` manifest entry does NOT include `children` (same as `stack` and `grid` examples that omit children).

### GOTCHA 6: Phase-17 `onClick` drift bug — do not repeat
The Phase-17 bug was that `ButtonNodeSchema` in `spec-schema.ts` was missing the `onClick: ActionSchema.optional()` field that the manifest `propsSchema` had (or vice versa). The renderer strips `onClick` before `propsSchema.safeParse` — but if the manifest has it and the wire schema doesn't, Bedrock cannot emit it. If the wire has it and the manifest doesn't, safeParse rejects it.

**Prevention:** The wire/render parity test (Section 11.C) catches this at CI time. Run it after implementing Phase 18 to confirm all 16 entries pass.

---

## No Analog Found

All Phase-18 files have strong analogs in the existing codebase. No files require falling back to RESEARCH.md patterns.

---

## Metadata

**Analog search scope:** `packages/genui/src/catalog/`, `packages/genui/src/schema/`, `packages/genui/src/registry/`, `packages/genui/src/renderer/`, `packages/genui/src/__tests__/`, `packages/genui/src/studio/`, `packages/genui/scripts/`, `packages/ui/src/`
**Files read:** 17 source files
**Pattern extraction date:** 2026-06-30
