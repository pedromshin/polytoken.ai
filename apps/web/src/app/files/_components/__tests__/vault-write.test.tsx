/**
 * vault-write.test.tsx — the user's directive, as tests (Phase 66 Plan 04
 * Task 3, D-66-10's budget — the WRITE half).
 *
 * Harness: jsdom + createRoot + `act` from "react" — this app's real
 * convention. `@testing-library/react` is not a dependency of this repo and is
 * not resolvable; see vault-states.test.tsx's header.
 *
 * The tRPC seam, `next/navigation`, `sonner`, and `XMLHttpRequest` are all
 * faked at the module boundary. Nothing here touches a network, a router, or a
 * bucket.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Typed on its INPUT so the "sends no key/userId" test can read the argument. */
const requestUploadMutateAsync = vi.fn(async (_input: Record<string, unknown>) => ({
  url: "https://fake.storage/upload/user-a/x?token=T",
  token: "T",
  key: "user-a/x",
}));
const createFolderMutate = vi.fn();
const removeMutate = vi.fn();
const requestDownloadMutate = vi.fn();
const invalidate = vi.fn();
const toastFn = vi.fn();

let listResult: {
  data?: unknown[];
  isPending: boolean;
  error: unknown;
  refetch: () => void;
} = { data: [], isPending: false, error: null, refetch: vi.fn() };

vi.mock("sonner", () => ({ toast: (...args: unknown[]) => toastFn(...args) }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("../../_lib/vault-api", () => ({
  vaultApi: {
    files: {
      list: { useQuery: () => listResult },
      requestUpload: {
        useMutation: () => ({ mutateAsync: requestUploadMutateAsync }),
      },
      requestDownload: { useMutation: () => ({ mutate: requestDownloadMutate }) },
      createFolder: { useMutation: () => ({ mutate: createFolderMutate }) },
      remove: { useMutation: () => ({ mutate: removeMutate }) },
    },
    useUtils: () => ({ files: { list: { invalidate } } }),
  },
  VaultApiProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { VaultSurface } from "../vault-surface";

// ── A fake XHR that records and can be driven ──────────────────────────────

class FakeXHR {
  static instances: FakeXHR[] = [];
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown = null;
  aborted = false;

  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  FakeXHR.instances = [];
  listResult = { data: [], isPending: false, error: null, refetch: vi.fn() };
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function mount() {
  act(() => root.render(<VaultSurface />));
}

/** A drag/drop event carrying whatever `types` we say it does. */
function dragEvent(type: string, opts: { types: string[]; files?: File[] }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: opts.types, files: opts.files ?? [] },
  });
  return event;
}

const pane = () => container.querySelector("[data-slot='vault-drop-pane']")!;
const fileOf = (name = "notes.txt", size = 1024) =>
  new File(["x".repeat(size)], name, { type: "text/plain" });

const byText = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );

// ---------------------------------------------------------------------------
// Upload = 0 clicks
// ---------------------------------------------------------------------------

describe("upload = ZERO clicks — drop anywhere on the pane", () => {
  it("dropping a file on the PANE requests an upload", async () => {
    mount();

    const file = fileOf();
    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [file] }));
    });

    // On the PANE — not a button, not a card. The whole surface is the target.
    expect(requestUploadMutateAsync).toHaveBeenCalledTimes(1);
    expect(requestUploadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ path: [], name: "notes.txt", size: file.size }),
    );
  });

  it("sends NO key and NO userId — the client never chooses where things land", async () => {
    mount();

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [fileOf()] }));
    });

    // T-66-13. The browser sends { path, name, size } and receives a URL; the
    // key is derived server-side from ctx.user.id.
    const arg = requestUploadMutateAsync.mock.calls[0]?.[0];
    // Asserted, not assumed: without this the four checks below would all pass
    // vacuously against `undefined` if the call never happened.
    expect(arg).toBeDefined();
    expect(arg).not.toHaveProperty("key");
    expect(arg).not.toHaveProperty("userId");
    expect(arg).not.toHaveProperty("bucket");
    expect(arg).not.toHaveProperty("prefix");
  });

  it("PUTs to the signed URL with the token already in it", async () => {
    mount();

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [fileOf()] }));
    });

    // Mirrors @supabase/storage-js's own uploadToSignedUrl (verified against
    // the installed source): PUT, token in the query string, x-upsert header,
    // FormData body. XHR rather than fetch, for onprogress + abort.
    const xhr = FakeXHR.instances[0];
    expect(xhr?.method).toBe("PUT");
    expect(xhr?.url).toContain("token=T");
    expect(xhr?.headers["x-upsert"]).toBe("false");
    expect(xhr?.body).toBeInstanceOf(FormData);
  });
});

