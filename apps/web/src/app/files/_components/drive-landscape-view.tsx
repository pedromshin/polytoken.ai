"use client";

/**
 * drive-landscape-view.tsx — DriveLandscapeView: the drive circle-pack view
 * (FEATURE-CATALOG TM-04). It renders the SHARED `CirclePack` primitive (TM-01,
 * `@polytoken/ui/circle-pack`) over a hierarchy built by descending
 * `files.folderSizeRollup` (the merged DR-04 aggregate) with the pure
 * `buildDriveHierarchy` builder — the vault as a landscape of nested byte
 * circles.
 *
 * REUSE, NOT REBUILD: the layout math, zoom, keyboard nav and hover card are all
 * the primitive's; this file owns only (a) fetching the levels via an injected
 * `fetchLevel` (so the /files surface and the canvas node each bind their own
 * tRPC client, and tests bind a fake), (b) the leaf slot — a file name + its
 * size — and (c) the drive-shaped states (loading / error / empty).
 *
 * OWNED-SCOPED BY CONSTRUCTION: `folderSizeRollup` is already `ctx.user.id`-
 * scoped, so nothing here can address another tenant's bytes.
 *
 * DESIGN LAW: chrome is monochrome (D-58-01 law 1) and this lives on the /files
 * surface, whose law (D-66-06, `files-law.test.ts`) is stricter than the canvas:
 * NOTHING here is evidence — no serif, no `data-evidence` — a file name is a
 * sans chrome LABEL, exactly as the vault listing renders it. Focus is an
 * OUTLINE, never a ring (the white-halo-in-dark trap).
 */

// Explicit React import — vitest's classic-runtime esbuild JSX transform needs
// `React` in scope for suites that mount this file directly (documented gotcha,
// genui-panel-node.tsx / vault-surface.tsx's identical note).
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CircleDashed } from "lucide-react";

import { CirclePack, type CircleDatum } from "@polytoken/ui/circle-pack";
import { Skeleton } from "@polytoken/ui/skeleton";

import { formatBytes } from "../_lib/vault-format";
import {
  buildDriveHierarchy,
  type DriveLeaf,
  type FetchLevel,
} from "../_lib/drive-landscape";

export interface DriveLandscapeViewProps {
  /** Fetch one folder level ([] = vault root). The caller binds the tRPC client. */
  readonly fetchLevel: FetchLevel;
  /** The folder the landscape is rooted at ([] = whole vault). */
  readonly rootPath?: readonly string[];
  /** Display name for the root circle (defaults to the folder name / "Files"). */
  readonly rootName?: string;
  /** Fired when a FILE leaf is activated (click / Enter) — never for a folder. */
  readonly onActivateLeaf?: (leaf: DriveLeaf) => void;
  /** Explicit size; when omitted the view measures its container (falling back
   * to these defaults where no ResizeObserver exists, e.g. jsdom). */
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

const DEFAULT_W = 344;
const DEFAULT_H = 236;

/** Measure the container, falling back to defaults where ResizeObserver is absent. */
function useMeasuredSize(
  fixedW: number | undefined,
  fixedH: number | undefined,
): { ref: React.RefObject<HTMLDivElement | null>; width: number; height: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: fixedW ?? DEFAULT_W, height: fixedH ?? DEFAULT_H });

  useEffect(() => {
    if (fixedW !== undefined && fixedH !== undefined) return;
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({
          width: fixedW ?? Math.floor(rect.width),
          height: fixedH ?? Math.floor(rect.height),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fixedW, fixedH]);

  return { ref, width: fixedW ?? size.width, height: fixedH ?? size.height };
}

export function DriveLandscapeView({
  fetchLevel,
  rootPath,
  rootName,
  onActivateLeaf,
  width,
  height,
  className,
}: DriveLandscapeViewProps): React.ReactElement {
  const pathKey = (rootPath ?? []).join("/");

  const query = useQuery<CircleDatum<DriveLeaf>>({
    queryKey: ["drive-landscape", pathKey],
    queryFn: () => buildDriveHierarchy({ fetchLevel, rootPath, rootName }),
  });

  const { ref, width: w, height: h } = useMeasuredSize(width, height);

  const tree = query.data;
  const hasContent = useMemo(
    () => tree !== undefined && (tree.children?.length ?? 0) > 0,
    [tree],
  );

  return (
    <div
      ref={ref}
      data-slot="drive-landscape"
      className={className ?? "relative flex h-[520px] w-full items-center justify-center"}
    >
      {query.isPending ? (
        <div
          role="status"
          aria-label="Loading drive landscape"
          className="flex size-full items-center justify-center"
        >
          <Skeleton className="size-[220px] rounded-full" />
        </div>
      ) : query.isError ? (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
          <AlertCircle className="size-5 shrink-0 text-ink" aria-hidden />
          <p className="text-xs text-faded">Couldn&apos;t map your drive. Try again.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-sm px-1.5 py-0.5 text-xs text-faded transition-colors hover:bg-ink-08 hover:text-ink outline-solid focus-visible:outline-2 focus-visible:outline-ink"
          >
            Retry
          </button>
        </div>
      ) : hasContent && tree ? (
        <CirclePack<DriveLeaf>
          data={tree}
          width={w}
          height={h}
          ariaLabel="Drive landscape"
          onLeafActivate={(circle) => {
            const leaf = circle.datum.leaf;
            // Only real files deep-link; a folder aggregate / overflow tail does not.
            if (leaf && !leaf.isFolder && leaf.overflow !== true) onActivateLeaf?.(leaf);
          }}
          renderLeaf={({ circle }) =>
            circle.r >= 22 ? (
              <text
                textAnchor="middle"
                className="pointer-events-none fill-ink"
                style={{ fontSize: Math.min(11, circle.r / 3) }}
              >
                <tspan x={0} y={-1}>
                  {truncate(circle.datum.name, Math.max(4, Math.floor(circle.r / 4)))}
                </tspan>
                <tspan
                  x={0}
                  y={circle.r / 2.6 + 2}
                  className="fill-faded"
                  style={{ fontSize: Math.min(9, circle.r / 4) }}
                >
                  {formatBytes(circle.datum.leaf?.size)}
                </tspan>
              </text>
            ) : null
          }
          renderHoverCard={(circle) => (
            <span className="flex flex-col gap-0.5">
              {/* A file name is a sans chrome LABEL on /files (D-66-06), not
                  evidence — the same treatment the vault listing gives it. */}
              <span className="truncate text-ink">{circle.datum.name}</span>
              {/* polytoken's summary line — sans chrome. */}
              <span className="tabular text-2xs text-faded">
                {circle.isLeaf && circle.datum.leaf?.isFolder !== true
                  ? formatBytes(circle.value)
                  : `${formatBytes(circle.value)} total`}
              </span>
            </span>
          )}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-1.5 px-1 text-center">
          <CircleDashed className="size-5 shrink-0 text-faded" aria-hidden />
          <p className="text-xs text-faded">
            Nothing to map yet. Upload files and your drive appears here as a landscape.
          </p>
        </div>
      )}
    </div>
  );
}

/** Trim a label to fit inside a small circle (leaf slot only). */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 1))}…`;
}
