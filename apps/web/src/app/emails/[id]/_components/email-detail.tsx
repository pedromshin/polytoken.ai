"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";

import { EmailBodyView } from "~/components/email-preview/body-view";
import { PreviewCarousel } from "~/components/email-preview/preview-carousel";
import { useEmailPreview } from "~/components/email-preview/use-email-preview";
import { useSignedAttachmentUrl } from "~/hooks/use-signed-attachment-url";
import { api } from "~/trpc/react";

import { ActiveParentBanner } from "./active-parent-banner";
import { CanvasShell } from "./canvas-shell";
import { ExtractionSummaryPanel } from "./extraction-summary-panel";
import { InspectorPanel } from "./inspector-panel";
import { LayersPanel } from "./layers-panel";
import { ParseStatusMarker } from "./parse-status-marker";
import { PdfPreviewPane } from "./pdf-preview-pane";
import { ReprocessDialog } from "./reprocess-dialog";
import { useAutofillFields } from "./use-autofill-fields";
import { useCanvasState } from "./use-canvas-state";
import { useRoleMutations } from "./use-role-mutations";

import type { ParentEntityOption } from "./field-relationship-picker";
import type { InspectorComponent } from "./inspector-panel";
import type { LayersComponent } from "./layers-panel";
import type { ComponentRole } from "~/components/regions/region-overlay-box";
import type { Polygon } from "./use-region-edit";

/** Full-page polygon used by the legacy "Classify Page" affordance. */
const FULL_PAGE_POLYGON: Polygon = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const fmt = (d: Date | string | null) =>
  d ? new Date(d).toLocaleString() : "—";

function getLocationPageIndex(location: unknown): number | null {
  if (
    location !== null &&
    typeof location === "object" &&
    "page_index" in location &&
    typeof (location as { page_index?: unknown }).page_index === "number"
  ) {
    return (location as { page_index: number }).page_index;
  }
  return null;
}

/** The lineage origin marker AutofillFieldsUseCase stamps on auto-detected boxes. */
const AUTO_DETECTED_ORIGIN = "auto_detected";

/**
 * Read the lineage origin from a component's content_raw (HIGH-1/WR-05), mirroring
 * the server's DenyFieldUseCase: recognizes both the nested `lineage.origin`
 * Phase-6 convention and a flat top-level `origin`. True ONLY for an auto-detected
 * box — any other value (including null/missing) means user-drawn.
 */
function isAutoDetectedOrigin(contentRaw: unknown): boolean {
  if (contentRaw === null || typeof contentRaw !== "object") return false;
  const raw = contentRaw as Record<string, unknown>;
  const lineage = raw.lineage;
  if (lineage !== null && typeof lineage === "object") {
    const origin = (lineage as Record<string, unknown>).origin;
    if (typeof origin === "string") return origin === AUTO_DETECTED_ORIGIN;
  }
  return raw.origin === AUTO_DETECTED_ORIGIN;
}

