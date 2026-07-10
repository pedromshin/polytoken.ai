/**
 * @polytoken/db — schema barrel
 *
 * Re-exports all Drizzle table definitions, enums, and inferred types so that
 * `import * as schema from "./schema"` in client.ts resolves every symbol.
 *
 * Export order reflects dependency graph (each module only references modules
 * declared before it in this list).
 */

export * from "./_halfvec";
export * from "./_auth";
export * from "./enums";
export * from "./importers";
export * from "./threads";
export * from "./emails";
export * from "./attachments";
export * from "./components";
export * from "./entity-types";
export * from "./extractions";
export * from "./knowledge-nodes";
export * from "./entity-instances";
export * from "./sender-profiles";
export * from "./component-links";
export * from "./knowledge-node-edges";
export * from "./genui-generation-events";
export * from "./ui-spec-templates";
export * from "./chat-conversations";
export * from "./chat-runs";
export * from "./chat-messages";
export * from "./chat-run-events";
export * from "./chat-cost-ledger";
export * from "./chat-canvas-layouts";
export * from "./chat-widget-interactions";
export * from "./autofill-retrieval-events";
