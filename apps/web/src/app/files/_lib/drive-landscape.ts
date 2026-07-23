/**
 * drive-landscape.ts — the pure recursive builder that turns the drive's
 * one-level `files.folderSizeRollup` aggregate into the containment hierarchy
 * the shared `CirclePack` primitive draws (FEATURE-CATALOG TM-04).
 *
 * WHY A BUILDER, NOT A SERVER TREE: `folderSizeRollup({ path })` is deliberately
 * ONE LEVEL — immediate children with their (subtree) sizes plus the folder's
 * recursive total (packages/api-client's files router / storage-adapter). TM-04
 * descends it CLIENT-SIDE, one `fetchLevel` call per expanded folder, so it
 * reuses the merged DR-04 aggregate verbatim and adds no server surface. Because
 * the aggregate is already `ctx.user.id`-scoped, the whole landscape is
 * owned-scoped BY CONSTRUCTION — this module never sees another tenant's bytes.
 *
 * THE CAPS (a deep or wide vault must never explode the fetch fan-out or the
 * render):
 *   - {@link DRIVE_MAX_DEPTH} — folder nesting levels descended below the root.
 *     A folder deeper than this is drawn as a single AGGREGATE leaf sized by its
 *     subtree total (from the rollup) rather than expanded — it still shows on
 *     the map, it just doesn't open.
 *   - {@link DRIVE_NODE_BUDGET} — a global soft cap on the number of circles
 *     (and therefore `fetchLevel` calls, since only an expanded folder fetches).
 *     Once spent, no further folders expand.
 *   - PER-LEVEL OVERFLOW FOLDING — within one folder, children are taken
 *     LARGEST-FIRST (by bytes) and, once the budget for that level is spent, the
 *     remainder is folded into ONE "N more" aggregate leaf carrying their summed
 *     size. A folder of 10 000 files becomes the biggest few + one tail circle,
 *     never 10 000 leaves.
 *
 * SIZE INVARIANT: a container's value is the sum of its descendant leaves
 * (`d3.hierarchy(...).sum`), and every truncation preserves the byte total —
 * a folded-away or un-expanded folder contributes its rollup subtree size as a
 * leaf — so the packed circles always add up to the real folder total.
 */

import type { CircleDatum } from "@polytoken/ui/circle-pack";

// ---------------------------------------------------------------------------
// The shape `files.folderSizeRollup` returns (mirrored from the storage adapter
// so this module needs no server import). One level: immediate children with
// their subtree sizes, plus the folder's recursive total.
// ---------------------------------------------------------------------------

export interface FolderRollup {
  readonly total: number;
  readonly children: ReadonlyArray<{
    readonly name: string;
    readonly isFolder: boolean;
    readonly size: number;
  }>;
}

/** Fetch one folder level. `path` is tenant-RELATIVE vault segments ([] = root). */
export type FetchLevel = (path: readonly string[]) => Promise<FolderRollup>;

/** The opaque leaf payload threaded to the primitive's leaf renderer / click. */
export interface DriveLeaf {
  /** The containing folder path (segments) this node lives under. */
  readonly path: readonly string[];
  /** The node's own name (a file basename, a folder name, or the overflow label). */
  readonly name: string;
  /** True for a folder drawn as an aggregate leaf (depth/budget truncated). */
  readonly isFolder: boolean;
  /** Bytes: a file's own size, or a folder/overflow leaf's subtree total. */
  readonly size: number;
  /** True for the synthetic "N more" tail leaf, which addresses no real object. */
  readonly overflow?: boolean;
}

// ---------------------------------------------------------------------------
// Caps — documented, exported so tests and callers can reason about them.
// ---------------------------------------------------------------------------

/** Folder nesting levels descended below the root before a folder is aggregated. */
export const DRIVE_MAX_DEPTH = 4;

/** Global soft cap on circles (and therefore fetch fan-out). */
export const DRIVE_NODE_BUDGET = 600;

export interface BuildDriveHierarchyOptions {
  readonly fetchLevel: FetchLevel;
  /** The folder the landscape is rooted at ([] = whole vault). */
  readonly rootPath?: readonly string[];
  /** Display name for the root circle. */
  readonly rootName?: string;
  readonly maxDepth?: number;
  readonly nodeBudget?: number;
}

