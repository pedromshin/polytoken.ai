/**
 * catalog/manifest.ts — Hand-authored NAUTA_CATALOG manifest.
 *
 * Contains exactly 10 catalog entries (D-01, D-02):
 *   - 2 layout primitives: stack, grid (house-built, no @nauta/ui import)
 *   - 8 leaf components: text, badge, button, card, key-value-list, separator, alert, table
 *
 * Each entry is a fully-real ManifestEntry<TProps>:
 *   - strict Zod propsSchema (Bedrock additionalProperties:false — D-22 / COST-02)
 *   - a11y-required props as NON-optional (D-04 hard-fail per UI-SPEC §11)
 *   - lockedProps per UI-SPEC §11
 *   - slots / acceptsChildren where applicable
 *   - example that CI-validates against propsSchema (CTLG-04 / D-05)
 *   - real React component (no stubs — D-01)
 *
 * Interpreter control-flow nodes (list, conditional) are NOT in this catalog —
 * they are handled directly by renderNode in Plan 03 without registry dispatch.
 *
 * COST-03 / D-23: compact-encoding helper + candidate-subsetting seam documented.
 */

import * as React from "react";
import { z } from "zod";

import { Badge } from "@nauta/ui/badge";
import { Button } from "@nauta/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@nauta/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@nauta/ui/alert";
import { Separator } from "@nauta/ui/separator";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nauta/ui/table";

import type { AnyManifestEntry, ComponentRegistry } from "./types";

// ---------------------------------------------------------------------------
// Prop type declarations (one per catalog entry)
// ---------------------------------------------------------------------------

/** text — house-built leaf, renders <p> */
type TextProps = {
  readonly content: string;
  readonly variant?: "body" | "label" | "caption" | "heading";
  readonly muted?: boolean;
};

/** badge — @nauta/ui/badge leaf */
type BadgeProps = {
  readonly label: string;
  readonly variant?: "default" | "secondary" | "destructive" | "outline";
};

/** button — @nauta/ui/button leaf; onClick + type are locked (UI-SPEC §11) */
type ButtonProps = {
  readonly label: string;
  readonly "aria-label": string; // a11y-required (D-04 / UI-SPEC §11)
  readonly variant?: "default" | "outline" | "ghost" | "destructive";
  readonly size?: "sm" | "md" | "lg";
  readonly disabled?: boolean;
  readonly action?: string; // ActionRegistry key — resolved by interpreter, never eval
};

/** card — @nauta/ui/card container with named slots */
type CardProps = {
  readonly title?: string;
  readonly description?: string;
  // Named slot props are injected by the renderer from spec.header / spec.footer
  readonly header?: React.ReactElement;
  readonly footer?: React.ReactElement;
  readonly children?: React.ReactNode;
};

/** key-value-list — house-built leaf, renders <dl> */
type KeyValueListProps = {
  readonly label: string; // a11y-required list aria-label (D-04 / UI-SPEC §11)
  readonly items: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
  }>;
};

/** separator — @nauta/ui/separator; aria-hidden is locked (D-04 / UI-SPEC §11) */
type SeparatorProps = {
  readonly "aria-hidden": true; // locked: always decorative
  readonly orientation?: "horizontal" | "vertical";
};

/** alert — @nauta/ui/alert; title is a11y-required (D-04 / UI-SPEC §11) */
type AlertProps = {
  readonly title: string; // a11y-required (D-04)
  readonly description?: string;
  readonly variant?: "default" | "destructive";
};

/** table — @nauta/ui/table; caption is a11y-required (D-04 / UI-SPEC §11) */
type TableProps = {
  readonly caption: string; // a11y-required (D-04)
  readonly columns: ReadonlyArray<{
    readonly key: string;
    readonly header: string;
  }>;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
};

/** stack — house-built layout primitive */
type StackProps = {
  readonly direction?: "vertical" | "horizontal";
  readonly gap?: "none" | "sm" | "md" | "lg";
  readonly "aria-label"?: string; // optional landmark label (UI-SPEC §11)
  readonly children?: React.ReactNode;
};

/** grid — house-built layout primitive */
type GridProps = {
  readonly cols?: number;
  readonly gap?: "none" | "sm" | "md" | "lg";
  readonly "aria-label"?: string; // optional landmark label (UI-SPEC §11)
  readonly children?: React.ReactNode;
};

// ---------------------------------------------------------------------------
// React components (real implementations, no stubs — D-01)
// ---------------------------------------------------------------------------