describe("the drag-accept engages only for files", () => {
  it("a text drag does NOT raise the sheet", () => {
    mount();

    act(() => {
      pane().dispatchEvent(dragEvent("dragenter", { types: ["text/plain"] }));
    });

    // Dragging selected text across the vault must not make the sheet rise:
    // the accept state is a promise that dropping will do something.
    expect(pane().getAttribute("data-dragging")).toBe("false");
  });

  it("a file drag raises the sheet", () => {
    mount();

    act(() => {
      pane().dispatchEvent(dragEvent("dragenter", { types: ["Files"] }));
    });

    expect(pane().getAttribute("data-dragging")).toBe("true");
  });

  it("THE STROBE BUG: crossing onto a child does not drop the accept state", () => {
    mount();

    // dragenter (pane) -> dragenter (child row) -> dragleave (pane).
    // With a boolean instead of a counter, this sequence ends FALSE and the
    // sheet strobes as the user moves across the rows. This is the bug every
    // hand-rolled dropzone ships first.
    act(() => {
      pane().dispatchEvent(dragEvent("dragenter", { types: ["Files"] }));
      pane().dispatchEvent(dragEvent("dragenter", { types: ["Files"] }));
      pane().dispatchEvent(dragEvent("dragleave", { types: ["Files"] }));
    });

    expect(pane().getAttribute("data-dragging")).toBe("true");
  });

  it("the accept state clears once the drag really leaves", () => {
    mount();

    act(() => {
      pane().dispatchEvent(dragEvent("dragenter", { types: ["Files"] }));
      pane().dispatchEvent(dragEvent("dragleave", { types: ["Files"] }));
    });

    expect(pane().getAttribute("data-dragging")).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Upload = 1 click from the picker
// ---------------------------------------------------------------------------

describe("upload = ONE click from the picker", () => {
  it("'Upload files' reaches a file input with no dialog or menu in between", () => {
    mount();

    const input = container.querySelector<HTMLInputElement>(
      "[data-slot='vault-file-input']",
    );
    expect(input?.type).toBe("file");
    expect(input?.multiple).toBe(true);

    const clicked = vi.fn();
    input!.click = clicked;

    act(() => byText("Upload files")?.click());

    expect(clicked).toHaveBeenCalledTimes(1);
    // THE BUDGET: no intermediate modal, no card, no menu.
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(container.querySelector("[role='menu']")).toBeNull();
  });

  it("the picker shares the SAME ingest funnel as the drop", async () => {
    mount();

    const input = container.querySelector<HTMLInputElement>(
      "[data-slot='vault-file-input']",
    )!;
    Object.defineProperty(input, "files", { value: [fileOf("picked.txt")] });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // One funnel, two doors.
    expect(requestUploadMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: "picked.txt" }),
    );
  });
});

// ---------------------------------------------------------------------------
// New folder = 1 click + type + Enter, and NO modal
// ---------------------------------------------------------------------------

describe("new folder = ONE click + type + Enter — never a modal", () => {
  it("clicking 'New folder' focuses an inline input, with no dialog", () => {
    mount();

    act(() => byText("New folder")?.click());

    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='New folder name']",
    );
    expect(input).not.toBeNull();

    // The click and the typing are CONTINUOUS — no click in between.
    expect(document.activeElement).toBe(input);

    // Taste item 10: inline beats modal. Both roles checked — Radix's
    // AlertDialog uses `alertdialog`, a plain Dialog uses `dialog`.
    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[role='alertdialog']")).toBeNull();
  });

  it("Enter commits the folder", () => {
    mount();
    act(() => byText("New folder")?.click());

    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='New folder name']",
    )!;

    act(() => {
      // React tracks the value setter; set it the way React can observe.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "2026 invoices");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(createFolderMutate).toHaveBeenCalledWith({
      path: [],
      name: "2026 invoices",
    });
  });

  it("Escape cancels — no mutation, row gone", () => {
    mount();
    act(() => byText("New folder")?.click());

    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='New folder name']",
    )!;

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    expect(createFolderMutate).not.toHaveBeenCalled();
    expect(container.querySelector("input[aria-label='New folder name']")).toBeNull();
  });

  it("rejects a bad name with the SAME schema the server runs, and never in madder", () => {
    mount();
    act(() => byText("New folder")?.click());

    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='New folder name']",
    )!;

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "bad/name");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(createFolderMutate).not.toHaveBeenCalled();

    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("separator");
    // A validation message is a STATUS. Never madder (law 1).
    expect(alert?.getAttribute("class") ?? "").not.toMatch(/destructive|bad/);
  });
});

// ---------------------------------------------------------------------------
// Delete = the ONE modal
// ---------------------------------------------------------------------------

