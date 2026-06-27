# Phase 12: Catalog, Spec Schema, and Trusted Interpreter — Pattern Map

**Mapped:** 2026-06-27
**Files analyzed:** 12 (new/modified)
**Analogs found:** 11 / 12

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/genui/package.json` | config | — | `packages/ui/package.json` | exact |
| `packages/genui/tsconfig.json` | config | — | `packages/ui/tsconfig.json` | exact |
| `packages/genui/src/catalog/manifest.ts` | model | transform | `packages/ui/src/spreadsheet-grid/column-defs.ts` | role-match (keyed-registry builder) |
| `packages/genui/src/catalog/types.ts` | model | — | `packages/ui/src/spreadsheet-grid/types.ts` | exact (discriminated union + readonly) |
| `packages/genui/src/schema/spec-schema.ts` | model | transform | `packages/ui/src/spreadsheet-grid/types.ts` | role-match (union type definitions) |
| `packages/genui/src/registry/component-registry.ts` | utility | request-response | `packages/ui/src/spreadsheet-grid/column-defs.ts` | exact (type-keyed switch dispatch) |
| `packages/genui/src/renderer/render-node.tsx` | utility | request-response | `packages/ui/src/spreadsheet-grid/column-defs.ts` | exact (registry lookup → render) |
| `packages/genui/src/renderer/error-boundary.tsx` | utility | event-driven | `packages/ui/src/spreadsheet-grid/types.ts` (house style) | partial (no existing ErrorBoundary) |
| `packages/genui/src/renderer/use-declared-state.ts` | hook | event-driven | `apps/web/src/app/_components/inbox-three-pane.tsx` (useReducer) | partial |
| `packages/genui/src/renderer/spec-renderer.tsx` | component | request-response | `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` | role-match |
| `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx` | component | request-response | `apps/web/src/app/knowledge/_components/knowledge-graph-island.tsx` | exact |
| `apps/web/src/app/studio/preview/page.tsx` | component | request-response | `apps/web/src/app/knowledge/page.tsx` | exact |
| `apps/web/src/components/app-sidebar.tsx` *(modify)* | component | event-driven | self | exact |
| `packages/genui/src/__tests__/manifest.test.ts` | test | — | `packages/api-client/vitest.config.ts` + `packages/ui/src/__tests__/spreadsheet-grid.test.tsx` | role-match |

---

## Pattern Assignments

### `packages/genui/package.json` (config)

**Analog:** `packages/ui/package.json`

**Full structure to copy** (`packages/ui/package.json` lines 1–68):

```json
{
  "name": "@nauta/genui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./catalog": "./src/catalog/index.ts",
    "./schema": "./src/schema/index.ts",
    "./registry": "./src/registry/index.ts",
    "./renderer": "./src/renderer/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@nauta/ui": "*",
    "@types/react": "^18.3.3",
    "typescript": "^5.8.0",
    "vitest": "^2.1.9"
  },
  "peerDependencies": {
    "react": "^18.3.1",
    "zod": "^3.23.8"
  }
}
```

Notes:
- `@nauta/ui` is a devDependency (catalog components are imported by the registry at build; genui is consumed by apps/web which already has @nauta/ui as a full dep).
- vitest config: copy from `packages/api-client/vitest.config.ts` but use `environment: "jsdom"` for the renderer tests.

---

### `packages/genui/tsconfig.json` (config)

**Analog:** `packages/ui/tsconfig.json` (lines 1–20)

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "preserve",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "paths": {
      "@nauta/genui": ["./src/index.ts"],
      "@nauta/genui/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "src/__tests__"]
}
```

Notes: `jsx: "preserve"` required because genui ships `.tsx` files consumed by the host bundler (Next.js). Mirrors exactly what `packages/ui/tsconfig.json` does.

---

### `packages/genui/src/catalog/types.ts` (model)

**Analog:** `packages/ui/src/spreadsheet-grid/types.ts`

