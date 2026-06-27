/**
 * demo/showcase-spec.ts — Hand-authored generic component showcase spec.
 *
 * SHOWCASE_SPEC exercises every catalog node type (D-17):
 *   - All 10 catalog types: text, badge, button, card, key-value-list,
 *     separator, alert, table, stack, grid
 *   - Both interpreter control-flow nodes: list, conditional
 *
 * D-17 hard requirements:
 *   - >=1 declared state primitive + action (isExpanded boolean + toggle)
 *   - >=1 dotted-path dataRef ("state.isExpanded" in conditional condition)
 *   - A11y-required props satisfied: button aria-label, separator aria-hidden,
 *     key-value-list label, alert title, table caption (UI-SPEC §11 / D-04)
 *   - Generic showcase — NOT Nauta-flavored (D-17)
 *
 * Schema conformance: All nodes use .strict() schemas — no extra props allowed.
 * All a11y-required fields are present to match manifest propsSchemas (CR-01/02/03 fixed).
 *
 * The `data.demo.rows` array feeds the `list` node iteration and `table` rows.
 * The `state.isExpanded` boolean feeds the `conditional` node (D-17 dataRef proof).
 * key-value-list items use static `value` strings; dynamic resolution is Phase 13+.
 *
 * SpecRootSchema.safeParse(SHOWCASE_SPEC).success === true.
 */

import type { SpecRoot } from "../schema/spec-schema";

export const SHOWCASE_SPEC: SpecRoot = {
  v: 1,

  /**
   * Data block: named bindings injected at render time (SPEC-05).
   * Accessible via dotted-path dataRef: "data.demo.title", "data.demo.rows", etc.
   */
  data: {
    demo: {
      title: "Component Showcase",
      subtitle: "Generic component library preview",
      rows: [
        { id: "row-1", name: "Button", category: "Action", status: "Live" },
        { id: "row-2", name: "Badge", category: "Display", status: "Live" },
        { id: "row-3", name: "Alert", category: "Feedback", status: "Live" },
      ],
      metadata: {
        version: "1.0.0",
        author: "Nauta",
        updated: "2026-06-27",
      },
    },
  },

  /**
   * State block: declared primitives materialised by useDeclaredState (SPEC-04/D-11).
   * D-17: >=1 declared primitive + >=1 action.
   */
  state: [
    {
      name: "isExpanded",
      type: "boolean",
      initial: false,
      actions: [
        { name: "toggle", mutation: "toggle" },
      ],
    },
    {
      name: "counter",
      type: "number",
      initial: 0,
      actions: [
        { name: "increment", mutation: "increment" },
        { name: "decrement", mutation: "decrement" },
        { name: "reset", mutation: "reset" },
      ],
    },
  ],

  /**
   * Root tree: top-level `stack` containing one node of EVERY catalog type
   * plus `list` and `conditional` control-flow nodes (D-17).
   *
   * All nodes conform to .strict() schemas — no unrecognized fields.
   * All a11y-required props are present (CR-01/02/03 fix applied):
   *   - button: aria-label required (D-04 / UI-SPEC §11)
   *   - separator: aria-hidden: true required (D-04 / UI-SPEC §11)
   *   - key-value-list: label required (D-04 / UI-SPEC §11)
   *
   * Structure:
   *   stack (root)
   *     ├── text (heading — showcase title)
   *     ├── badge (version label)
   *     ├── separator (visual divider, aria-hidden: true)
   *     ├── button (toggle action, aria-label required)
   *     ├── alert (with required title)
   *     ├── card (with title + footer slot + children)
   *     │   └── key-value-list (inside card body, label + static value items)
   *     ├── table (with caption + columns + rows)
   *     ├── grid (2-column layout)
   *     │   ├── text (grid cell 1)
   *     │   └── text (grid cell 2)
   *     ├── list (iterates data.demo.rows — dataRef proof)
   *     │   └── itemTemplate: text (renders each row name)
   *     └── conditional (keyed on state.isExpanded — dotted-path dataRef proof)
   *         ├── then: text ("Expanded section visible")
   *         └── else: text ("Click toggle to expand")
   */
  root: {
    type: "stack",
    direction: "vertical",
    gap: "lg",
    children: [
      // ---- text node --------------------------------------------------------
      {
        type: "text",
        content: "Component Showcase",
        variant: "heading",
      },

      // ---- badge node -------------------------------------------------------
      {
        type: "badge",
        label: "v1",
        variant: "secondary",
      },

      // ---- separator node (aria-hidden: true — locked, decorative) ----------
      {
        type: "separator",
        "aria-hidden": true,
        orientation: "horizontal",
      },

      // ---- button node (aria-label required — D-04 / UI-SPEC §11) ----------
      {
        type: "button",
        label: "Toggle Section",
        "aria-label": "Toggle the expanded section",
        variant: "outline",
        action: "toggle",
      },

      // ---- alert node (title required) --------------------------------------
      {
        type: "alert",
        title: "Showcase Alert",
        description: "This alert demonstrates the alert catalog component with title and description.",
        variant: "default",
      },

      // ---- card node (with key-value-list inside body + footer slot) ---------
      {
        type: "card",
        title: "Component Details",
        description: "Metadata about this showcase.",
        children: [
          // key-value-list: label required (a11y aria-label); items use static values (CR-03 fix)
          {
            type: "key-value-list",
            label: "Showcase metadata",
            items: [
              { key: "Version", value: "1.0.0" },
              { key: "Author", value: "Nauta" },
              { key: "Updated", value: "2026-06-27" },
            ],
          },
        ],
        footer: {
          type: "text",
          content: "End of card details",
          variant: "caption",
          muted: true,
        },
      },

      // ---- table node (caption required) ------------------------------------
      {
        type: "table",
        caption: "Component catalog overview",
        columns: [
          { key: "name", header: "Component" },
          { key: "category", header: "Category" },
          { key: "status", header: "Status" },
        ],
        rows: [
          { name: "Button", category: "Action", status: "Live" },
          { name: "Badge", category: "Display", status: "Live" },
          { name: "Alert", category: "Feedback", status: "Live" },
          { name: "Card", category: "Container", status: "Live" },
          { name: "Table", category: "Data", status: "Live" },
        ],
      },

      // ---- grid node (2-column layout) --------------------------------------
      {
        type: "grid",
        cols: 2,
        gap: "md",
        children: [
          {
            type: "text",
            content: "Left column content",
            variant: "body",
          },
          {
            type: "text",
            content: "Right column content",
            variant: "body",
          },
        ],
      },

      // ---- list node (iterates data.demo.rows — D-17 dataRef proof) ---------
      {
        type: "list",
        dataRef: "data.demo.rows",
        itemKey: "id",
        itemTemplate: {
          type: "text",
          content: "Catalog row item",
          variant: "label",
        },
        emptyState: {
          type: "text",
          content: "No items available",
          variant: "caption",
          muted: true,
        },
      },

      // ---- conditional node (state.isExpanded — D-17 dotted-path dataRef proof)
      {
        type: "conditional",
        condition: {
          dataRef: "state.isExpanded",
          operator: "truthy",
        },
        then: {
          type: "text",
          content: "Expanded section is now visible. The conditional node resolved state.isExpanded = true.",
          variant: "body",
        },
        else: {
          type: "text",
          content: "Click Toggle Section above to expand. (state.isExpanded is false)",
          variant: "caption",
          muted: true,
        },
      },
    ],
  },
};