describe("delete = the one modal, and the one madder", () => {
  const entry = {
    name: "report.pdf",
    kind: "text" as const,
    isFolder: false,
    size: 10,
    updatedAt: null,
    contentType: "application/pdf",
  };

  beforeEach(() => {
    listResult = { data: [entry], isPending: false, error: null, refetch: vi.fn() };
  });

  it("opens exactly ONE alertdialog", () => {
    mount();

    act(() =>
      container.querySelector<HTMLButtonElement>("[data-slot='vault-row-delete']")?.click(),
    );

    // Radix portals the dialog to document.body — query the document, not the
    // container. A container-scoped query here would find nothing and pass a
    // "no modal" assertion by accident.
    const dialogs = document.querySelectorAll("[role='alertdialog']");
    expect(dialogs).toHaveLength(1);
    expect(document.body.textContent).toContain("Delete report.pdf?");
    expect(document.body.textContent).toContain("This can't be undone.");
  });

  it("its confirm button is madder — the ONE irreversible control", () => {
    mount();
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-slot='vault-row-delete']")?.click(),
    );

    const confirm = document.querySelector("[data-slot='delete-confirm']");
    expect(confirm?.getAttribute("class") ?? "").toMatch(/destructive/);
  });

  it("the trigger that OPENS it is ink, not madder — opening is cancellable", () => {
    mount();

    const trigger = container.querySelector("[data-slot='vault-row-delete']");
    expect(trigger?.getAttribute("class") ?? "").not.toMatch(/destructive|bad/);
  });

  it("Cancel calls no mutation", () => {
    mount();
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-slot='vault-row-delete']")?.click(),
    );

    const cancel = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Cancel"),
    );
    act(() => cancel?.click());

    expect(removeMutate).not.toHaveBeenCalled();
  });

  it("confirm removes with the right entry", () => {
    mount();
    act(() =>
      container.querySelector<HTMLButtonElement>("[data-slot='vault-row-delete']")?.click(),
    );

    act(() =>
      document.querySelector<HTMLButtonElement>("[data-slot='delete-confirm']")?.click(),
    );

    expect(removeMutate).toHaveBeenCalledWith({
      path: [],
      name: "report.pdf",
      isFolder: false,
    });
  });

  it("a FOLDER's copy names the recursive consequence", () => {
    listResult = {
      data: [{ ...entry, name: "docs", isFolder: true, kind: "folder" as const }],
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
    mount();

    act(() =>
      container.querySelector<HTMLButtonElement>("[data-slot='vault-row-delete']")?.click(),
    );

    // The recursive delete is the most destructive act in this phase; the copy
    // must not hide it behind the word "folder".
    expect(document.body.textContent).toContain("This folder and everything in it.");
  });
});

// ---------------------------------------------------------------------------
// The tray
// ---------------------------------------------------------------------------

describe("the upload tray", () => {
  it("cancel aborts the in-flight XHR and clears the row", async () => {
    mount();

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [fileOf()] }));
    });

    const cancel = container.querySelector<HTMLButtonElement>(
      "[data-slot='upload-cancel']",
    );
    expect(cancel).not.toBeNull();

    await act(async () => cancel!.click());

    expect(FakeXHR.instances[0]?.aborted).toBe(true);
    expect(container.querySelector("[data-slot='upload-tray-row']")).toBeNull();
  });

  it("AN UPLOAD FAILURE IS NOT MADDER — it is a status", async () => {
    mount();

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [fileOf()] }));
    });

    await act(async () => {
      const xhr = FakeXHR.instances[0]!;
      xhr.status = 500;
      xhr.onload?.();
    });

    const row = container.querySelector("[data-slot='upload-tray-row'][data-status='error']");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("role")).toBe("alert");
    expect(row?.textContent).toContain("Upload failed");

    // The mistake anyone would make at 2am. Gated on the whole subtree.
    const classes = Array.from(row!.querySelectorAll("*"))
      .map((n) => n.getAttribute("class") ?? "")
      .concat(row!.getAttribute("class") ?? "")
      .join(" ");
    expect(classes).not.toMatch(/destructive/);
    expect(classes).not.toMatch(/\bbg-bad\b|\btext-bad\b|\bborder-bad\b/);
  });

  it("an over-cap file never reaches the network, and says why", async () => {
    mount();

    const huge = new File(["x"], "huge.bin");
    Object.defineProperty(huge, "size", { value: 100 * 1024 * 1024 + 1 });
    Object.defineProperty(huge, "type", { value: "application/octet-stream" });

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [huge] }));
    });

    // A courtesy, not the control — the server enforces it regardless. The
    // point is the user is told BEFORE a 100MB transfer, not after one.
    expect(requestUploadMutateAsync).not.toHaveBeenCalled();
    expect(container.textContent).toContain("100 MB limit");
  });

  it("a dropped FOLDER is refused with an explanation, not silence", async () => {
    mount();

    // A dropped directory arrives with no real body. Without this branch,
    // dropping a folder does nothing at all and the vault looks broken.
    const dir = new File([], "my-folder", { type: "" });

    await act(async () => {
      pane().dispatchEvent(dragEvent("drop", { types: ["Files"], files: [dir] }));
    });

    expect(requestUploadMutateAsync).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledWith(
      "Folders can't be uploaded yet — drop files instead.",
    );
  });
});
