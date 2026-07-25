/**
 * node-type-registry.ts — NODE_TYPE_REGISTRY + resolveNodeType allowlist
 * (CANVAS-03, FOUND-2).
 *
 * One registry contract, many instances (FOUND-2): id + Zod data schema +
 * allowlist semantics, same shape the component catalog (packages/genui's
 * COMPONENT_REGISTRY) and the tRPC procedure allowlist already instantiate.
 * `resolveNodeType` NEVER throws — an unregistered type resolves to an
 * "unknown" marker so the caller can render `UnknownNodeTypePlaceholder`
 * instead of crashing the canvas (T-23-05, D-04: "never breaks").
 */

import type { z } from "zod";

import {
  BriefNodeDataSchema,
  BrowserNodeDataSchema,
  ChatNodeDataSchema,
  CirclePackNodeDataSchema,
  ConversationsNodeDataSchema,
  DesktopNodeDataSchema,
  DirectoryNodeDataSchema,
  DocumentNodeDataSchema,
  DocumentsNodeDataSchema,
  EditorNodeDataSchema,
  EmailThreadNodeDataSchema,
  EntityNodeDataSchema,
  FileNodeDataSchema,
  GenuiPanelNodeDataSchema,
  KnowledgePreviewNodeDataSchema,
  KnowledgeSearchNodeDataSchema,
  PipelineHealthNodeDataSchema,
  ReferencesNodeDataSchema,
  ReviewQueueNodeDataSchema,
  RuleSuggestionsNodeDataSchema,
  SearchAllNodeDataSchema,
  SourceNodeDataSchema,
  SpreadsheetNodeDataSchema,
  UsageNodeDataSchema,
} from "./node-data-schemas";

export interface NodeTypeRegistryEntry {
  readonly id: string;
  readonly dataSchema: z.ZodTypeAny;
  readonly description: string;
}

/**
 * NODE_TYPE_REGISTRY — the allowlist of node types this canvas session
 * recognizes. Component wiring (the module-level `nodeTypes` map React Flow
 * consumes) is assembled in plan 23-03; this registry holds only id + Zod
 * data schema + a short human description per FOUND-2's allowlist contract.
 */