The house style for discriminated unions and readonly interfaces is extracted from lines 1–45 of that file. Apply the same `readonly` prefix on every interface field and use explicit string union types rather than `type` aliases with intersections.

**Discriminated union + readonly house style** (`types.ts` lines 1–12):

```typescript
/** Supported schema field types for column rendering (per D-08) */
export type SchemaFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "url"
  | "email"
  | "enum"
  | "json"
  | "array";
```

Apply this style directly for `SpecNodeType`:

```typescript
/** All spec node types registered in the component catalog (D-08) */
export type SpecNodeType =
  | "text"
  | "badge"
  | "button"
  | "card"
  | "key-value-list"
  | "separator"
  | "alert"
  | "table"
  | "stack"
  | "grid"
  | "list"
  | "conditional";
```

**Readonly interface house style** (`types.ts` lines 14–22):

```typescript
/** A column definition derived from the data source schema */
export interface SpreadsheetColumn {
  readonly name: string;
  readonly type: SchemaFieldType;
  readonly required?: boolean;
  readonly enumValues?: readonly string[];
  readonly description?: string;
  readonly autoDetected?: boolean;
}
```

Apply this pattern for `ManifestEntry<TProps>` — every field is `readonly`, optional fields use `?`, array fields use `ReadonlyArray<>`.

---

### `packages/genui/src/catalog/manifest.ts` (model, transform)

**Analog:** `packages/ui/src/spreadsheet-grid/column-defs.ts`

The `buildColumnDefs` function maps a spec (columns array) → dispatch table (ColDef[]). The manifest does the inverse: it IS the dispatch table, authored by hand, keyed on type strings.

**Import pattern** (`column-defs.ts` lines 1–22):

```typescript
import type {
  CellClassParams,
  ColDef,
  ITooltipParams,
  ValueGetterParams,
  ValueSetterParams,
} from "ag-grid-community";

import type { SpreadsheetColumn, SpreadsheetRow } from "./types";
import { ArrayCellEditor } from "./cell-editors/ArrayCellEditor";
// ... per-type renderer imports
```

For the manifest, substitute with:

```typescript
import type { ComponentType } from "react";
import { z } from "zod";
import { Badge } from "@nauta/ui/badge";
import { Button } from "@nauta/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nauta/ui/card";
// ... one import per @nauta/ui component registered

import type { ManifestEntry } from "./types";
```

**Registry builder / dispatch table** (`column-defs.ts` lines 41–85 — `getRendererAndEditor` switch):

```typescript
function getRendererAndEditor(
  col: SpreadsheetColumn,
): Partial<ColDef<SpreadsheetRow>> {
  switch (col.type) {
    case "date":
      return { cellRenderer: DateCellRenderer, cellEditor: DateCellEditor };
    case "number":
      return { cellRenderer: NumberCellRenderer, cellEditor: NumberCellEditor };
    // ...
    default:
      return { cellEditor: TextCellEditor };
  }
}
```

Generalize this switch to the manifest constant: each `case` becomes one object literal in `NAUTA_CATALOG`. Keep the `as const` freeze and the `default` safety fallback concept (here: `UnknownComponentPlaceholder` in the registry, not the catalog).

**Immutable builder pattern** (`column-defs.ts` lines 92–138 — `buildColumnDefs`):

```typescript
export function buildColumnDefs(
  columns: readonly SpreadsheetColumn[],
  isEditable: boolean,
): ColDef<SpreadsheetRow>[] {
  const dataCols: ColDef<SpreadsheetRow>[] = columns.map((col) => {
    const rendererEditor = getRendererAndEditor(col);
    const colDef: ColDef<SpreadsheetRow> = {
      ...
      ...rendererEditor,
    };
    return colDef;
  });
  return [ROW_NUMBER_COLUMN, ...dataCols];
}
```

Apply spread-merge pattern (`{ ...baseProps, ...typeSpecificProps }`) when assembling manifest entries. Never mutate a base object.

---

### `packages/genui/src/schema/spec-schema.ts` (model, transform)

