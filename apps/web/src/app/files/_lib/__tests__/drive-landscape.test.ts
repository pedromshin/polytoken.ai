/**
 * drive-landscape.test.ts — the recursive rollup→hierarchy builder (TM-04).
 *
 * Pure math: a fake `fetchLevel` stands in for `files.folderSizeRollup`, so
 * these assert the tree shape, the byte invariant, and the depth/budget/overflow
 * caps WITHOUT a server or a render.
 */

import { describe, expect, it, vi } from "vitest";

import type { CircleDatum } from "@polytoken/ui/circle-pack";

import {
  buildDriveHierarchy,
  DRIVE_MAX_DEPTH,
  type DriveLeaf,
  type FetchLevel,
  type FolderRollup,
} from "../drive-landscape";

// ---------------------------------------------------------------------------
// A fake vault as a nested map, and a fetchLevel that reads one level from it.
// ---------------------------------------------------------------------------

interface FakeFile {
  readonly size: number;
}
interface FakeFolder {
  readonly children: Record<string, FakeFile | FakeFolder>;
}
const isFolder = (n: FakeFile | FakeFolder): n is FakeFolder => "children" in n;

function subtreeSize(node: FakeFile | FakeFolder): number {
  if (!isFolder(node)) return node.size;
  return Object.values(node.children).reduce((sum, c) => sum + subtreeSize(c), 0);
}

function makeFetchLevel(root: FakeFolder): FetchLevel {
  const resolve = (path: readonly string[]): FakeFolder => {
    let node: FakeFolder = root;
    for (const seg of path) {
      const next = node.children[seg];
      if (next === undefined || !isFolder(next)) {
        throw new Error(`not a folder: ${path.join("/")}`);
      }
      node = next;
    }
    return node;
  };
  return (path) => {
    const folder = resolve(path);
    const children = Object.entries(folder.children).map(([name, node]) => ({
      name,
      isFolder: isFolder(node),
      size: subtreeSize(node),
    }));
    const total = children.reduce((sum, c) => sum + c.size, 0);
    return Promise.resolve<FolderRollup>({ total, children });
  };
}

// ---------------------------------------------------------------------------
// Tree walkers over the built CircleDatum
// ---------------------------------------------------------------------------

function leafValues(node: CircleDatum<DriveLeaf>): number[] {
  if (!node.children || node.children.length === 0) return [node.value ?? 0];
  return node.children.flatMap(leafValues);
}
function countNodes(node: CircleDatum<DriveLeaf>): number {
  return 1 + (node.children?.flatMap((c) => [countNodes(c)]).reduce((a, b) => a + b, 0) ?? 0);
}
function findByName(
  node: CircleDatum<DriveLeaf>,
  name: string,
): CircleDatum<DriveLeaf> | undefined {
  if (node.name === name) return node;
  for (const c of node.children ?? []) {
    const hit = findByName(c, name);
    if (hit) return hit;
  }
  return undefined;
}