function TextComponent({
  content,
  variant = "body",
  muted = false,
}: TextProps): React.ReactElement {
  const className = muted ? "text-muted-foreground" : "text-foreground";
  if (variant === "heading") {
    return React.createElement(
      "h3",
      { className: `text-lg font-semibold ${className}` },
      content,
    );
  }
  if (variant === "caption") {
    return React.createElement(
      "span",
      { className: `text-xs ${className}` },
      content,
    );
  }
  if (variant === "label") {
    return React.createElement(
      "span",
      { className: `text-sm font-medium ${className}` },
      content,
    );
  }
  // body (default)
  return React.createElement(
    "p",
    { className: `text-sm ${className}` },
    content,
  );
}

function BadgeComponent({ label, variant = "default" }: BadgeProps): React.ReactElement {
  return React.createElement(Badge, { variant }, label);
}

function ButtonComponent({
  label,
  "aria-label": ariaLabel,
  variant = "default",
  size,
  disabled = false,
  action: _action, // consumed by ActionRegistry in Phase 13 — no-op here
}: ButtonProps): React.ReactElement {
  // Map "md" → undefined (Button defaults to "default" size which is md)
  const buttonSize = size === "md" ? undefined : (size as "sm" | "lg" | undefined);
  return React.createElement(
    Button,
    {
      type: "button", // locked: never "submit" (UI-SPEC §11)
      variant,
      size: buttonSize,
      disabled,
      "aria-label": ariaLabel,
    },
    label,
  );
}

function CardComponent({
  title,
  description,
  header,
  footer,
  children,
}: CardProps): React.ReactElement {
  return React.createElement(
    Card,
    null,
    title || description
      ? React.createElement(
          CardHeader,
          null,
          title ? React.createElement(CardTitle, null, title) : null,
          description
            ? React.createElement(
                "p",
                { className: "text-sm text-muted-foreground" },
                description,
              )
            : null,
        )
      : header ?? null,
    React.createElement(CardContent, null, children ?? null),
    footer ? React.createElement(CardFooter, null, footer) : null,
  );
}

function KeyValueListComponent({
  label,
  items,
}: KeyValueListProps): React.ReactElement {
  return React.createElement(
    "dl",
    { "aria-label": label, className: "grid grid-cols-2 gap-1 text-sm" },
    ...items.map(({ key, value }) =>
      React.createElement(
        React.Fragment,
        { key },
        React.createElement(
          "dt",
          { className: "font-medium text-muted-foreground" },
          key,
        ),
        React.createElement("dd", { className: "text-foreground" }, value),
      ),
    ),
  );
}

function SeparatorComponent({
  orientation = "horizontal",
  "aria-hidden": _ariaHidden, // always true — passed through to Separator
}: SeparatorProps): React.ReactElement {
  return React.createElement(Separator, {
    orientation,
    decorative: true,
    "aria-hidden": true,
  });
}

function AlertComponent({
  title,
  description,
  variant = "default",
}: AlertProps): React.ReactElement {
  return React.createElement(
    Alert,
    { variant },
    React.createElement(AlertTitle, null, title),
    description
      ? React.createElement(AlertDescription, null, description)
      : null,
  );
}

function TableComponent({
  caption,
  columns,
  rows,
}: TableProps): React.ReactElement {
  return React.createElement(
    Table,
    null,
    React.createElement(TableCaption, null, caption),
    React.createElement(
      TableHeader,
      null,
      React.createElement(
        TableRow,
        null,
        ...columns.map((col) =>
          React.createElement(TableHead, { key: col.key }, col.header),
        ),
      ),
    ),
    React.createElement(
      TableBody,
      null,
      ...rows.map((row, rowIndex) =>
        React.createElement(
          TableRow,
          { key: rowIndex },
          ...columns.map((col) =>
            React.createElement(
              TableCell,
              { key: col.key },
              String((row as Record<string, unknown>)[col.key] ?? ""),
            ),
          ),
        ),
      ),
    ),
  );
}

function StackComponent({
  direction = "vertical",
  gap = "md",
  "aria-label": ariaLabel,
  children,
}: StackProps): React.ReactElement {
  const gapClass =
    gap === "none" ? "gap-0" :
    gap === "sm" ? "gap-2" :
    gap === "lg" ? "gap-6" :
    "gap-4"; // md default
  const flexClass = direction === "horizontal" ? "flex flex-row" : "flex flex-col";
  return React.createElement(
    "div",
    { className: `${flexClass} ${gapClass}`, "aria-label": ariaLabel },
    children,
  );
}