**Analog:** `packages/ui/src/spreadsheet-grid/types.ts` (for union declaration style) + SPEC-RENDERER.md §3.2 (for the Zod schema shape)

**Critical Zod v3 recursive pattern** (SPEC-RENDERER.md §9, Pitfall 1):

```typescript
// Forward declaration required — annotate explicitly to satisfy TS + Zod v3
type SpecNode = z.infer<typeof SpecNodeSchema>;
const ChildrenSchema: z.ZodType<SpecNode[]> = z.lazy(() =>
  z.array(SpecNodeSchema)
);
```

Without the explicit `z.ZodType<SpecNode[]>` annotation, TypeScript infers `ZodLazy<...>` which does not satisfy the constraint inside `z.discriminatedUnion`. This is the single most common breakage point.

**Schema root with version literal** (SPEC-RENDERER.md §3.2, lines 267–278):

```typescript
const SpecRootSchema = z.object({
  v: z.literal(1),
  data: z.record(z.string(), z.unknown()).optional(),
  state: z.array(StateDeclarationSchema).optional(),
  root: z.lazy(() => SpecNodeSchema),
});
```

**Strict `.strict()` everywhere** — every `z.object({...})` call gets `.strict()` appended (D-22, COST-02: `additionalProperties: false` for Bedrock structured output compatibility).

**_plan reasoning field** (D-22 / GENERATION-AGENT.md seam):

```typescript
// Reserve leading reasoning field — stripped before render in Phase 13
const SpecRootSchema = z.object({
  _plan: z.string().optional(), // stripped in Phase 13 before renderNode
  v: z.literal(1),
  // ...
}).strict();
```

---

### `packages/genui/src/registry/component-registry.ts` (utility, request-response)

**Analog:** `packages/ui/src/spreadsheet-grid/column-defs.ts` — `getRendererAndEditor()` switch (lines 41–85)

This IS the `column-defs.ts` pattern applied to a keyed object rather than a switch statement. The type key is `SpecNodeType`, the value is a `ManifestEntry`.

**Registry shape** (from SPEC-RENDERER.md §4.2, lines 388–444):

```typescript
export const COMPONENT_REGISTRY: ComponentRegistry = {
  badge: {
    type: "badge",
    description: "...",
    example: { type: "badge", label: "Confirmed", variant: "default" },
    propsSchema: z.object({
      label: z.string(),
      variant: z.enum(["default", "secondary", "destructive", "outline"]).optional(),
    }).strict(),
    component: ({ label, variant }) => <Badge variant={variant}>{label}</Badge>,
  },
  // ... one entry per SpecNodeType
} as const;
```

**Registry version as content-hash** (D-07, D-21):

```typescript
// Stable version object consumed by Phase 14 cache key
export const REGISTRY_VERSION: { readonly catalogId: string; readonly version: string } = {
  catalogId: "global",
  version: computeRegistryHash(COMPONENT_REGISTRY), // SHA-256 over type keys + serialized schemas
};
```

**Safe unknown-type fallback** (D-06 — never throw on unknown type):

```typescript
export function UnknownComponentPlaceholder({
  nodeType,
}: {
  readonly nodeType: string;
}): React.ReactElement {
  return (
    <div role="alert" className="border border-destructive/50 bg-destructive/10 rounded-md px-3 py-2 text-xs text-destructive">
      {`[!] "${nodeType}" node — component not in registry`}
    </div>
  );
}
```

---

### `packages/genui/src/renderer/render-node.tsx` (utility, request-response)

**Analog:** `packages/ui/src/spreadsheet-grid/column-defs.ts` — `getRendererAndEditor()` + `buildColumnDefs()` combined, generalized to a recursive tree

This is the explicit north-star generalization: substitute `SchemaFieldType → SpecNodeType`, `ColDef → React.ReactElement`, flat `columns.map()` → recursive `renderNode()`.

**Core interpreter signature** (SPEC-RENDERER.md §5.1, lines 528–586):