describe("buildDriveHierarchy (TM-04 rollup → hierarchy)", () => {
  it("builds folders → files nesting from one-level fetches", async () => {
    const vault: FakeFolder = {
      children: {
        invoices: {
          children: {
            "q1.pdf": { size: 100 },
            "q2.pdf": { size: 200 },
            archive: { children: { "old.zip": { size: 50 } } },
          },
        },
        "readme.txt": { size: 10 },
      },
    };
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel(vault) });

    // Top level: an `invoices` container and a `readme.txt` leaf.
    const invoices = findByName(root, "invoices");
    expect(invoices?.children?.length).toBe(3); // q1, q2, archive
    const readme = findByName(root, "readme.txt");
    expect(readme?.children).toBeUndefined();
    expect(readme?.leaf?.isFolder).toBe(false);

    // The nested folder expanded into its own file.
    const archive = findByName(root, "archive");
    expect(archive?.children?.map((c) => c.name)).toEqual(["old.zip"]);
  });

  it("sums bytes exactly — packed leaves equal the true vault total", async () => {
    const vault: FakeFolder = {
      children: {
        a: { children: { "f1": { size: 300 }, "f2": { size: 700 } } },
        b: { children: { c: { children: { "deep": { size: 25 } } } } },
        "top.bin": { size: 5 },
      },
    };
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel(vault) });
    const total = leafValues(root).reduce((a, b) => a + b, 0);
    expect(total).toBe(300 + 700 + 25 + 5);
  });

  it("caps DEPTH — a folder past maxDepth becomes an aggregate size leaf sized by its subtree", async () => {
    // A chain deeper than maxDepth=2: root/l1/l2/l3/file.
    const vault: FakeFolder = {
      children: {
        l1: {
          children: {
            l2: {
              children: {
                l3: { children: { "buried.dat": { size: 999 } } },
              },
            },
          },
        },
      },
    };
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel(vault), maxDepth: 2 });

    // l1 (depth 1) and l2 (depth 2) expand; l3 (would be depth 3) does NOT —
    // it is an aggregate leaf, no children, sized by its subtree.
    const l2 = findByName(root, "l2");
    const l3 = l2?.children?.find((c) => c.name === "l3");
    expect(l3?.children).toBeUndefined();
    expect(l3?.value).toBe(999);
    expect(l3?.leaf).toMatchObject({ isFolder: true, size: 999 });
    // Byte total still exact despite the truncation.
    expect(leafValues(root).reduce((a, b) => a + b, 0)).toBe(999);
  });

  it("caps DEPTH at the documented default when maxDepth is omitted", async () => {
    // Build a chain deeper than the default and assert nothing expands past it.
    let node: FakeFolder = { children: { "leaf.x": { size: 1 } } };
    for (let i = 0; i < DRIVE_MAX_DEPTH + 3; i += 1) {
      node = { children: { [`d${i}`]: node } };
    }
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel(node) });
    // Deepest expanded container sits at depth === DRIVE_MAX_DEPTH; below that
    // is an aggregate leaf. Measure the maximum container depth reached.
    const maxContainerDepth = (n: CircleDatum<DriveLeaf>, d: number): number => {
      if (!n.children || n.children.length === 0) return d - 1;
      return Math.max(...n.children.map((c) => maxContainerDepth(c, d + 1)));
    };
    // root is depth 0; containers go no deeper than DRIVE_MAX_DEPTH.
    expect(maxContainerDepth(root, 0)).toBeLessThanOrEqual(DRIVE_MAX_DEPTH);
  });

  it("caps NODE BUDGET — a wide folder folds its tail into one 'N more' overflow leaf", async () => {
    const children: Record<string, FakeFile> = {};
    for (let i = 0; i < 50; i += 1) children[`f${i}.txt`] = { size: i + 1 };
    const vault: FakeFolder = { children };

    const root = await buildDriveHierarchy({
      fetchLevel: makeFetchLevel(vault),
      nodeBudget: 10,
    });

    // Total circles stay near the budget, not the 50 real files.
    expect(countNodes(root)).toBeLessThanOrEqual(12);

    // Exactly one overflow leaf, and the byte total is still conserved.
    const overflow = (root.children ?? []).filter((c) => c.leaf?.overflow === true);
    expect(overflow.length).toBe(1);
    const realTotal = Array.from({ length: 50 }, (_, i) => i + 1).reduce((a, b) => a + b, 0);
    expect(leafValues(root).reduce((a, b) => a + b, 0)).toBe(realTotal);
  });

  it("keeps the LARGEST children and folds the smallest into overflow", async () => {
    const vault: FakeFolder = {
      children: {
        huge: { size: 1000 },
        big: { size: 500 },
        "tiny-a": { size: 1 },
        "tiny-b": { size: 2 },
        "tiny-c": { size: 3 },
      },
    };
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel(vault), nodeBudget: 2 });
    const names = (root.children ?? []).map((c) => c.name);
    expect(names).toContain("huge");
    expect(names).toContain("big");
    // The three tinies fold into "3 more".
    expect(names).toContain("3 more");
    expect(findByName(root, "3 more")?.value).toBe(6);
  });

  it("renders an empty vault as a childless root carrying the (zero) total", async () => {
    const root = await buildDriveHierarchy({ fetchLevel: makeFetchLevel({ children: {} }) });
    expect(root.children).toEqual([]);
    expect(root.value).toBe(0);
  });

  it("only fetches folders it actually expands (fetch fan-out is bounded)", async () => {
    const vault: FakeFolder = {
      children: {
        a: { children: { "x": { size: 1 } } },
        b: { children: { "y": { size: 1 } } },
      },
    };
    const spy = vi.fn(makeFetchLevel(vault));
    await buildDriveHierarchy({ fetchLevel: spy });
    // root + a + b = 3 level fetches, no more.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("roots the landscape at a subfolder path", async () => {
    const vault: FakeFolder = {
      children: {
        projects: { children: { "spec.md": { size: 42 } } },
      },
    };
    const root = await buildDriveHierarchy({
      fetchLevel: makeFetchLevel(vault),
      rootPath: ["projects"],
    });
    expect(root.name).toBe("projects");
    expect(root.children?.map((c) => c.name)).toEqual(["spec.md"]);
    expect(root.children?.[0]?.leaf?.path).toEqual(["projects"]);
  });
});
