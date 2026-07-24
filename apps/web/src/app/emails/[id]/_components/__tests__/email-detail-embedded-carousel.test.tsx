/**
 * email-detail-embedded-carousel.test.tsx — Task 3 wiring gate.
 *
 * Proves the attachment carousel is actually WIRED into the reachable inbox
 * surface: `EmailDetail` in `embedded` mode (the `/?email=<id>` inline preview,
 * rendered by inbox-email-preview → InboxThreePane) renders the swipeable
 * `PreviewCarousel` — a body slide plus one slide per attachment, with mixed
 * formats (PDF + image) coexisting — and does NOT mount the heavy four-zone
 * editor (`CanvasShell`) or eagerly open a PDF (`PdfPreviewPane`) on selection.
 *
 * jsdom does NO layout, so scroll-snap / momentum / IntersectionObserver are
 * invisible here (the geometry gate owns those). What IS honestly assertable
 * and covered: the carousel is the embedded surface (not the editor), the
 * slide set is derived from the email's attachments (body + PDF + image), the
 * lazy-mount window holds, and the non-embedded editor path is unchanged.
 *
 * The react-pdf-bearing AttachmentPageView is mocked (as in
 * components/email-preview/__tests__/preview-carousel.test.tsx) so pdfjs never
 * loads in jsdom; CanvasShell / PdfPreviewPane are stubbed so importing
 * EmailDetail never drags react-pdf in through the static editor chain, and so
 * their presence/absence is a clean signal of which branch rendered.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EMAIL_ID = "eeeeeeee-0000-0000-0000-000000000001";
const PDF_ATT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const IMG_ATT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const REGION_ID = "cccccccc-0000-0000-0000-000000000003";

const DETAIL = {
  email: {
    id: EMAIL_ID,
    subject: "Invoice + photo",
    bodyText: "The plain-text body.",
    bodyHtml: null,
    parseStatus: "parsed",
    parseError: null,
  },
  attachments: [
    { id: PDF_ATT_ID, filename: "invoice.pdf", contentType: "application/pdf" },
    { id: IMG_ATT_ID, filename: "photo.png", contentType: "image/png" },
  ],
  components: [
    {
      id: REGION_ID,
      attachmentId: PDF_ATT_ID,
      sourceType: "region",
      contentText: null,
      extractionStatus: "candidate",
      location: { page_index: 0, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]] },
      entityTypeLabel: "Invoice",
      entityTypeSlug: "invoice",
      extractedFields: null,
      confidenceScore: null,
      role: "entity",
      parentComponentId: null,
    },
  ],
};

// ---- Editor internals stubbed: importing EmailDetail must not drag react-pdf
//      in through the static editor chain, and a rendered stub is a clean
//      "the editor branch ran" signal. ----
vi.mock("../canvas-shell", () => ({
  CanvasShell: () => <div data-testid="canvas-shell" />,
}));
vi.mock("../pdf-preview-pane", () => ({
  PdfPreviewPane: () => <div data-testid="pdf-preview-pane" />,
}));

// The react-pdf-bearing slide view — mocked so pdfjs never loads (intercepts
// the next/dynamic import inside PreviewCarousel too).
vi.mock("~/components/email-preview/attachment-page-view", () => ({
  AttachmentPageView: (props: {
    attachmentId: string;
    pageNumber: number;
    contentType: string | null;
  }) => (
    <div
      data-testid="attachment-view"
      data-attachment-id={props.attachmentId}
      data-page={props.pageNumber}
      data-content-type={props.contentType ?? ""}
    />
  ),
}));

// Signed-URL hook — inert; the embedded path must never request one.
const signedUrlSpy = vi.fn((_id: string | null): string | null => null);
vi.mock("~/hooks/use-signed-attachment-url", () => ({
  useSignedAttachmentUrl: (id: string | null) => signedUrlSpy(id),
}));

// Editor state/mutation hooks — inert shells. In embedded mode EmailDetail
// returns the carousel BEFORE reading any of their fields, so bare stubs are
// enough there; the fuller shapes let the non-embedded editor path also render.
vi.mock("../use-canvas-state", () => ({
  useCanvasState: () => ({
    selectedIds: [],
    mutatingIds: [],
    activeParentId: null,
    mode: "select",
    select: vi.fn(),
    shiftToggle: vi.fn(),
    clearSelection: vi.fn(),
    setActiveParentId: vi.fn(),
    clearActiveParent: vi.fn(),
    edit: {
      drawMode: null,
      liveRect: null,
      setLiveRect: vi.fn(),
      drawnRects: [],
      redraw: vi.fn(),
      pushRect: vi.fn(),
      createRegion: vi.fn(),
      cancelDraw: vi.fn(),
      enterDraw: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
      split: vi.fn(),
      classifyDocument: vi.fn(),
      merge: vi.fn(),
      nest: vi.fn(),
      rejectDialogOpen: false,
      setRejectDialogOpen: vi.fn(),
      nestPickerOpen: false,
      setNestPickerOpen: vi.fn(),
    },
  }),
}));
vi.mock("../use-role-mutations", () => ({
  useRoleMutations: () => ({
    confirmFields: vi.fn(),
    confirmField: vi.fn(),
    denyField: vi.fn(),
    setRole: vi.fn(),
    setEntityType: vi.fn(),
    setFieldRelationship: vi.fn(),
    mutatingComponentIds: [],
  }),
}));
vi.mock("../use-autofill-fields", () => ({
  useAutofillFields: () => ({
    phases: {},
    autofillFields: vi.fn(),
    confirmAllFields: vi.fn(),
  }),
}));

// tRPC surface. `emails.detail.useQuery` (called by BOTH EmailDetail and the
// carousel's useEmailPreview — same key, deduped) returns DETAIL. Every other
// endpoint is a mutation stub. `entityTypes.list` returns an empty list.
const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  reset: vi.fn(),
});
const invalidate = vi.fn().mockResolvedValue(undefined);
vi.mock("~/trpc/react", () => {
  const emails = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "detail") {
          return {
            useQuery: () => ({
              data: DETAIL,
              isLoading: false,
              isError: false,
            }),
          };
        }
        return { useMutation: () => mutationStub() };
      },
    },
  );
  return {
    api: {
      emails,
      entityTypes: {
        list: { useQuery: () => ({ data: [], isLoading: false, isError: false }) },
      },
      useUtils: () => ({
        emails: {
          detail: {
            invalidate,
            getData: vi.fn(() => undefined),
            setData: vi.fn(),
            prefetch: vi.fn().mockResolvedValue(undefined),
            cancel: vi.fn().mockResolvedValue(undefined),
          },
        },
      }),
    },
  };
});

import { EmailDetail } from "../email-detail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  signedUrlSpy.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(embedded: boolean): Promise<void> {
  await act(async () => {
    root.render(<EmailDetail emailId={EMAIL_ID} embedded={embedded} />);
  });
  // Flush the next/dynamic lazy import of the (mocked) attachment view.
  await act(async () => {
    await Promise.resolve();
  });
}

function slideEls(): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-slide-index]"),
  );
}

describe("EmailDetail embedded → attachment carousel wiring (Task 3)", () => {
  it("renders the swipeable carousel, NOT the four-zone editor, in embedded mode", async () => {
    await mount(true);

    // The carousel is the embedded attachment surface.
    expect(container.querySelector("[data-carousel]")).not.toBeNull();
    const track = container.querySelector<HTMLElement>("[data-carousel-track]");
    expect(track?.className).toContain("overflow-x-auto");
    expect(track?.className).toContain("snap-x");
    expect(track?.className).toContain("snap-mandatory");

    // The heavy editor did NOT mount.
    expect(container.querySelector('[data-testid="canvas-shell"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="pdf-preview-pane"]'),
    ).toBeNull();

    // The compact embedded header (reprocess action) is present.
    expect(
      container.querySelector('button[aria-label="Reprocess this email"]'),
    ).not.toBeNull();
  });

  it("derives one slide per attachment (body + PDF + image) — mixed formats coexist", async () => {
    await mount(true);

    const slides = slideEls();
    // body + invoice.pdf (1 page until onDocumentLoad) + photo.png
    expect(slides).toHaveLength(3);
    expect(slides[0]?.getAttribute("data-slide-kind")).toBe("body");
    expect(slides[0]?.textContent).toContain("The plain-text body.");
    expect(slides[1]?.getAttribute("data-slide-kind")).toBe("pdf-page");
    expect(slides[2]?.getAttribute("data-slide-kind")).toBe("image");

    // Each slide is a snap target inside the momentum-scroll track.
    for (const el of slides) {
      expect(el.className).toContain("snap-center");
      expect(el.className).toContain("shrink-0");
      expect(el.className).toContain("w-full");
    }
  });

  it("routes the PDF attachment through AttachmentPageView (shared OverlayLayer path)", async () => {
    await mount(true);

    const attView = container.querySelector<HTMLElement>(
      '[data-testid="attachment-view"]',
    );
    expect(attView).not.toBeNull();
    expect(attView?.getAttribute("data-attachment-id")).toBe(PDF_ATT_ID);
    expect(attView?.getAttribute("data-content-type")).toBe("application/pdf");
    expect(attView?.getAttribute("data-page")).toBe("1");
  });

  it("does NOT eagerly open a PDF (no signed-URL request) in embedded mode", async () => {
    await mount(true);

    // The auto-open-first-PDF effect is skipped when embedded, so EmailDetail's
    // own signed-URL hook is only ever called with a null (inactive) id.
    for (const call of signedUrlSpy.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("non-embedded mode still renders the editor (CanvasShell), not the carousel", async () => {
    await mount(false);

    expect(
      container.querySelector('[data-testid="canvas-shell"]'),
    ).not.toBeNull();
    expect(container.querySelector("[data-carousel]")).toBeNull();
  });
});