```typescript
function renderNode(
  node: SpecNode,
  ctx: RenderContext,
  keyPrefix: string,
): React.ReactElement {
  const entry = ctx.registry[node.type];

  if (!entry) {
    return (
      <UnknownComponentPlaceholder key={keyPrefix} nodeType={node.type} />
    );
  }

  const propsResult = entry.propsSchema.safeParse(
    Object.fromEntries(
      Object.entries(node).filter(([k]) => k !== "type" && k !== "children")
    )
  );

  if (!propsResult.success) {
    return (
      <NodeErrorFallback
        key={keyPrefix}
        nodeType={node.type}
        reason="prop validation failed"
      />
    );
  }

  // Positional children (stack, grid)
  const positionalChildren =
    "children" in node && Array.isArray((node as { children: SpecNode[] }).children)
      ? (node as { children: SpecNode[] }).children.map((child, i) =>
          renderNode(child, ctx, `${keyPrefix}-${i}`)
        )
      : undefined;

  // Named slot children (card.header, card.footer)
  const slotChildren: Record<string, React.ReactElement> = {};
  if (entry.slots) {
    for (const slotName of entry.slots) {
      const slotNode = (node as Record<string, unknown>)[slotName];
      if (slotNode && typeof slotNode === "object" && "type" in (slotNode as object)) {
        slotChildren[slotName] = renderNode(
          slotNode as SpecNode,
          ctx,
          `${keyPrefix}-slot-${slotName}`,
        );
      }
    }
  }

  const Component = entry.component as React.ComponentType<Record<string, unknown>>;

  return (
    <NodeErrorBoundary key={keyPrefix} nodeType={node.type}>
      <Component {...propsResult.data} {...slotChildren}>
        {positionalChildren}
      </Component>
    </NodeErrorBoundary>
  );
}
```

**Key pattern** (D-15 — structural-position keys, never LLM IDs):

```typescript
// Root call:
renderNode(spec.root, ctx, "root");

// Children get keyPrefix like "root-0", "root-0-1", "root-slot-header"
// These are stable across spec regenerations at the same structural position.
```

**resolveDataRef — no eval** (D-12, SPEC-RENDERER.md §5.4, lines 673–681):

```typescript
function resolveDataRef(ref: string, ctx: RenderContext): unknown {
  const [namespace, ...path] = ref.split(".");
  const root = namespace === "state" ? ctx.state : ctx.data;
  return path.reduce<unknown>(
    (obj, key) =>
      obj != null && typeof obj === "object"
        ? (obj as Record<string, unknown>)[key]
        : undefined,
    root,
  );
}
```

---

### `packages/genui/src/renderer/error-boundary.tsx` (utility, event-driven)

**Analog:** No exact analog exists in the codebase. Use SPEC-RENDERER.md §5.2 as the primary reference.

**Pattern** (SPEC-RENDERER.md §5.2, lines 619–641) — React class component, required for `getDerivedStateFromError`:

```typescript
interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly nodeType: string;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

export class NodeErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <NodeErrorFallback nodeType={this.props.nodeType} reason="render error" />;
    }
    return this.props.children;
  }
}
```

**NodeErrorFallback visual** (UI-SPEC.md §5 + §9):

```typescript
export function NodeErrorFallback({
  nodeType,
  reason,
}: {
  readonly nodeType: string;
  readonly reason: string;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md px-3 py-2 text-xs"
    >
      {`[!] "${nodeType}" node — ${reason}`}
    </div>
  );
}
```

Note: does NOT import from `@nauta/ui/alert` to avoid circular dependency during error render path (UI-SPEC.md §5).

---

### `packages/genui/src/renderer/use-declared-state.ts` (hook, event-driven)

**Analog:** `apps/web/src/app/_components/inbox-three-pane.tsx` (uses `useReducer` internally) — partial match. The direct shape comes from SPEC-RENDERER.md §6.1.

**Import pattern:**

```typescript
import React from "react";
import type { StateDeclaration } from "../schema/spec-schema";
```