/** Narrow a raw confidence value (string|number|null|unknown) to number|null. */
function toConfidence(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/**
 * Resolve a FIELD's candidate value from its extraction record (WR-02).
 *
 * extractedFields is the JSONB blob keyed by field SLUG. When the FIELD box is
 * mapped to a property (entity_type_field_id → its slug, `fieldKey`), the value
 * is selected DETERMINISTICALLY by that key — never `Object.entries(...)[0]`,
 * which could surface a value for a different property than the mapped one.
 *
 * `fieldKey` is the resolved slug for the mapped entity_type_field_id (null when
 * the box is not yet mapped). Falls back to the single-entry blob only when the
 * box is unmapped AND exactly one value exists (a safe, unambiguous default).
 * Rendered as a React text node (auto-escaped, T-09-80).
 */
function getCandidateValue(
  extractedFields: unknown,
  fieldKey: string | null,
): string | null {
  if (
    extractedFields === null ||
    typeof extractedFields !== "object" ||
    Array.isArray(extractedFields)
  ) {
    return null;
  }
  const fields = extractedFields as Record<string, unknown>;

  // Mapped: select the value for the mapped property's slug (deterministic).
  if (fieldKey !== null) {
    const v = fields[fieldKey];
    return v === null || v === undefined ? null : String(v);
  }

  // Unmapped: only surface a candidate when exactly one value exists, so an
  // unmapped box never shows an arbitrary value from a multi-property blob.
  const entries = Object.entries(fields);
  if (entries.length === 1) {
    const [, v] = entries[0]!;
    return v === null || v === undefined ? null : String(v);
  }
  return null;
}

/**
 * Resolve the extractedFields KEY that `getCandidateValue` surfaced (UI-2).
 *
 * The Inspector needs this key to build corrected_fields when the user edits
 * the candidate value before confirming: the correction must be keyed by the
 * same slug the machine value lives under. Mirrors getCandidateValue's
 * selection exactly — the mapped slug when mapped, else the single-entry key
 * of an unambiguous blob — and returns null when no addressable key exists
 * (unmapped multi-property blob), in which case the edit cannot be keyed.
 */
function getCandidateFieldKey(
  extractedFields: unknown,
  fieldKey: string | null,
): string | null {
  if (
    extractedFields === null ||
    typeof extractedFields !== "object" ||
    Array.isArray(extractedFields)
  ) {
    return null;
  }
  const fields = extractedFields as Record<string, unknown>;
  if (fieldKey !== null) {
    return fieldKey in fields ? fieldKey : null;
  }
  const entries = Object.entries(fields);
  return entries.length === 1 ? entries[0]![0] : null;
}

interface EmailDetailProps {
  emailId: string;
  /**
   * EMBEDDED mode (the inbox inline preview — "editor is the email preview
   * itself, no separate things"). When true the editor renders WITHOUT the
   * page `<main>`, the back-to-inbox link, or the mount-focus `<h1>` (the inbox
   * owns the subject and must not have focus stolen on every selection). A
   * compact status/reprocess row replaces the full page header. Default false
   * keeps the standalone-page behavior byte-identical.
   */
  embedded?: boolean;
}

export function EmailDetail({ emailId, embedded = false }: EmailDetailProps) {
  const { data, isLoading, isError } = api.emails.detail.useQuery({
    id: emailId,
  });

  // ---- PDF preview state (hoisted for the canvas zone) ----
  const [activeAttachmentId, setActiveAttachmentId] = useState<string | null>(
    null,
  );
  const [activeComponentId, setActiveComponentId] = useState<string | null>(
    null,
  );
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Signed URL for the active attachment — fetch/cache/expiry extracted to
  // the shared hook (WR-01/08), behavior unchanged.
  const activeSignedUrl = useSignedAttachmentUrl(activeAttachmentId);

  // EMBEDDED (inbox) attachment carousel (Task 3): the slide model + lazy PDF
  // page counts. Enabled only in embedded mode — the query dedupes with the
  // `emails.detail` query above (same key), so this adds no extra fetch. In the
  // standalone editor (non-embedded) this stays disabled (null id) and the
  // full four-zone CanvasShell editor renders as before.
  const preview = useEmailPreview(embedded ? emailId : null);

  // ---- Canvas shell view-toggle state ----
  const [showRegions, setShowRegions] = useState<boolean>(true);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [showUnrelated, setShowUnrelated] = useState<boolean>(false);

  // ---- Resolve the attachment_page parent for the current page (createRegion) ----
  const utils = api.useUtils();

  // ---- Reprocess dialog (preserved from Phase 7) ----
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const reprocessMutation = api.emails.reprocessEmail.useMutation({
    onSuccess: async () => {
      await utils.emails.detail.invalidate({ id: emailId });
      toast.success("On it — reprocessing this email");
    },
    onError: () => toast.error("Couldn't reprocess this email. Try again."),
  });

  // ---- Entity types (label resolution + slug → id mapping) ----
  const { data: entityTypes } = api.entityTypes.list.useQuery();
  const slugToId = useMemo(() => {
    const map = new Map<string, string>();
    for (const et of entityTypes ?? []) map.set(et.slug, et.id);
    return map;
  }, [entityTypes]);
  const idToLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const et of entityTypes ?? []) map.set(et.id, et.label);
    return map;
  }, [entityTypes]);
  /** entityTypeFieldId → label, for FIELD property labels in the tree/inspector. */
  const fieldIdToLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const et of entityTypes ?? []) {
      for (const f of et.fields) map.set(f.id, f.label);
    }
    return map;
  }, [entityTypes]);
  /**
   * entityTypeFieldId (uuid) → field key/slug (WR-02). extractedFields is keyed
   * by slug; this resolves the mapped property's slug so the candidate value is
   * selected deterministically (not by JSONB insertion order).
   */
  const fieldIdToKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const et of entityTypes ?? []) {
      for (const f of et.fields) map.set(f.id, f.key);
    }
    return map;
  }, [entityTypes]);

  /** Resolve a component's mapped field slug (null when unmapped). */
  function fieldKeyFor(entityTypeFieldId: string | null): string | null {
    return entityTypeFieldId !== null
      ? (fieldIdToKey.get(entityTypeFieldId) ?? null)
      : null;
  }

  // ---- 09-08 hooks: canvas state + role mutations + autofill-fields ----
  const components = data?.components ?? [];

  function resolvePageComponentId(pageIndex: number): string | null {
    if (activeAttachmentId === null) return null;
    const pageComp = components.find(
      (c) =>
        c.sourceType === "attachment_page" &&
        c.attachmentId === activeAttachmentId &&
        getLocationPageIndex(c.location) === pageIndex,
    );
    return pageComp?.id ?? null;
  }

  const canvas = useCanvasState({ emailId });
  const roleMutations = useRoleMutations({ emailId });
  const autofill = useAutofillFields({
    emailId,
    confirmFields: roleMutations.confirmFields,
  });

  // D-10: a box drawn while an entity is the active parent becomes a FIELD child
  // of that entity. createRegion returns the new id; we chain setRole=field +
  // setFieldRelationship(parentComponentId) so the next-drawn box is a field.
  const createFieldRegionMutation = api.emails.createRegion.useMutation({
    onSuccess: async (raw, _vars) => {
      const newId = (
        raw as { data?: { component_id?: string } } | null | undefined
      )?.data?.component_id;
      const parentId = canvas.activeParentId;
      if (typeof newId === "string" && parentId !== null) {
        roleMutations.setRole(newId, "field");
        roleMutations.setFieldRelationship(newId, parentId, null);
      }
      await utils.emails.detail.invalidate({ id: emailId });
    },
    onError: () => toast.error("Couldn't add that field region. Try again."),
  });

  const h1Ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Embedded in the inbox: the preview mounts on every selection change, so
    // stealing focus to the subject would yank the caret off the thread list.
    if (!embedded) h1Ref.current?.focus();
  }, [embedded]);

  // Auto-open the first PDF attachment on load (the preview is the core
  // surface) — but only ONCE. After the user closes it, the canvas falls back
  // to the email body pane; without this guard the effect would immediately
  // re-open the attachment and the body would be unreachable.
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    // EMBEDDED (inbox): the carousel owns attachment rendering and lazily mounts
    // react-pdf only for near-viewport slides. Auto-opening the first PDF here
    // would eagerly mount the heavy PdfPreviewPane on every inbox selection and
    // fetch a signed URL nobody asked for — exactly the inbox-scroll cost the
    // carousel exists to avoid. Skip it; the carousel is the embedded surface.
    if (embedded) return;
    if (didAutoOpenRef.current) return;
    if (activeAttachmentId !== null) return;
    const atts = data?.attachments ?? [];
    if (atts.length === 0) return;
    const firstPdf =
      atts.find((a) => a.contentType === "application/pdf") ?? atts[0];
    if (firstPdf) {
      didAutoOpenRef.current = true;
      setActiveAttachmentId(firstPdf.id);
    }
  }, [data, activeAttachmentId]);

  // Page renders as <main>; embedded (inbox) renders as a plain <div> so it
  // never nests a second <main> inside the inbox's landmark.
  const Root = embedded ? "div" : "main";

  if (isLoading) {
    // The skeleton predicts the frame it stands in — a header bar, then the
    // canvas zone — so the load reads as this page assembling rather than as
    // three slabs that resemble nothing which ever arrives.
    return (
      <Root className="h-full">
        <div
          className="flex h-full flex-col"
          aria-busy="true"
          aria-label="Loading…"
        >
          <div className="flex shrink-0 items-center gap-4 border-b border-hair px-row-x py-row-y">
            <Skeleton className="h-4 w-28 rounded-sm" />
            <Skeleton className="h-6 max-w-md flex-1 rounded-sm" />
            <Skeleton className="h-5 w-14 rounded-sm" />
            <Skeleton className="h-8 w-32 rounded-sm" />
          </div>
          <div className="min-h-0 flex-1 p-4">
            <Skeleton className="h-full w-full rounded-card" />
          </div>
        </div>
      </Root>
    );
  }

  if (isError) {
    // An error is not irreversible, so it earns no madder (law 1: "never
    // errors, never warnings"). It is ink on a rule — the same framed block
    // the inbox uses, so a failure reads the same way on both surfaces.
    //
    // T-60-10: the copy stays generic on purpose. The underlying error is
    // NOT interpolated here — a tRPC message or a raw error object would
    // leak server-side detail to the client for no user benefit. Whatever
    // went wrong, the user's move is the same: refresh.
    return (
      <Root className="h-full p-6">
        <div role="alert" className="border border-rule p-panel">
          <p className="text-sm font-semibold text-ink">
            Failed to load email
          </p>
          <p className="mt-1 text-xs text-faded">
            Unable to load this email. Please try refreshing the page.
          </p>
        </div>
      </Root>
    );
  }

  if (data === null || data === undefined) {
    return (
      <Root className="h-full p-6">
        <div className="border border-rule p-panel">
          <p className="text-sm font-semibold text-ink">Email not found</p>
          <p className="mt-1 text-xs text-faded">
            Email not found. It may have been deleted or the link is invalid.
          </p>
        </div>
      </Root>
    );
  }

  const { email, attachments } = data;
  const subject = email.subject ?? "(no subject)";

  // ---- EMBEDDED (inbox) attachment carousel (Task 3) ----
  // Selecting a message in the inbox (`/?email=<id>`) renders THIS branch. The
  // attachments render as a horizontal, swipeable carousel — one slide for the
  // body, one per attachment, and one slide PER PAGE for multi-page PDFs, with
  // mixed formats (PDF / image / download card) coexisting. Offscreen slides
  // are placeholders (PreviewCarousel mounts only active ± 1), and the react-pdf
  // bearing slide view is next/dynamic'd, so pdfjs never ships with the inbox
  // shell and a 200-page PDF never mounts every page. Region overlays render
  // through the SHARED OverlayLayer (AttachmentPageView), the same box layer the
  // standalone editor uses — no forked overlay code.
  //
  // Returned early, BEFORE the editor-only view-model derivations below, so the
  // inbox pays for none of the four-zone editor machinery. Editing (draw /
  // confirm / layers / inspector) remains the non-embedded editor's job; a
  // follow-up can re-home editing onto the carousel or unify the body's
  // text-anchored highlights into the same OverlayLayer.
  if (embedded) {
    return (
      <Root className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-end gap-3 border-b border-hair px-row-x py-2">
          <ParseStatusMarker status={email.parseStatus} error={email.parseError} />
          <Button
            variant="outline"
            size="sm"
            aria-label="Reprocess this email"
            disabled={reprocessMutation.isPending}
            onClick={() => setReprocessDialogOpen(true)}
          >
            Reprocess
          </Button>
        </div>

        <ReprocessDialog
          open={reprocessDialogOpen}
          onOpenChange={setReprocessDialogOpen}
          onConfirm={() => {
            reprocessMutation.mutate({ emailId });
            setReprocessDialogOpen(false);
          }}
        />

        <div className="min-h-0 flex-1">
          <PreviewCarousel
            slides={preview.slides}
            bodyText={email.bodyText}
            bodyHtml={email.bodyHtml}
            components={preview.data?.components ?? []}
            onDocumentLoad={preview.onDocumentLoad}
          />
        </div>
      </Root>
    );
  }

  // attachment_page parent for the current page (createRegion / classify).
  const pageComponentId =
    activeAttachmentId !== null
      ? resolvePageComponentId(currentPage - 1)
      : null;

  // ---- Derive view-model rows for LAYERS + INSPECTOR ----
  const layersComponents: LayersComponent[] = components.map((c) => ({
    id: c.id,
    sourceType: c.sourceType,
    role: (c.role ?? null) as ComponentRole,
    parentComponentId: c.parentComponentId ?? null,
    entityTypeLabel:
      c.entityTypeId !== null
        ? (idToLabel.get(c.entityTypeId) ?? c.entityTypeLabel)
        : c.entityTypeLabel,
    entityTypeFieldId: c.entityTypeFieldId ?? null,
    extractionStatus: c.extractionStatus,
    location: c.location,
    contentText: c.contentText,
    candidateValue: getCandidateValue(
      c.extractedFields,
      fieldKeyFor(c.entityTypeFieldId ?? null),
    ),
    propertyLabel:
      c.entityTypeFieldId !== null
        ? (fieldIdToLabel.get(c.entityTypeFieldId) ?? null)
        : null,
  }));

  // HIGH-1/D-16: FIELD boxes that carry a pending candidate value get the on-PDF
  // inline ✓/✗. Confirmed/terminal boxes show no controls (UI-SPEC §Inline ✓/✗).
  const confirmDenyComponentIds: string[] = components
    .filter(
      (c) =>
        c.role === "field" &&
        c.extractionStatus !== "confirmed" &&
        c.extractionStatus !== "rejected" &&
        c.extractionStatus !== "superseded" &&
        getCandidateValue(
          c.extractedFields,
          fieldKeyFor(c.entityTypeFieldId ?? null),
        ) !== null,
    )
    .map((c) => c.id);

  // WR-05/D-18: boxes the AI auto-detected (origin marker) drive the canonical
  // control's origin-aware deny + Undo affordance on the PDF.
  const autoDetectedComponentIds: string[] = components
    .filter((c) => isAutoDetectedOrigin(c.contentRaw))
    .map((c) => c.id);

  // Same-page ENTITY regions for the field-relationship parent picker (06-04).
  const selectedId = canvas.selectedIds[0] ?? null;
  const selectedComponent =
    selectedId !== null
      ? components.find((c) => c.id === selectedId)
      : undefined;
  const selectedPageIndex =
    selectedComponent !== undefined
      ? getLocationPageIndex(selectedComponent.location)
      : null;

  const parentOptions: ParentEntityOption[] = components
    .filter(
      (c) =>
        c.sourceType === "region" &&
        c.role === "entity" &&
        c.id !== selectedId &&
        c.extractionStatus !== "rejected" &&
        c.extractionStatus !== "superseded" &&
        (selectedPageIndex === null ||
          getLocationPageIndex(c.location) === selectedPageIndex),
    )
    .map((c) => ({
      id: c.id,
      label:
        (c.entityTypeId !== null ? idToLabel.get(c.entityTypeId) : null) ??
        c.entityTypeLabel ??
        "Entity",
      entityTypeId: c.entityTypeId ?? null,
      entityTypeLabel:
        (c.entityTypeId !== null ? idToLabel.get(c.entityTypeId) : null) ??
        c.entityTypeLabel,
    }));

  // The candidate field children of the selected entity (Confirm All Fields).
  const candidateFieldIds =
    selectedComponent !== undefined && selectedComponent.role === "entity"
      ? components
          .filter(
            (c) =>
              c.role === "field" &&
              c.parentComponentId === selectedComponent.id &&
              c.extractionStatus !== "confirmed" &&
              getCandidateValue(
                c.extractedFields,
                fieldKeyFor(c.entityTypeFieldId ?? null),
              ) !== null,
          )
          .map((c) => c.id)
      : [];

  const inspectorSelected: InspectorComponent | null =
    selectedComponent !== undefined
      ? {
          id: selectedComponent.id,
          role: (selectedComponent.role ?? null) as ComponentRole,
          entityTypeId: selectedComponent.entityTypeId ?? null,
          entityTypeFieldId: selectedComponent.entityTypeFieldId ?? null,
          parentComponentId: selectedComponent.parentComponentId ?? null,
          entityTypeLabel:
            selectedComponent.entityTypeId !== null
              ? (idToLabel.get(selectedComponent.entityTypeId) ??
                selectedComponent.entityTypeLabel)
              : selectedComponent.entityTypeLabel,
          extractionStatus: selectedComponent.extractionStatus,
          pageNumber:
            (getLocationPageIndex(selectedComponent.location) ?? 0) + 1,
          candidateValue: getCandidateValue(
            selectedComponent.extractedFields,
            fieldKeyFor(selectedComponent.entityTypeFieldId ?? null),
          ),
          candidateFieldKey: getCandidateFieldKey(
            selectedComponent.extractedFields,
            fieldKeyFor(selectedComponent.entityTypeFieldId ?? null),
          ),
          confidenceScore: toConfidence(selectedComponent.confidenceScore),
          propertyLabel:
            selectedComponent.entityTypeFieldId !== null
              ? (fieldIdToLabel.get(selectedComponent.entityTypeFieldId) ?? null)
              : null,
          candidateFieldIds,
        }
      : null;

  const inspectorEntityTypeLabel =
    selectedComponent !== undefined && selectedComponent.entityTypeId !== null
      ? (idToLabel.get(selectedComponent.entityTypeId) ?? null)
      : null;

  // The active-parent entity label (D-10 banner).
  const activeParentComponent =
    canvas.activeParentId !== null
      ? components.find((c) => c.id === canvas.activeParentId)
      : undefined;
  const activeParentLabel =
    activeParentComponent !== undefined
      ? ((activeParentComponent.entityTypeId !== null
          ? idToLabel.get(activeParentComponent.entityTypeId)
          : null) ??
        activeParentComponent.entityTypeLabel ??
        "Entity")
      : "";

  // Selecting a row drives selection + arms active-parent (D-10).
  //   - ENTITY → arm it as the active parent (its fields reveal; focus mode).
  //   - FIELD  → select the field but KEEP its parent entity active (B4) so the
  //     entity stays armed, the field's siblings stay visible, and the field
  //     surfaces in the inspector — clicking a field must not deselect the entity.
  //   - anything else → clear the active parent.
  function handleSelectRow(id: string): void {
    canvas.select(id);
    setActiveComponentId(id);
    const comp = components.find((c) => c.id === id);
    const pageIndex = comp ? getLocationPageIndex(comp.location) : null;
    if (pageIndex !== null) setCurrentPage(pageIndex + 1);
    if (comp?.role === "entity") {
      canvas.setActiveParentId(id);
    } else if (
      comp?.role === "field" &&
      comp.parentComponentId !== null &&
      comp.parentComponentId !== undefined
    ) {
      canvas.setActiveParentId(comp.parentComponentId);
    } else {
      canvas.setActiveParentId(null);
    }
  }

  // INSPECTOR: resolve the chosen entity-type slug → id, then setEntityType.
  function handleSetEntityTypeSlug(componentId: string, slug: string): void {
    const id = slugToId.get(slug) ?? null;
    roleMutations.setEntityType(componentId, id);
  }

  // Route a finished draw (D-08/D-10): redraw/split take precedence; otherwise a
  // draw with an active parent becomes a FIELD child of that entity, and a draw
  // with no active parent creates a standalone unclassified region.
  function handleRectDrawn(polygon: Polygon): void {
    if (canvas.edit.drawMode === "redraw" && selectedId !== null) {
      canvas.edit.redraw(selectedId, polygon, currentPage - 1);
    } else if (canvas.edit.drawMode === "split") {
      canvas.edit.pushRect(polygon);
    } else if (pageComponentId !== null) {
      if (canvas.activeParentId !== null) {
        // The mutation's zod input expects a mutable [number, number][]; copy
        // the readonly Polygon into fresh tuples (immutable source preserved).
        createFieldRegionMutation.mutate({
          pageComponentId,
          polygon: polygon.map(([x, y]) => [x, y] as [number, number]),
          pageIndex: currentPage - 1,
        });
        canvas.edit.cancelDraw();
      } else {
        canvas.edit.createRegion(pageComponentId, polygon, currentPage - 1);
      }
    } else {
      // MEDIUM-B: no resolvable attachment_page component to anchor a new region
      // on this page — drawing here cannot create anything. Surface why instead
      // of silently dropping the drawn rect (which looks like a dead toggle).
      canvas.edit.cancelDraw();
      toast.warning(
        "Can't draw here — this page doesn't have a recognized document page to attach to.",
      );
    }
  }

  function handleConfirmSplit(): void {
    if (selectedId === null || canvas.edit.drawnRects.length < 2) return;
    canvas.edit.split(
      selectedId,
      canvas.edit.drawnRects.map((polygon) => ({
        polygon,
        pageIndex: currentPage - 1,
      })),
    );
  }

  const inspectorAutofillPhase =
    selectedComponent !== undefined
      ? autofill.phases[selectedComponent.id]
      : undefined;

  const canvasZone =
    activeAttachmentId !== null && !activeSignedUrl ? (
      <div className="p-4">
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    ) : activeAttachmentId !== null && activeSignedUrl ? (
      <PdfPreviewPane
        signedUrl={activeSignedUrl}
        filename={
          attachments.find((a) => a.id === activeAttachmentId)?.filename ??
          "attachment.pdf"
        }
        components={components}
        activeComponentId={activeComponentId}
        setActiveComponentId={setActiveComponentId}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onClose={() => setActiveAttachmentId(null)}
        // Single source of truth for overlay visibility (Bundle C): the shell
        // "Regions" toggle owns the state and drives the on-PDF overlays via
        // this controlled read-only prop (the pane has no separate toggle).
        showOverlays={showRegions}
        selectedComponentIds={canvas.selectedIds}
        drawMode={canvas.edit.drawMode}
        liveRect={canvas.edit.liveRect}
        setLiveRect={canvas.edit.setLiveRect}
        drawnRects={canvas.edit.drawnRects}
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        mutatingComponentIds={[
          ...canvas.mutatingIds,
          ...roleMutations.mutatingComponentIds,
        ]}
        onSelectComponent={handleSelectRow}
        onShiftClick={canvas.shiftToggle}
        onClearSelection={() => {
          canvas.clearSelection();
          canvas.clearActiveParent();
        }}
        onAccept={canvas.edit.accept}
        onReject={canvas.edit.reject}
        onRedraw={() => canvas.edit.enterDraw("redraw")}
        onSplit={() => canvas.edit.enterDraw("split")}
        onEnterDraw={canvas.edit.enterDraw}
        onCancelDraw={canvas.edit.cancelDraw}
        onRectDrawn={handleRectDrawn}
        onConfirmSplit={handleConfirmSplit}
        canAddRegion={pageComponentId !== null}
        onClassifyPage={
          pageComponentId !== null
            ? () =>
                canvas.edit.createRegion(
                  pageComponentId,
                  FULL_PAGE_POLYGON,
                  currentPage - 1,
                )
            : undefined
        }
        onClassifyDocument={
          pageComponentId !== null
            ? () => canvas.edit.classifyDocument(pageComponentId)
            : undefined
        }
        rejectDialogOpen={canvas.edit.rejectDialogOpen}
        onRejectDialogChange={canvas.edit.setRejectDialogOpen}
        nestPickerOpen={canvas.edit.nestPickerOpen}
        onNestPickerChange={canvas.edit.setNestPickerOpen}
        eligibleRegions={parentOptions.map((p) => ({
          id: p.id,
          extractionStatus: "candidate",
          entityTypeLabel: p.entityTypeLabel,
        }))}
        onMerge={(ids) => canvas.edit.merge(ids)}
        onNest={(componentId, parentId) =>
          canvas.edit.nest(componentId, parentId)
        }
        onUnNest={(componentId) => canvas.edit.nest(componentId, null)}
        // ---- Phase 9 (HIGH-2): the shell Draw tool arms drag-to-draw ----
        canvasMode={canvas.mode}
        // ---- Phase 9 (HIGH-1/WR-01): relationship model on the PDF ----
        activeParentId={canvas.activeParentId}
        showUnrelated={showUnrelated}
        confirmDenyComponentIds={confirmDenyComponentIds}
        autoDetectedComponentIds={autoDetectedComponentIds}
        onConfirmField={roleMutations.confirmField}
        onDenyField={roleMutations.denyField}
      />
    ) : (
      // No attachment open — render the email body as the document. For a
      // body-only email (no attachment bytes, e.g. Gmail-forwarded) this IS the
      // whole message; EmailBodyView also handles the truly-empty case. Passing
      // `components` paints the email_body-sourced region highlights (text-
      // anchored, display-only) so the body shows its detected regions too.
      <EmailBodyView
        bodyText={email.bodyText}
        bodyHtml={email.bodyHtml}
        components={components}
      />
    );

  return (
    <Root className="flex flex-col h-full">
      {/* Header row: back link, subject, parse-status marker, reprocess button.
          Mirrors the reference's .rp-head — the subject leads, everything else
          is chrome ranged around it. (The embedded/inbox surface returns the
          carousel far above and never reaches this standalone-editor header.) */}
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-hair px-row-x py-row-y">
        <Link
          href="/"
          className="text-sm text-faded transition-colors hover:text-ink"
        >
          ← Back to inbox
        </Link>
        {/* The subject is the user's own mail, not our label for it — law 2
            gives the document's words the serif. This is also the page's a11y
            entry point: h1Ref + tabIndex={-1} + the mount-focus effect are
            load-bearing, and the subject stays a plain React text node
            (T-60-02) — never interpolated into a class or a style. */}
        <h1
          ref={h1Ref}
          className="flex-1 truncate font-serif text-xl font-semibold text-ink outline-none"
          data-evidence
          tabIndex={-1}
        >
          {subject}
        </h1>
        {/* ING-6: the lifecycle is now driven by the listener — 'failed' /
            'degraded' are reachable states, rendered visibly distinct (ink
            weight, never madder) with the recorded parse_error surfaced. */}
        <ParseStatusMarker status={email.parseStatus} error={email.parseError} />

        <Button
          variant="outline"
          size="sm"
          aria-label="Reprocess this email"
          disabled={reprocessMutation.isPending}
          onClick={() => setReprocessDialogOpen(true)}
        >
          Reprocess Email
        </Button>
      </header>

      <ReprocessDialog
        open={reprocessDialogOpen}
        onOpenChange={setReprocessDialogOpen}
        onConfirm={() => {
          reprocessMutation.mutate({ emailId });
          setReprocessDialogOpen(false);
        }}
      />

      {/* The four-zone canvas editor (D-06) */}
      <div className="flex-1 min-h-0">
        <CanvasShell
          state={canvas}
          showRegions={showRegions}
          onShowRegionsChange={setShowRegions}
          showHistory={showHistory}
          onShowHistoryChange={setShowHistory}
          showUnrelated={showUnrelated}
          onShowUnrelatedChange={setShowUnrelated}
          onClose={() => setActiveAttachmentId(null)}
          layers={
            <LayersPanel
              components={layersComponents}
              selectedId={selectedId}
              activeParentId={canvas.activeParentId}
              showUnrelated={showUnrelated}
              onSelect={handleSelectRow}
              onConfirmField={roleMutations.confirmField}
              onDenyField={roleMutations.denyField}
            />
          }
          inspector={
            <InspectorPanel
              selected={inspectorSelected}
              parentOptions={parentOptions}
              entityTypeLabel={inspectorEntityTypeLabel}
              autofillPhase={inspectorAutofillPhase}
              onSetRole={roleMutations.setRole}
              onSetEntityTypeSlug={handleSetEntityTypeSlug}
              onSetFieldRelationship={roleMutations.setFieldRelationship}
              onAutofillFields={autofill.autofillFields}
              onConfirmAllFields={autofill.confirmAllFields}
              onConfirmField={roleMutations.confirmField}
            />
          }
          summary={
            <ExtractionSummaryPanel
              components={layersComponents}
              onConfirmEntity={roleMutations.confirmField}
            />
          }
          banner={
            canvas.activeParentId !== null ? (
              <ActiveParentBanner
                label={activeParentLabel}
                onClear={() => {
                  canvas.clearActiveParent();
                  canvas.clearSelection();
                }}
              />
            ) : undefined
          }
          canvas={canvasZone}
        />
      </div>
    </Root>
  );
}