function GridComponent({
  cols = 2,
  gap = "md",
  "aria-label": ariaLabel,
  children,
}: GridProps): React.ReactElement {
  const gapClass =
    gap === "none" ? "gap-0" :
    gap === "sm" ? "gap-2" :
    gap === "lg" ? "gap-6" :
    "gap-4"; // md default
  // Layout-robustness clamp: never request more columns than there are children.
  // The model frequently emits `cols: 12` (Bootstrap-style mental model) with a
  // single wide child — without this clamp that child lands in a 1/12-wide cell
  // and its text wraps one word per line. Clamping to the child count makes a
  // few-children grid degrade to fewer, full-width columns instead of collapsing.
  const childCount = React.Children.count(children);
  const requestedCols = Number.isFinite(cols) ? Math.floor(cols) : 2;
  const effectiveCols = Math.max(1, Math.min(requestedCols, childCount || 1));
  return React.createElement(
    "div",
    {
      className: `grid ${gapClass}`,
      style: { gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` },
      "aria-label": ariaLabel,
    },
    children,
  );
}

// ---------------------------------------------------------------------------
// NAUTA_CATALOG — 10 fully-real manifest entries (D-01, D-02, D-03)
// ---------------------------------------------------------------------------

/**
 * The component catalog. 10 entries: 2 layout primitives + 8 @nauta/ui-backed leaves.
 *
 * Frozen as const; typed as ComponentRegistry for keyed lookup.
 *
 * Do NOT add entries for `list` or `conditional` here — those are interpreter
 * control-flow nodes dispatched directly by renderNode in Plan 03.
 */
export const NAUTA_CATALOG: ComponentRegistry = Object.freeze({
  text: {
    type: "text",
    description:
      "Renders a block of text with optional visual variant (body, label, caption, heading) and muted styling.",
    example: {
      content: "Hello from the catalog",
      variant: "body",
      muted: false,
    },
    propsSchema: z
      .object({
        content: z.string(),
        variant: z.enum(["body", "label", "caption", "heading"]).optional(),
        muted: z.boolean().optional(),
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: false,
    component: TextComponent as AnyManifestEntry["component"],
  },

  badge: {
    type: "badge",
    description:
      "Inline badge chip for status labels, tags, or counts. Variant controls color (default, secondary, destructive, outline).",
    example: {
      label: "Confirmed",
      variant: "default",
    },
    propsSchema: z
      .object({
        label: z.string(),
        variant: z
          .enum(["default", "secondary", "destructive", "outline"])
          .optional(),
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: false,
    component: BadgeComponent as AnyManifestEntry["component"],
  },

  button: {
    type: "button",
    description:
      "Clickable action button. aria-label is required for accessibility. action is an ActionRegistry key dispatched by the interpreter — never inline code.",
    example: {
      label: "Submit",
      "aria-label": "Submit the form",
      variant: "default",
      size: "md",
      disabled: false,
    },
    propsSchema: z
      .object({
        label: z.string(),
        "aria-label": z.string(), // a11y-required: D-04 / UI-SPEC §11
        variant: z
          .enum(["default", "outline", "ghost", "destructive"])
          .optional(),
        size: z.enum(["sm", "md", "lg"]).optional(),
        disabled: z.boolean().optional(),
        action: z.string().optional(), // ActionRegistry key — no eval
      })
      .strict(),
    lockedProps: ["type", "onClick"] as ReadonlyArray<string>, // UI-SPEC §11: type always "button", onClick via ActionRegistry only
    acceptsChildren: false,
    component: ButtonComponent as AnyManifestEntry["component"],
  },

  card: {
    type: "card",
    description:
      "Container card with optional title, description, and named header/footer slots. Accepts positional children for body content.",
    example: {
      title: "Card Title",
      description: "A short description.",
    },
    propsSchema: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
      })
      .strict(),
    lockedProps: [],
    slots: ["header", "footer"],
    acceptsChildren: true,
    component: CardComponent as AnyManifestEntry["component"],
  },

  "key-value-list": {
    type: "key-value-list",
    description:
      "Renders a definition list (<dl>) of key–value pairs. label is required as the accessible aria-label for the list.",
    example: {
      label: "Email details",
      items: [
        { key: "From", value: "alice@example.com" },
        { key: "Subject", value: "Re: Quarterly report" },
      ],
    },
    propsSchema: z
      .object({
        label: z.string(), // a11y-required: D-04 / UI-SPEC §11
        items: z.array(
          z.object({ key: z.string(), value: z.string() }).strict(),
        ).min(1),
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: false,
    component: KeyValueListComponent as AnyManifestEntry["component"],
  },

  separator: {
    type: "separator",
    description:
      "Decorative horizontal or vertical dividing line. aria-hidden is always true (locked) because this is a purely visual element.",
    example: {
      "aria-hidden": true,
      orientation: "horizontal",
    },
    propsSchema: z
      .object({
        "aria-hidden": z.literal(true), // locked + a11y: D-04 / UI-SPEC §11
        orientation: z.enum(["horizontal", "vertical"]).optional(),
      })
      .strict(),
    lockedProps: ["aria-hidden"] as ReadonlyArray<string>, // UI-SPEC §11: always decorative
    acceptsChildren: false,
    component: SeparatorComponent as AnyManifestEntry["component"],
  },

  alert: {
    type: "alert",
    description:
      "Alert banner for status messages. title is required for accessibility (acts as the accessible label). variant controls color (default or destructive).",
    example: {
      title: "Action required",
      description: "Please review and confirm the changes before proceeding.",
      variant: "default",
    },
    propsSchema: z
      .object({
        title: z.string(), // a11y-required: D-04 / UI-SPEC §11
        description: z.string().optional(),
        variant: z.enum(["default", "destructive"]).optional(),
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: false,
    component: AlertComponent as AnyManifestEntry["component"],
  },

  table: {
    type: "table",
    description:
      "Data table with column headers and row data. caption is required for accessibility and provides a summary of the table contents.",
    example: {
      caption: "Recent emails",
      columns: [
        { key: "from", header: "From" },
        { key: "subject", header: "Subject" },
      ],
      rows: [
        { from: "alice@example.com", subject: "Hello" },
        { from: "bob@example.com", subject: "Follow-up" },
      ],
    },
    propsSchema: z
      .object({
        caption: z.string(), // a11y-required: D-04 / UI-SPEC §11
        columns: z
          .array(
            z.object({ key: z.string(), header: z.string() }).strict(),
          )
          .min(1),
        rows: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: false,
    component: TableComponent as AnyManifestEntry["component"],
  },

  stack: {
    type: "stack",
    description:
      "Flex column (or row) layout container — the PRIMARY primitive for overall page and section structure. Stack sections and cards vertically; nest stacks to build a page. Accepts positional children. Use aria-label when the stack acts as a landmark region.",
    example: {
      direction: "vertical",
      gap: "md",
    },
    propsSchema: z
      .object({
        direction: z.enum(["vertical", "horizontal"]).optional(),
        gap: z.enum(["none", "sm", "md", "lg"]).optional(),
        "aria-label": z.string().optional(), // optional landmark (UI-SPEC §11)
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: true,
    component: StackComponent as AnyManifestEntry["component"],
  },

  grid: {
    type: "grid",
    description:
      "CSS grid of EQUAL-width columns where EACH child fills exactly ONE cell — there is NO column spanning. Set cols to the number of items per row (2–4 is typical for card galleries). cols larger than the child count automatically collapses to fewer, wider columns. Do NOT use grid as a page wrapper or to hold a single wide region — use stack for overall page structure. Use aria-label when acting as a landmark.",
    example: {
      cols: 2,
      gap: "md",
    },
    propsSchema: z
      .object({
        cols: z.number().int().min(1).max(12).optional(),
        gap: z.enum(["none", "sm", "md", "lg"]).optional(),
        "aria-label": z.string().optional(), // optional landmark (UI-SPEC §11)
      })
      .strict(),
    lockedProps: [],
    acceptsChildren: true,
    component: GridComponent as AnyManifestEntry["component"],
  },
} satisfies ComponentRegistry);

// ---------------------------------------------------------------------------
// COST-03 / D-23: Compact encoding + candidate-subsetting seam
// ---------------------------------------------------------------------------

/**
 * Compact representation of a single catalog entry for LLM prompts.
 * Emits only the model-facing surface: type, description, and key schema info.
 * Full propsSchema is NOT sent verbatim — only a minimal hint is emitted.
 */
export type CompactEntry = {
  readonly type: string;
  readonly description: string;
  readonly acceptsChildren: boolean;
  readonly slots: ReadonlyArray<string>;
  readonly lockedProps: ReadonlyArray<string>;
};

/** Returns the compact encoding of a single manifest entry (COST-03). */
export function compactEntry(entry: AnyManifestEntry): CompactEntry {
  return {
    type: entry.type,
    description: entry.description,
    acceptsChildren: entry.acceptsChildren ?? false,
    slots: (entry.slots ?? []) as ReadonlyArray<string>,
    lockedProps: (entry.lockedProps ?? []) as ReadonlyArray<string>,
  };
}

// SEAM (COST-03/D-23): candidate-component subsetting hook — at ~10 components
// we send all; when catalog exceeds threshold, filter here before building the
// compact encoding sent to the model. Insert subsetting predicate at this call site.
/**
 * Returns the compact encoding of all (or a subset of) catalog entries.
 * Consumed by Phase 13's generation prompt to describe the available component vocabulary.
 *
 * @param registry — the ComponentRegistry to encode (defaults to full NAUTA_CATALOG)
 */
export function toCompactCatalog(
  registry: ComponentRegistry = NAUTA_CATALOG,
): ReadonlyArray<CompactEntry> {
  return Object.values(registry).map(compactEntry);
}