**useReducer + immutable state update** (SPEC-RENDERER.md §6.1, lines 794–831):

```typescript
export function useDeclaredState(
  declarations: readonly StateDeclaration[],
): {
  readonly state: Record<string, unknown>;
  readonly dispatch: (actionName: string, value?: unknown) => void;
} {
  const initial = Object.fromEntries(
    declarations.map((d) => [d.name, d.initial])
  );

  const [state, dispatchRaw] = React.useReducer(
    (
      s: Record<string, unknown>,
      action: { readonly name: string; readonly value?: unknown },
    ): Record<string, unknown> => {
      for (const decl of declarations) {
        const actionDef = decl.actions?.find((a) => a.name === action.name);
        if (!actionDef) continue;

        const current = s[decl.name];
        let next: unknown;

        switch (actionDef.mutation) {
          case "toggle":     next = !current; break;
          case "set":        next = action.value ?? actionDef.value; break;
          case "reset":      next = decl.initial; break;
          case "increment":  next = (typeof current === "number" ? current : 0) + 1; break;
          case "decrement":  next = (typeof current === "number" ? current : 0) - 1; break;
        }

        return { ...s, [decl.name]: next }; // immutable update — house rule
      }
      return s; // unknown action — no-op, return same reference
    },
    initial,
  );

  const dispatch = React.useCallback(
    (name: string, value?: unknown) => dispatchRaw({ name, value }),
    [dispatchRaw],
  );

  return { state, dispatch };
}
```

Note: `{ ...s, [decl.name]: next }` is the immutable-only rule from CLAUDE.md applied to the reducer.

---

### `packages/genui/src/renderer/spec-renderer.tsx` (component, request-response)

**Analog:** `apps/web/src/app/knowledge/_components/knowledge-graph.tsx` (client component with hooks and complex render logic)

**"use client" + entry-point component pattern:**

```typescript
"use client";

import React from "react";
import type { SpecRoot } from "../schema/spec-schema";
import type { ComponentRegistry } from "../registry/component-registry";
import { useDeclaredState } from "./use-declared-state";
import { renderNode } from "./render-node";

// ActionRegistry context seam (D-step per §6.3) — empty this phase
export type ActionHandler = (value?: unknown) => void | Promise<void>;
export type ActionRegistry = Readonly<Record<string, ActionHandler>>;
export const ActionRegistryContext = React.createContext<ActionRegistry>({});

export function useActionRegistry(actionId: string | undefined): (() => void) | undefined {
  const registry = React.useContext(ActionRegistryContext);
  if (!actionId) return undefined;
  return registry[actionId] as (() => void) | undefined;
}

export interface SpecRendererProps {
  readonly spec: SpecRoot;
  readonly registry: ComponentRegistry;
  readonly data?: Record<string, unknown>;
}

export function SpecRenderer({
  spec,
  registry,
  data = {},
}: SpecRendererProps): React.ReactElement {
  const { state, dispatch } = useDeclaredState(spec.state ?? []);

  const ctx = {
    data: { ...(spec.data ?? {}), ...data },
    state,
    dispatch,
    registry,
  } as const;

  return renderNode(spec.root, ctx, "root");
}
```

---

### `apps/web/src/app/studio/preview/_components/spec-renderer-island.tsx` (component, request-response)

**Analog:** `apps/web/src/app/knowledge/_components/knowledge-graph-island.tsx` (lines 1–38)

This is an exact copy of the island pattern. Substitute `KnowledgeGraph` with `SpecRenderer`.

**Full island pattern** (`knowledge-graph-island.tsx` lines 1–38):

```typescript
"use client";

import dynamic from "next/dynamic";

// Loading fallback: null (static spec, instant load — no skeleton per UI-SPEC §8)
const SpecRendererDynamic = dynamic(
  () =>
    import("@nauta/genui/renderer").then((mod) => ({
      default: mod.SpecRenderer,
    })),
  {
    ssr: false,
    loading: () => null,
  },
);

export interface SpecRendererIslandProps {
  readonly spec: import("@nauta/genui/schema").SpecRoot;
  readonly data?: Record<string, unknown>;
}

export function SpecRendererIsland(
  props: SpecRendererIslandProps,
): React.ReactElement {
  return <SpecRendererDynamic {...props} />;
}
```