/**
 * buildDriveHierarchy — descend `fetchLevel` from `rootPath` into a
 * `CircleDatum<DriveLeaf>` tree, bounded by depth + node budget with per-level
 * overflow folding (see the module header for the caps). The returned root is
 * always a container (even for an empty vault, so the view can render an empty
 * state deterministically).
 */
export async function buildDriveHierarchy(
  opts: BuildDriveHierarchyOptions,
): Promise<CircleDatum<DriveLeaf>> {
  const {
    fetchLevel,
    rootPath = [],
    rootName = rootPath.length === 0 ? "Files" : (rootPath[rootPath.length - 1] ?? "Files"),
    maxDepth = DRIVE_MAX_DEPTH,
    nodeBudget = DRIVE_NODE_BUDGET,
  } = opts;

  // Remaining circles we may create (the root is free). Shared across the whole
  // recursion so the cap is global, not per-branch.
  const state = { budget: Math.max(1, nodeBudget) };

  const rootRollup = await fetchLevel(rootPath);
  const children = await buildLevel(fetchLevel, rootPath, 0, maxDepth, state, rootRollup);

  return {
    name: rootName,
    // If everything folded away (empty vault), fall back to the rollup total so
    // the root still carries a value; children drive it otherwise.
    value: children.length === 0 ? rootRollup.total : undefined,
    children,
    leaf: { path: rootPath, name: rootName, isFolder: true, size: rootRollup.total },
  };
}

/** A file / truncated-folder aggregate leaf. */
function sizeLeaf(
  path: readonly string[],
  child: FolderRollup["children"][number],
): CircleDatum<DriveLeaf> {
  return {
    name: child.name,
    value: Math.max(0, child.size),
    leaf: { path, name: child.name, isFolder: child.isFolder, size: child.size },
  };
}

async function buildLevel(
  fetchLevel: FetchLevel,
  path: readonly string[],
  depth: number,
  maxDepth: number,
  state: { budget: number },
  rollup: FolderRollup,
): Promise<CircleDatum<DriveLeaf>[]> {
  // Largest-first so the biggest consumers survive the budget and the overflow
  // tail is always the smallest remainder.
  const sorted = [...rollup.children].sort((a, b) => b.size - a.size);

  const out: CircleDatum<DriveLeaf>[] = [];
  let overflowSize = 0;
  let overflowCount = 0;

  for (const child of sorted) {
    if (state.budget <= 0) {
      overflowSize += Math.max(0, child.size);
      overflowCount += 1;
      continue;
    }

    const canExpand = child.isFolder && depth < maxDepth && state.budget > 1;
    if (!canExpand) {
      // A file, or a folder we won't open (depth cap / budget) → aggregate leaf.
      state.budget -= 1;
      out.push(sizeLeaf(path, child));
      continue;
    }

    // Expand: spend one node for the container, then descend (the recursion
    // spends the rest of the budget for its own descendants).
    state.budget -= 1;
    const childPath = [...path, child.name];
    const childRollup = await fetchLevel(childPath);
    const subChildren = await buildLevel(
      fetchLevel,
      childPath,
      depth + 1,
      maxDepth,
      state,
      childRollup,
    );

    if (subChildren.length === 0) {
      // An empty (or fully-folded) folder is drawn as an aggregate leaf sized by
      // its subtree total — a bare empty container would render as an r=0 dot.
      out.push({
        name: child.name,
        value: Math.max(0, child.size),
        leaf: { path, name: child.name, isFolder: true, size: child.size },
      });
    } else {
      out.push({
        name: child.name,
        children: subChildren,
        leaf: { path, name: child.name, isFolder: true, size: child.size },
      });
    }
  }

  if (overflowCount > 0) {
    out.push({
      name: `${overflowCount} more`,
      value: Math.max(0, overflowSize),
      leaf: {
        path,
        name: `${overflowCount} more`,
        isFolder: false,
        size: overflowSize,
        overflow: true,
      },
    });
  }

  return out;
}