export const NODE_TYPE_REGISTRY: Record<string, NodeTypeRegistryEntry> = {
  chat: {
    id: "chat",
    dataSchema: ChatNodeDataSchema,
    description:
      "Chat node — embeds the conversation's message list and composer.",
  },
  "genui-panel": {
    id: "genui-panel",
    dataSchema: GenuiPanelNodeDataSchema,
    description:
      "Genui-panel node — renders a genui_spec message part by provenance ref.",
  },
  "knowledge-preview": {
    id: "knowledge-preview",
    dataSchema: KnowledgePreviewNodeDataSchema,
    description:
      "Knowledge-preview node — renders a bounded, non-interactive knowledge-graph subgraph anchored on a focus node id.",
  },
  "email-thread": {
    id: "email-thread",
    dataSchema: EmailThreadNodeDataSchema,
    description:
      "Email-thread node — renders a real thread's subject/participants/summary anchored on a thread id, with Open-thread/Attach-chat actions.",
  },
  document: {
    id: "document",
    dataSchema: DocumentNodeDataSchema,
    description:
      "Document node — renders a stored document's title/generated date anchored on a document id, with an Open-document action into /documents/[id].",
  },
  source: {
    id: "source",
    dataSchema: SourceNodeDataSchema,
    description:
      "Source node — an auto-collected research source (RCNV-02/RSRCH-03): title/domain/excerpt from a chat_source_ledger capture, tier-marked suggested until promoted, with an Open-source external link.",
  },
  directory: {
    id: "directory",
    dataSchema: DirectoryNodeDataSchema,
    description:
      "Directory node — a daemon-watched folder anchored on a path, with a bounded immutable tree preview; the live tree arrives via the daemon's fs.list capability.",
  },
  browser: {
    id: "browser",
    dataSchema: BrowserNodeDataSchema,
    description:
      "Browser node — a jailed live-browser panel shell (url bar + daemon screenshot-stream viewport); never mounts an iframe or remote src, keyed on the daemon's browser.* capabilities.",
  },
  editor: {
    id: "editor",
    dataSchema: EditorNodeDataSchema,
    description:
      "Editor node — a jailed textarea editor shell anchored on a filePath ref (never content); load/save travel through the daemon's fs.read/fs.write capabilities.",
  },
  desktop: {
    id: "desktop",
    dataSchema: DesktopNodeDataSchema,
    description:
      "Desktop node — a jailed remote-desktop panel shell anchored on an opaque sessionId (never a gateway url/token); no iframe mounted yet, keyed on the desktop.* control-plane capabilities (spawn/attach/hibernate/destroy).",
  },
  "circle-pack": {
    id: "circle-pack",
    dataSchema: CirclePackNodeDataSchema,
    description:
      "Circle-pack node — a zoomable circle-packing landscape anchored on a scope ref (never the aggregated tree): the mailbox (or one entity), whose sender→thread→email hierarchy rehydrates via emails.circlePackLandscape, OR the drive (optionally rooted at a vault folder), whose folder→file byte hierarchy rehydrates via files.folderSizeRollup (FEATURE-CATALOG TM-03/TM-04).",
  },
  spreadsheet: {
    id: "spreadsheet",
    dataSchema: SpreadsheetNodeDataSchema,
    description:
      "Spreadsheet node — renders a stored table's columns/rows as a read-only grid anchored on a spreadsheetId ref (never the fetched cells); the table rehydrates via api.spreadsheets.byId (ownership-gated) and is produced/updated by the table.* control-plane capabilities (create/update).",
  },
  file: {
    id: "file",
    dataSchema: FileNodeDataSchema,
    description:
      "File node — a vault file placed on the canvas, anchored on a tenant-relative vault ref (folder path segments + basename, never the blob); the file rehydrates (name/size/download) via the ownership-gated files router, resolved against the acting user at read time (FEATURE-CATALOG DR-03).",
  },
  entity: {
    id: "entity",
    dataSchema: EntityNodeDataSchema,
    description:
      "Entity node — a resolved person/organization/etc. card anchored on an entityId ref (never fetched content); name/type/aliases/identifiers/occurrence-and-pending counts rehydrate via entities.byId (owner-scoped), with an Open-entity link into /entities/[id].",
  },
  "knowledge-search": {
    id: "knowledge-search",
    dataSchema: KnowledgeSearchNodeDataSchema,
    description:
      "Knowledge-search node — a searchable card over the learned-knowledge graph anchored on an optional query seed (never fetched rows); results rehydrate via knowledge.search (typed query) / knowledge.list (recent facts), each row deep-linking into /knowledge.",
  },
  "review-queue": {
    id: "review-queue",
    dataSchema: ReviewQueueNodeDataSchema,
    description:
      "Merge-review node — the top slice of the entity merge-review queue as a board card (ref-only); pending pairs rehydrate via entities.reviewQueue, with Merge/Reject acting through entities.confirmMerge/rejectMerge (EN-02).",
  },
  "rule-suggestions": {
    id: "rule-suggestions",
    dataSchema: RuleSuggestionsNodeDataSchema,
    description:
      "Rule-suggestions node — inferred sender/categorization rules aggregated from the user's recent mail (ref-only, read-only); rehydrates via emails.list + emails.ruleSuggestions, each row marked suggested until a human blesses it (MAIL-01).",
  },
  "pipeline-health": {
    id: "pipeline-health",
    dataSchema: PipelineHealthNodeDataSchema,
    description:
      "Pipeline-health node — the inbox pipeline-health panel as a board card (ref-only); per-importer received/analyzed/failed counts rehydrate via the /api/pipeline/health proxy (usePipelineHealth), owner-scoped server-side.",
  },
  brief: {
    id: "brief",
    dataSchema: BriefNodeDataSchema,
    description:
      "Brief node — the daily morning brief as a board card (ref-only, DERIVED live); folds emails.listThreads + entities.reviewQueue + documents.list through shapeMorningBrief into new mail / merges to review / recent documents (HM-02).",
  },
  usage: {
    id: "usage",
    dataSchema: UsageNodeDataSchema,
    description:
      "Usage node — a spend meter as a board card (ref-only, DERIVED live); today's + this session's spend and the configured caps rehydrate via chat.summary (owner-scoped ChatCostLedger read).",
  },
  documents: {
    id: "documents",
    dataSchema: DocumentsNodeDataSchema,
    description:
      "Documents node — the recent-documents list as a board card (ref-only); rows rehydrate via documents.list (owner-scoped), each deep-linking into /documents/[id].",
  },
  references: {
    id: "references",
    dataSchema: ReferencesNodeDataSchema,
    description:
      "References node — the caller's saved references as a board card (ref-only); rows rehydrate via references.list (owner-scoped on ctx.user.id).",
  },
  "search-all": {
    id: "search-all",
    dataSchema: SearchAllNodeDataSchema,
    description:
      "Search node — an omnibox card over everything (ref-only) anchored on an optional query seed; results rehydrate via search.omnibox (typed query), each hit deep-linking to its source.",
  },
  conversations: {
    id: "conversations",
    dataSchema: ConversationsNodeDataSchema,
    description:
      "Conversations node — the recent-chats list as a board card (ref-only, DERIVED live); rows rehydrate via chat.listConversations (owner-scoped), each opening its conversation.",
  },
};

export type ResolvedNodeType =
  | { readonly kind: "registered"; readonly entry: NodeTypeRegistryEntry }
  | { readonly kind: "unknown"; readonly nodeType: string };

/**
 * resolveNodeType — looks up `type` in NODE_TYPE_REGISTRY. Never throws: an
 * unregistered/legacy type resolves to `{ kind: "unknown", nodeType }`, the
 * signal the render path uses to fall back to `UnknownNodeTypePlaceholder`
 * (CANVAS-03, T-23-05).
 */
export function resolveNodeType(type: string): ResolvedNodeType {
  const entry = NODE_TYPE_REGISTRY[type];
  if (entry === undefined) {
    return { kind: "unknown", nodeType: type };
  }
  return { kind: "registered", entry };
}