Key divergence from knowledge island:
- `loading: () => null` not `<KnowledgeGraphSkeleton />` — per UI-SPEC §8, no skeleton for the static spec page.
- Props typed from `@nauta/genui/schema` to enforce the contract.

---

### `apps/web/src/app/studio/preview/page.tsx` (component, request-response)

**Analog:** `apps/web/src/app/knowledge/page.tsx` (lines 1–31)

**Server component shell pattern** (`knowledge/page.tsx` lines 1–31):

```typescript
import type { Metadata } from "next";

import { KnowledgeGraphIsland } from "./_components/knowledge-graph-island";

export const metadata: Metadata = {
  title: "Knowledge — Nauta",
  description: "...",
};

export default function KnowledgePage(): React.ReactElement {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] w-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-border/50 px-4">
        <h1 className="text-sm font-semibold text-foreground">Knowledge Graph</h1>
      </div>

      <div className="relative min-h-0 flex-1">
        <KnowledgeGraphIsland className="absolute inset-0" />
      </div>
    </main>
  );
}
```

Apply this pattern for the studio preview page. Replace the single island div with the `ResizablePanelGroup` split (render pane + JSON pane). Key structural classes to keep identical:
- `h-12 shrink-0 items-center border-b border-border/50 px-4` — header (UI-SPEC §6)
- `flex-1 min-h-0` — body fills remaining height

**ResizablePanel two-pane layout** (`inbox-three-pane.tsx` lines 252–324):

```typescript
<ResizablePanelGroup direction="horizontal" className="h-full">
  <ResizablePanel defaultSize={55} minSize={30}>
    {/* render pane */}
  </ResizablePanel>
  <ResizableHandle />
  <ResizablePanel defaultSize={45} minSize={25}>
    {/* JSON pane */}
  </ResizablePanel>
</ResizablePanelGroup>
```

Note: `withHandle` is NOT used here (UI-SPEC §6: "no grip needed — developer tool"). The inbox uses `withHandle`; studio preview does not.

---

### `apps/web/src/components/app-sidebar.tsx` (modify — add Studio nav item)

**Analog:** self — same file, lines 37–42

**LIVE_NAV_ITEMS extension pattern** (`app-sidebar.tsx` lines 37–42):

```typescript
// D-20 nav order: Inbox · Entity Types · Entities · Knowledge (all live).
const LIVE_NAV_ITEMS: ReadonlyArray<LiveNavItem> = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/entity-types", label: "Entity Types", icon: Shapes },
  { href: "/entities", label: "Entities", icon: Boxes },
  { href: "/knowledge", label: "Knowledge", icon: Share2 },
];
```

Add `FlaskConical` import alongside `Boxes, Inbox, Moon, Share2, Shapes, Sun` on line 4, then append to the array:

```typescript
{ href: "/studio/preview", label: "Studio", icon: FlaskConical }
```

The `isActiveRoute` logic (lines 47–50) and active class pattern (lines 132–133) require no changes — they apply automatically.

---

### `packages/genui/src/__tests__/manifest.test.ts` (test)

**Analog:** `packages/ui/src/__tests__/spreadsheet-grid.test.tsx` (test file structure) + `packages/api-client/vitest.config.ts` (vitest setup)

**vitest test structure** (`spreadsheet-grid.test.tsx` lines 1–56 — describe/it pattern):

