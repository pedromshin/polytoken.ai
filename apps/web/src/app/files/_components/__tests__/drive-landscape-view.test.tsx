/**
 * drive-landscape-view.test.tsx — DriveLandscapeView BEHAVIOR (TM-04), jsdom.
 *
 * jsdom does NO layout (CLAUDE.md): these assert BEHAVIOR only — that the view
 * builds a hierarchy from `fetchLevel`, mounts the shared CirclePack primitive,
 * routes a file-leaf activation to `onActivateLeaf` while withholding it for a
 * folder/overflow leaf, and shows the empty state for an empty vault. NO visual
 * or geometric claim is made here (that is the geometry/screenshot gate's job).
 *
 * Harness: jsdom + createRoot + `act` — this app's convention (vault-write.test
 * .tsx's header). react-query is driven through a real QueryClientProvider with
 * a FAKE fetchLevel, so nothing touches tRPC or a network.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DriveLandscapeView } from "../drive-landscape-view";
import type { FetchLevel, FolderRollup } from "../../_lib/drive-landscape";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

async function mount(ui: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(<QueryClientProvider client={makeClient()}>{ui}</QueryClientProvider>);
  });
}

/** Flush microtasks + a macrotask under act until `cond` holds (async queryFn). */
async function waitFor(cond: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !cond(); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const flatVault: FetchLevel = (path) => {
  if (path.length === 0) {
    return Promise.resolve<FolderRollup>({
      total: 300,
      children: [
        { name: "report.pdf", isFolder: false, size: 200 },
        { name: "notes.txt", isFolder: false, size: 100 },
      ],
    });
  }
  return Promise.resolve<FolderRollup>({ total: 0, children: [] });
};

describe("DriveLandscapeView (TM-04 behavior)", () => {
  it("builds a hierarchy from fetchLevel and mounts the shared CirclePack primitive", async () => {
    await mount(<DriveLandscapeView fetchLevel={flatVault} width={320} height={240} />);
    await waitFor(() => container.querySelector('[data-testid="circle-pack"]') !== null);
    expect(container.querySelector('[data-testid="circle-pack"]')).not.toBeNull();
    // The vault's file names reached the leaf/hover render path.
    expect(container.textContent).toContain("report.pdf");
  });

  it("activates onActivateLeaf for a FILE leaf, passing the vault ref", async () => {
    const onActivateLeaf = vi.fn();
    await mount(
      <DriveLandscapeView
        fetchLevel={flatVault}
        width={320}
        height={240}
        onActivateLeaf={onActivateLeaf}
      />,
    );
    await waitFor(() => container.querySelector('g[data-leaf="true"]') !== null);
    // Click a leaf circle (the primitive fires onLeafActivate on click).
    const leaf = container.querySelector('g[data-leaf="true"]');
    expect(leaf).not.toBeNull();
    await act(async () => {
      leaf!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onActivateLeaf).toHaveBeenCalledTimes(1);
    const arg = onActivateLeaf.mock.calls[0]![0] as { name: string; isFolder: boolean };
    expect(arg.isFolder).toBe(false);
    expect(["report.pdf", "notes.txt"]).toContain(arg.name);
  });

  it("does NOT activate onActivateLeaf for a folder aggregate leaf", async () => {
    // A vault of only folders, truncated to aggregate leaves by a tiny budget:
    const foldersOnly: FetchLevel = (path) =>
      path.length === 0
        ? Promise.resolve<FolderRollup>({
            total: 50,
            children: [{ name: "archive", isFolder: true, size: 50 }],
          })
        : Promise.resolve<FolderRollup>({ total: 50, children: [] });
    const onActivateLeaf = vi.fn();
    await mount(
      <DriveLandscapeView
        fetchLevel={foldersOnly}
        width={320}
        height={240}
        onActivateLeaf={onActivateLeaf}
      />,
    );
    await waitFor(() => container.querySelector('[data-testid="circle-pack"]') !== null);
    const leaf = container.querySelector('g[data-leaf="true"]');
    if (leaf) {
      await act(async () => {
        leaf.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    }
    expect(onActivateLeaf).not.toHaveBeenCalled();
  });

  it("shows the empty state for an empty vault", async () => {
    const empty: FetchLevel = () => Promise.resolve<FolderRollup>({ total: 0, children: [] });
    await mount(<DriveLandscapeView fetchLevel={empty} width={320} height={240} />);
    await waitFor(() => container.textContent!.includes("Nothing to map yet"));
    expect(container.querySelector('[data-testid="circle-pack"]')).toBeNull();
    expect(container.textContent).toContain("Nothing to map yet");
  });
});
