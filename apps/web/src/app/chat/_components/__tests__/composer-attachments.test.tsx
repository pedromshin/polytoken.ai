/**
 * composer-attachments.test.tsx — the CH-01 attach flow, jsdom/behaviour only
 * (no visual claim; geometry is the screenshot/geometry gates' job).
 *
 * Covers:
 *   1. asVaultFileRef — the untrusted-sourceRef narrowing.
 *   2. attach-by-upload — mints a signed URL through files.requestUpload with
 *      ONLY tenant-relative segments (no userId/key/bucket — the files/index.ts
 *      input rule), PUTs the bytes, then records a vault_file context edge.
 *   3. the chip rail — reads straight off listContextEdges; removing a chip
 *      calls removeContextEdge with the edge id.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- captured mutation options + spies -------------------------------------

interface MutationOptions {
  onMutate?: (vars: Record<string, unknown>) => unknown;
  onError?: (err: unknown, vars: unknown, ctx: unknown) => void;
  onSuccess?: (result: unknown, vars: unknown, ctx: unknown) => void;
  onSettled?: (data: unknown, err: unknown, vars: Record<string, unknown>) => void;
}

const CONVERSATION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const createEdgeMutate = vi.fn();
const removeEdgeMutate = vi.fn();
const requestUploadMutateAsync = vi.fn(async (_input?: unknown) => ({
  url: "https://storage.example/signed-put",
}));

let listContextEdgesData: ReadonlyArray<{ id: string; sourceRef: unknown }> = [];
let vaultListData: { entries: ReadonlyArray<{ name: string; isFolder: boolean }> } = {
  entries: [],
};

const utilsListContextEdges = {
  cancel: vi.fn(async () => undefined),
  getData: vi.fn(() => undefined as unknown),
  setData: vi.fn(),
  invalidate: vi.fn(async () => undefined),
};
const utilsGetCanvasLayout = {
  cancel: vi.fn(async () => undefined),
  getData: vi.fn(() => null as unknown),
  setData: vi.fn(),
  invalidate: vi.fn(async () => undefined),
};

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      chat: {
        listContextEdges: utilsListContextEdges,
        getCanvasLayout: utilsGetCanvasLayout,
      },
    }),
    chat: {
      listConversations: {
        useQuery: () => ({ data: [{ id: CONVERSATION_ID, title: "c", modelId: "m", updatedAt: "" }] }),
      },
      createContextEdge: {
        useMutation: (_options: MutationOptions) => ({ mutate: createEdgeMutate, isPending: false }),
      },
      addCanvasNode: {
        useMutation: (_options: MutationOptions) => ({ mutate: vi.fn(), isPending: false }),
      },
      listContextEdges: {
        useQuery: () => ({ data: listContextEdgesData }),
      },
      removeContextEdge: {
        useMutation: (_options: MutationOptions) => ({ mutate: removeEdgeMutate }),
      },
    },
    files: {
      requestUpload: {
        useMutation: () => ({ mutateAsync: requestUploadMutateAsync }),
      },
      list: {
        useQuery: () => ({ data: vaultListData, isPending: false, isError: false }),
      },
    },
  },
}));

import { asVaultFileRef, ComposerAttachments } from "../composer-attachments";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- mount helpers ----------------------------------------------------------

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

beforeEach(() => {
  createEdgeMutate.mockClear();
  removeEdgeMutate.mockClear();
  requestUploadMutateAsync.mockClear();
  listContextEdgesData = [];
  vaultListData = { entries: [] };
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  for (const c of containers) c.remove();
  roots = [];
  containers = [];
});

// --- 1. the pure narrowing --------------------------------------------------

describe("asVaultFileRef — untrusted sourceRef narrowing", () => {
  it("accepts a well-formed vault_file ref", () => {
    expect(asVaultFileRef({ type: "vault_file", path: ["a", "b"], name: "x.pdf" })).toEqual({
      type: "vault_file",
      path: ["a", "b"],
      name: "x.pdf",
    });
  });

  it("defaults a missing/malformed path to []", () => {
    expect(asVaultFileRef({ type: "vault_file", name: "x.pdf" })).toEqual({
      type: "vault_file",
      path: [],
      name: "x.pdf",
    });
    expect(asVaultFileRef({ type: "vault_file", path: [1, 2], name: "x.pdf" })).toEqual({
      type: "vault_file",
      path: [],
      name: "x.pdf",
    });
  });

  it("rejects other sourceRef types and junk", () => {
    expect(asVaultFileRef({ type: "email_thread", threadId: "t" })).toBeNull();
    expect(asVaultFileRef({ type: "vault_file", path: [], name: "" })).toBeNull();
    expect(asVaultFileRef(null)).toBeNull();
    expect(asVaultFileRef("nope")).toBeNull();
  });
});

// --- 2. attach-by-upload ----------------------------------------------------

describe("attach-by-upload", () => {
  it("mints a signed URL with ONLY tenant-relative segments, PUTs, then records a vault_file context edge", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount(<ComposerAttachments conversationId={CONVERSATION_ID} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const file = new File(["hello"], "report.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      // let the async upload handler settle
      await Promise.resolve();
      await Promise.resolve();
    });

    // requestUpload got path/name/size/contentType — and CRUCIALLY no userId,
    // key, bucket or prefix (the whole files/index.ts tenancy argument).
    expect(requestUploadMutateAsync).toHaveBeenCalledTimes(1);
    const uploadArg = requestUploadMutateAsync.mock.calls[0]![0] as Record<string, unknown>;
    expect(uploadArg).toEqual({
      path: [],
      name: "report.pdf",
      size: file.size,
      contentType: "application/pdf",
    });
    for (const forbidden of ["userId", "key", "bucket", "prefix"]) {
      expect(uploadArg).not.toHaveProperty(forbidden);
    }

    // the bytes were PUT to the signed URL
    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.example/signed-put",
      expect.objectContaining({ method: "PUT" }),
    );

    // and the file was recorded as a vault_file context edge on THIS conversation
    expect(createEdgeMutate).toHaveBeenCalledTimes(1);
    expect(createEdgeMutate).toHaveBeenCalledWith({
      targetConversationId: CONVERSATION_ID,
      sourceRef: { type: "vault_file", path: [], name: "report.pdf" },
    });

    vi.unstubAllGlobals();
  });

  it("does not attach when the upload PUT fails", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const container = await mount(<ComposerAttachments conversationId={CONVERSATION_ID} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "bad.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestUploadMutateAsync).toHaveBeenCalledTimes(1);
    expect(createEdgeMutate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// --- 3. the chip rail -------------------------------------------------------

describe("attached-files chip rail", () => {
  it("renders one chip per vault_file edge and removing it calls removeContextEdge", async () => {
    listContextEdgesData = [
      { id: "edge-1", sourceRef: { type: "vault_file", path: ["docs"], name: "spec.pdf" } },
      // a non-vault edge is ignored — the rail is vault-files only
      { id: "edge-2", sourceRef: { type: "email_thread", threadId: "t" } },
    ];

    const container = await mount(<ComposerAttachments conversationId={CONVERSATION_ID} />);
    const rail = container.querySelector('ul[aria-label="Attached files"]');
    expect(rail).not.toBeNull();
    expect(rail!.querySelectorAll("li")).toHaveLength(1);
    expect(rail!.textContent).toContain("spec.pdf");

    const removeBtn = rail!.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(removeEdgeMutate).toHaveBeenCalledWith({ edgeId: "edge-1" });
  });

  it("renders no rail when there are no attachments", async () => {
    listContextEdgesData = [];
    const container = await mount(<ComposerAttachments conversationId={CONVERSATION_ID} />);
    expect(container.querySelector('ul[aria-label="Attached files"]')).toBeNull();
  });
});