```typescript
import { describe, expect, it } from "vitest";
import { COMPONENT_REGISTRY } from "../registry/component-registry";

// CTLG-04 / D-05: Every manifest entry's example must pass its propsSchema
describe("COMPONENT_REGISTRY manifest validation (CTLG-04)", () => {
  for (const [type, entry] of Object.entries(COMPONENT_REGISTRY)) {
    it(`manifest.${type}: example passes propsSchema`, () => {
      const result = entry.propsSchema.safeParse(entry.example);
      expect(result.success).toBe(true);
    });
  }
});

// D-04: a11y-required props are present in propsSchema
describe("COMPONENT_REGISTRY a11y props (D-04)", () => {
  it("button propsSchema requires aria-label", () => {
    // parse without aria-label → should fail
    const result = COMPONENT_REGISTRY.button.propsSchema.safeParse({
      label: "Click me",
    });
    // aria-label is required per UI-SPEC §11
    expect(result.success).toBe(false);
  });
});
```

**vitest config for genui** (copy from `packages/api-client/vitest.config.ts`, change environment):

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",        // renderer tests need DOM
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

---

## Shared Patterns

### Named Exports Exclusively
**Source:** CLAUDE.md, applied throughout
**Apply to:** All files in `packages/genui`

Every export is `export function` / `export const` / `export type` / `export interface`. No default exports except inside dynamic import `.then(mod => ({ default: mod.X }))` wrappers (required by Next.js `dynamic()`).

### Immutable Updates
**Source:** `packages/ui/src/spreadsheet-grid/column-defs.ts` lines 112–117
**Apply to:** `use-declared-state.ts` reducer, any object-building utilities

```typescript
// From column-defs.ts valueSetter:
const updated: SpreadsheetRow = {
  ...params.data,
  data: { ...params.data.data, [col.name]: params.newValue as unknown },
};
```

All state transitions in the `useDeclaredState` reducer must return `{ ...s, [key]: next }` — never mutate `s` directly.

### Readonly Props
**Source:** `packages/ui/src/spreadsheet-grid/types.ts` (every interface field)
**Apply to:** All `interface` and `type` declarations in `packages/genui`

```typescript
// Pattern from types.ts lines 14–22:
export interface SpreadsheetColumn {
  readonly name: string;
  readonly type: SchemaFieldType;
  readonly required?: boolean;
}
```

### `"use client"` Placement
**Source:** `apps/web/src/components/app-sidebar.tsx` line 1 + `knowledge-graph-island.tsx` line 1
**Apply to:** `spec-renderer-island.tsx`, `spec-renderer.tsx` (if imported directly by client pages)

`"use client"` goes on line 1, before all imports. The page.tsx (`/studio/preview/page.tsx`) remains a server component — the island wrapper holds the `"use client"` + `dynamic(ssr:false)`.

### Active Route Pattern
**Source:** `apps/web/src/components/app-sidebar.tsx` lines 47–50, 130–138
**Apply to:** `app-sidebar.tsx` modification only

```typescript
function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Applied as:
className={
  active
    ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
    : "text-muted-foreground hover:bg-muted"
}
```

### Zod `.strict()` on every object schema
**Source:** D-22, COST-02 (Bedrock compatibility)
**Apply to:** Every `z.object({...})` in `packages/genui/src/schema/spec-schema.ts` and in `propsSchema` fields of catalog manifest entries

This is NOT done in other packages yet — it is a new constraint specific to genui for Bedrock structured output compatibility.

### `safeParse` before render (never `parse`)
**Source:** SPEC-RENDERER.md §5.1 (propsResult pattern)
**Apply to:** `render-node.tsx` and all validation boundaries in genui

Use `schema.safeParse(input)` and check `.success` before rendering. Reserve `schema.parse(input)` only for the test files (where throwing is fine in `it()` bodies).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/genui/src/renderer/error-boundary.tsx` | utility | event-driven | No React class component ErrorBoundary exists in the codebase. Use SPEC-RENDERER.md §5.2 as primary reference. The class component pattern (getDerivedStateFromError) cannot be a functional component. |

---

## Metadata

**Analog search scope:** `packages/ui/src/`, `apps/web/src/app/knowledge/`, `apps/web/src/app/_components/`, `apps/web/src/components/`, `packages/api-client/`
**Files scanned:** 14
**Pattern extraction date:** 2026-06-27
