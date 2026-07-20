/**
 * panel-nodes.test.tsx — the v2.0 canvas panels (directory / browser /
 * editor): standalone schemas (panel-node-schemas.ts), pure intent/label
 * helpers, and the three components' rendered contracts.
 *
 * DELIBERATELY STANDALONE: the canvas REGISTRY files (node-type-registry.ts /
 * canvas-vocabulary.ts / node-types.ts / node-data-schemas.ts) are owned by
 * another wave RIGHT NOW, so — unlike source-node.test.tsx — this file
 * imports NONE of them. Registry/vocabulary/dimensions agreement gets its
 * own assertions in the sibling suites once the orchestrator registers the
 * three types (see the slice's seams). What this file CAN pin without the
 * registry, it does: the staged geometry literals, the capability id
 * strings the daemon allowlist keys on, the http(s) jail, and law 2's
 * serif/data-evidence pairing.
 *
 * Component tests mount the REAL components (createRoot-in-jsdom + `act`,
 * mirrors source-node.test.tsx). None of the three panels imports
 * `~/trpc/react` — they fetch nothing by design — so no trpc mock is needed.
 * `@xyflow/react`'s `useReactFlow` is mocked via a PARTIAL factory.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import {
  BrowserNodeDataSchema,
  DirectoryEntrySchema,
  DirectoryNodeDataSchema,
  EditorNodeDataSchema,
  isHttpPanelUrl,
  PANEL_NODE_KIND_GEOMETRY,
  PANEL_NODE_KIND_LABEL,
} from "../panel-node-schemas";

const mockDeleteElements = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ deleteElements: mockDeleteElements }),
  };
});

import {
  clampDirectoryEntries,
  DIRECTORY_PANEL_CAPABILITY_IDS,
  DirectoryNode,
  resolveDirectoryLabel,
  type DirectoryNodeType,
} from "../directory-node";
import {
  BROWSER_PANEL_CAPABILITY_IDS,
  BrowserNode,
  browserNavigateIntent,
  safeBrowserUrl,
  type BrowserNodeType,
} from "../browser-node";
import {
  EDITOR_PANEL_CAPABILITY_IDS,
  EditorNode,
  editorSaveIntent,
  resolveEditorLabel,
  type EditorNodeType,
} from "../editor-node";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe("DirectoryNodeDataSchema", () => {
  const valid = {
    path: "/home/user/projects/polytoken",
    label: "polytoken",
    entries: [
      { name: "src", kind: "dir", depth: 0 },
      { name: "index.ts", kind: "file", depth: 1 },
    ],
  };

  it("accepts a full valid payload", () => {
    expect(DirectoryNodeDataSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts path-only (label and entries optional)", () => {
    expect(DirectoryNodeDataSchema.safeParse({ path: "/tmp/x" }).success).toBe(true);
  });

  it("rejects an empty path and a path over the daemon's 4096 cap", () => {
    expect(DirectoryNodeDataSchema.safeParse({ path: "" }).success).toBe(false);
    expect(
      DirectoryNodeDataSchema.safeParse({ path: "/" + "a".repeat(4096) }).success,
    ).toBe(false);
  });

  it("rejects more than 50 preview entries (a PREVIEW, not the filesystem)", () => {
    const entries = Array.from({ length: 51 }, (_, i) => ({
      name: `f${i}`,
      kind: "file",
      depth: 0,
    }));
    expect(DirectoryNodeDataSchema.safeParse({ path: "/tmp/x", entries }).success).toBe(
      false,
    );
  });

  it("rejects an entry with depth over 6, an unknown kind, or extra keys (.strict())", () => {
    expect(
      DirectoryEntrySchema.safeParse({ name: "a", kind: "file", depth: 7 }).success,
    ).toBe(false);
    expect(
      DirectoryEntrySchema.safeParse({ name: "a", kind: "symlink", depth: 0 }).success,
    ).toBe(false);
    expect(
      DirectoryEntrySchema.safeParse({ name: "a", kind: "file", depth: 0, x: 1 }).success,
    ).toBe(false);
  });

  it("rejects an unrecognized extra top-level key (.strict())", () => {
    expect(
      DirectoryNodeDataSchema.safeParse({ path: "/tmp/x", extra: true }).success,
    ).toBe(false);
  });
});

describe("BrowserNodeDataSchema", () => {
  it("accepts http(s) urls and an absent url (panel before first navigate)", () => {
    expect(BrowserNodeDataSchema.safeParse({ url: "https://example.com" }).success).toBe(
      true,
    );
    expect(BrowserNodeDataSchema.safeParse({ url: "http://example.com" }).success).toBe(
      true,
    );
    expect(BrowserNodeDataSchema.safeParse({}).success).toBe(true);
  });

  it("rejects javascript:/data:/file:/relative urls — the XSS door stays shut", () => {
    // eslint-disable-next-line no-script-url
    expect(BrowserNodeDataSchema.safeParse({ url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(BrowserNodeDataSchema.safeParse({ url: "data:text/html,x" }).success).toBe(
      false,
    );
    expect(BrowserNodeDataSchema.safeParse({ url: "file:///etc/passwd" }).success).toBe(
      false,
    );
    expect(BrowserNodeDataSchema.safeParse({ url: "/relative" }).success).toBe(false);
  });

  it("rejects an unrecognized extra top-level key (.strict())", () => {
    expect(
      BrowserNodeDataSchema.safeParse({ url: "https://example.com", spec: {} }).success,
    ).toBe(false);
  });
});

describe("EditorNodeDataSchema", () => {
  it("accepts filePath-only and full payloads — but NEVER content (ref-only)", () => {
    expect(EditorNodeDataSchema.safeParse({ filePath: "/tmp/a.ts" }).success).toBe(true);
    expect(
      EditorNodeDataSchema.safeParse({
        filePath: "/tmp/a.ts",
        label: "a.ts",
        language: "ts",
      }).success,
    ).toBe(true);
    // The one key this schema exists to refuse: file content in a layout row.
    expect(
      EditorNodeDataSchema.safeParse({ filePath: "/tmp/a.ts", content: "x" }).success,
    ).toBe(false);
  });

  it("rejects an empty filePath", () => {
    expect(EditorNodeDataSchema.safeParse({ filePath: "" }).success).toBe(false);
  });
});

describe("isHttpPanelUrl — agrees with the sibling gate on hostile inputs", () => {
  it("accepts absolute http(s) and nothing else", () => {
    expect(isHttpPanelUrl("https://example.com/a")).toBe(true);
    expect(isHttpPanelUrl("http://example.com/a")).toBe(true);
    // eslint-disable-next-line no-script-url
    expect(isHttpPanelUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpPanelUrl("data:text/html,x")).toBe(false);
    expect(isHttpPanelUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpPanelUrl("/relative")).toBe(false);
    expect(isHttpPanelUrl("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Staged vocabulary — pinned so the orchestrator's promotion is a byte copy
// ---------------------------------------------------------------------------

describe("PANEL_NODE_KIND_GEOMETRY (staging for the fenced vocabulary)", () => {
  it("pins the exact literals the seams instruct the orchestrator to register", () => {
    expect(PANEL_NODE_KIND_GEOMETRY).toEqual({
      directory: "border-l-2 border-l-ink",
      browser: "border-l border-l-ink border-dotted",
      editor: "border-l-2 border-l-ink border-double",
    });
  });

  it("no kind claims DASHED (tier owns solid-vs-dashed) and no kind claims a hue", () => {
    for (const cls of Object.values(PANEL_NODE_KIND_GEOMETRY)) {
      expect(cls).not.toContain("dashed");
      // Kind is shape, never hue (law 3): only ink may appear.
      expect(cls).not.toMatch(/border-l-(?!ink)[a-z]+(?:-\d+)?(?:\s|$)/);
    }
  });

  it("labels exist for every staged kind, and they are chrome words (short, sans-destined)", () => {
    expect(Object.keys(PANEL_NODE_KIND_LABEL).sort()).toEqual(
      Object.keys(PANEL_NODE_KIND_GEOMETRY).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Capability id strings — the ONLY daemon coupling these panels have (INV-2)
// ---------------------------------------------------------------------------

describe("capability id strings", () => {
  it("browser panel names the daemon's six browser.* ids exactly", () => {
    expect(BROWSER_PANEL_CAPABILITY_IDS).toEqual({
      open: "browser.open",
      navigate: "browser.navigate",
      screenshot: "browser.screenshot",
      click: "browser.click",
      type: "browser.type",
      close: "browser.close",
    });
  });

  it("directory and editor panels name the fs ids exactly", () => {
    expect(DIRECTORY_PANEL_CAPABILITY_IDS).toEqual({ list: "fs.list", read: "fs.read" });
    expect(EDITOR_PANEL_CAPABILITY_IDS).toEqual({ read: "fs.read", write: "fs.write" });
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("browserNavigateIntent", () => {
  it("normalizes a bare domain to https and emits a browser.navigate intent", () => {
    expect(browserNavigateIntent("example.com")).toEqual({
      capabilityId: "browser.navigate",
      input: { url: "https://example.com" },
    });
  });

  it("keeps an explicit http(s) url verbatim", () => {
    expect(browserNavigateIntent("http://example.com/a")?.input).toEqual({
      url: "http://example.com/a",
    });
  });

  it("refuses javascript:, file:, and empty input — returns null, never a forwardable intent", () => {
    // eslint-disable-next-line no-script-url
    expect(browserNavigateIntent("javascript:alert(1)")).toBeNull();
    expect(browserNavigateIntent("file:///etc/passwd")).toBeNull();
    expect(browserNavigateIntent("   ")).toBeNull();
  });

  it("intent input matches the daemon navigateInput shape ({ url } only)", () => {
    const intent = browserNavigateIntent("https://example.com");
    expect(Object.keys(intent!.input)).toEqual(["url"]);
  });
});

describe("editorSaveIntent", () => {
  it("emits an fs.write intent matching the daemon fsWriteInput shape ({ path, content })", () => {
    expect(editorSaveIntent("/tmp/a.ts", "let x = 1;")).toEqual({
      capabilityId: "fs.write",
      input: { path: "/tmp/a.ts", content: "let x = 1;" },
    });
  });
});

describe("label resolution", () => {
  it("resolveDirectoryLabel: explicit label -> last path segment -> fallback", () => {
    expect(resolveDirectoryLabel("My folder", "/a/b")).toBe("My folder");
    expect(resolveDirectoryLabel(undefined, "/home/user/projects/")).toBe("projects");
    expect(resolveDirectoryLabel(undefined, "///")).toBe("Watched folder");
  });

  it("resolveEditorLabel: explicit label -> last path segment -> fallback", () => {
    expect(resolveEditorLabel("Draft", "/a/b.ts")).toBe("Draft");
    expect(resolveEditorLabel(undefined, "/src/index.ts")).toBe("index.ts");
    expect(resolveEditorLabel(undefined, "//")).toBe("Untitled file");
  });
});

describe("clampDirectoryEntries — render-time bounds (defense in depth)", () => {
  it("caps a tampered row at 50 entries and depth 0..6", () => {
    const flood = Array.from({ length: 80 }, (_, i) => ({
      name: `f${i}`,
      kind: "file" as const,
      depth: 99,
    }));
    const clamped = clampDirectoryEntries(flood);
    expect(clamped).toHaveLength(50);
    expect(clamped.every((e) => e.depth === 6)).toBe(true);
    expect(clampDirectoryEntries(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

function baseNodeProps(id: string, type: string): Record<string, unknown> {
  return {
    id,
    type,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

beforeEach(() => {
  mockDeleteElements.mockReset();
});

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
});

/** Set a controlled input/textarea's value the way a user would. */
async function typeInto(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const proto =
    el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// ── DirectoryNode ───────────────────────────────────────────────────────────

const DIR_DATA = {
  path: "/home/user/projects/polytoken",
  entries: [
    { name: "src", kind: "dir" as const, depth: 0 },
    { name: "capability.ts", kind: "file" as const, depth: 1 },
  ],
};

async function mountDirectory(
  data: Record<string, unknown> = DIR_DATA,
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <DirectoryNode
        {...({
          ...baseNodeProps("directory:1", "directory"),
          data,
        } as unknown as NodeProps<DirectoryNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

describe("DirectoryNode — rendered contract", () => {
  it("wears the staged directory geometry with zero shadow", async () => {
    const container = await mountDirectory();
    const root = container.firstElementChild as HTMLElement;
    for (const cls of PANEL_NODE_KIND_GEOMETRY.directory.split(/\s+/)) {
      expect(root.className, `missing geometry class "${cls}"`).toContain(cls);
    }
    expect(root.className).not.toMatch(/\bshadow-elevation-/);
  });

  it("header label is the folder name, SERIF + data-evidence on the span (law 2)", async () => {
    const container = await mountDirectory();
    // Match the LEAF span (the outer icon+label wrapper shares the same
    // textContent) — the serif/evidence pair must sit on the span itself,
    // never a container (inheritance is invisible to className gates).
    const header = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "polytoken" && el.childElementCount === 0,
    );
    expect(header, "the resolved folder name did not render").toBeDefined();
    expect(header!.className).toContain("font-serif");
    expect(header!.hasAttribute("data-evidence")).toBe(true);
  });

  it("entry NAMES are serif evidence; the path caption is sans chrome", async () => {
    const container = await mountDirectory();
    const entry = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "capability.ts",
    );
    expect(entry, "the file entry did not render").toBeDefined();
    expect(entry!.className).toContain("font-serif");
    expect(entry!.hasAttribute("data-evidence")).toBe(true);

    const path = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === DIR_DATA.path,
    );
    expect(path, "the path caption did not render").toBeDefined();
    expect(path!.className).not.toContain("font-serif");
    expect(path!.hasAttribute("data-evidence")).toBe(false);
  });

  it("renders the teaching empty state when no preview entries exist", async () => {
    const container = await mountDirectory({ path: "/tmp/empty" });
    expect(container.textContent).toContain("No preview captured yet");
  });

  it("the attach-chat affordance renders as an HONEST disabled stub", async () => {
    const container = await mountDirectory();
    const attach = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes("Attach chat"),
    );
    expect(attach, "the attach-chat stub did not render").toBeDefined();
    expect(attach!.disabled).toBe(true);
    expect(attach!.getAttribute("aria-disabled")).toBe("true");
  });

  it("Remove drops only the placement via deleteElements (T-61-19)", async () => {
    const container = await mountDirectory();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove folder",
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.click();
    });
    expect(mockDeleteElements).toHaveBeenCalledWith({ nodes: [{ id: "directory:1" }] });
  });
});

// ── BrowserNode ─────────────────────────────────────────────────────────────

async function mountBrowser(
  data: Record<string, unknown> = { url: "https://example.com/docs" },
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <BrowserNode
        {...({
          ...baseNodeProps("browser:1", "browser"),
          data,
        } as unknown as NodeProps<BrowserNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

function submitUrlBar(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form")!;
  return act(async () => {
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
    } else {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
  });
}

describe("BrowserNode — rendered contract", () => {
  it("wears the staged browser geometry with zero shadow", async () => {
    const container = await mountBrowser();
    const root = container.firstElementChild as HTMLElement;
    for (const cls of PANEL_NODE_KIND_GEOMETRY.browser.split(/\s+/)) {
      expect(root.className, `missing geometry class "${cls}"`).toContain(cls);
    }
    expect(root.className).not.toMatch(/\bshadow-elevation-/);
  });

  it("THE JAIL: mounts NO iframe and NO remote src, ever — even with a persisted url", async () => {
    const container = await mountBrowser();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a[href^='http']")).toBeNull();
  });

  it("the url bar shows the persisted url; a tampered javascript: url degrades to empty (T-61-04)", async () => {
    const ok = await mountBrowser();
    const input = ok.querySelector<HTMLInputElement>("input[aria-label='Address']");
    expect(input!.value).toBe("https://example.com/docs");

    const tampered = await mountBrowser({
      // eslint-disable-next-line no-script-url
      url: "javascript:alert(1)",
    });
    const badInput = tampered.querySelector<HTMLInputElement>(
      "input[aria-label='Address']",
    );
    expect(badInput!.value).toBe("");
    expect(tampered.textContent).toContain("No page open");
    expect(safeBrowserUrl("javascript:alert(1)")).toBeNull(); // eslint-disable-line no-script-url
  });

  it("submitting a valid url parks a browser.navigate intent and says so", async () => {
    const container = await mountBrowser({});
    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='Address']",
    )!;
    await typeInto(input, "example.org");
    await submitUrlBar(container);
    expect(container.textContent).toContain("browser.navigate");
    expect(container.textContent).toContain("https://example.org");
    // Still no iframe after "navigation" — the view is a screenshot stream.
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("submitting a non-http(s) url renders the refusal, never a forwardable intent", async () => {
    const container = await mountBrowser({});
    const input = container.querySelector<HTMLInputElement>(
      "input[aria-label='Address']",
    )!;
    // eslint-disable-next-line no-script-url
    await typeInto(input, "javascript:alert(1)");
    await submitUrlBar(container);
    expect(container.textContent).toContain("Only http(s) addresses");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("the placeholder states the screenshot-stream design and names browser.screenshot", async () => {
    const container = await mountBrowser({});
    expect(container.textContent).toContain("screenshots from the daemon");
    expect(container.textContent).toContain("browser.screenshot");
  });

  it("Remove drops only the placement — never a side-effect browser.close", async () => {
    const container = await mountBrowser();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove browser panel",
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.click();
    });
    expect(mockDeleteElements).toHaveBeenCalledWith({ nodes: [{ id: "browser:1" }] });
  });
});

// ── EditorNode ──────────────────────────────────────────────────────────────

async function mountEditor(
  data: Record<string, unknown> = { filePath: "/src/index.ts", language: "ts" },
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <EditorNode
        {...({
          ...baseNodeProps("editor:1", "editor"),
          data,
        } as unknown as NodeProps<EditorNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

describe("EditorNode — rendered contract", () => {
  it("wears the staged editor geometry with zero shadow", async () => {
    const container = await mountEditor();
    const root = container.firstElementChild as HTMLElement;
    for (const cls of PANEL_NODE_KIND_GEOMETRY.editor.split(/\s+/)) {
      expect(root.className, `missing geometry class "${cls}"`).toContain(cls);
    }
    expect(root.className).not.toMatch(/\bshadow-elevation-/);
  });

  it("THE JAIL: a plain textarea — no iframe, no Monaco mount, nothing executable", async () => {
    const container = await mountEditor();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();
  });

  it("filename is serif evidence in the header; the language tag is sans chrome", async () => {
    const container = await mountEditor();
    const name = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "index.ts",
    );
    expect(name, "the resolved filename did not render").toBeDefined();
    expect(name!.className).toContain("font-serif");
    expect(name!.hasAttribute("data-evidence")).toBe(true);

    const lang = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent === "ts",
    );
    expect(lang, "the language tag did not render").toBeDefined();
    expect(lang!.className).not.toContain("font-serif");
  });

  it("the draft textarea carries the serif + data-evidence pair (the user's own words)", async () => {
    const container = await mountEditor();
    const textarea = container.querySelector("textarea")!;
    expect(textarea.className).toContain("font-serif");
    expect(textarea.hasAttribute("data-evidence")).toBe(true);
    // ...and it opts out of canvas gestures so typing never drags the node.
    expect(textarea.className).toContain("nodrag");
  });

  it("Save is disabled until the draft is dirty, then parks an fs.write intent and says so", async () => {
    const container = await mountEditor();
    const save = Array.from(container.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save",
    )!;
    expect(save.disabled).toBe(true);

    await typeInto(container.querySelector("textarea")!, "let x = 1;");
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.click();
    });
    expect(container.textContent).toContain("fs.write");
  });

  it("draft content NEVER lands in node.data (ref-only law) — data stays exactly what was passed", async () => {
    const data = { filePath: "/src/index.ts" };
    const container = await mountEditor(data);
    await typeInto(container.querySelector("textarea")!, "secret draft");
    expect(data).toEqual({ filePath: "/src/index.ts" });
  });

  it("Remove drops only the placement; the file on disk survives (T-61-19)", async () => {
    const container = await mountEditor();
    const remove = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Remove editor",
    );
    expect(remove).toBeDefined();
    await act(async () => {
      remove!.click();
    });
    expect(mockDeleteElements).toHaveBeenCalledWith({ nodes: [{ id: "editor:1" }] });
  });
});
