"use client";

/**
 * home-canvas-island.tsx — thin "use client" wrapper holding the
 * `dynamic(ssr:false)` import of HomeCanvas (Phase 74 / MORN-07). Mirrors
 * chat-canvas-island.tsx: React Flow + its unlayered `dist/style.css` are never
 * server-rendered and never enter the /home static graph — they load only when
 * a home board actually has nodes to paint.
 */

import dynamic from "next/dynamic";
import * as React from "react";

import type { HomeCanvasProps } from "./home-canvas";

const HomeCanvasDynamic = dynamic(
  () => import("./home-canvas").then((mod) => ({ default: mod.HomeCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-faded">
        Loading board…
      </div>
    ),
  },
);

export function HomeCanvasIsland(props: HomeCanvasProps): React.ReactElement {
  return <HomeCanvasDynamic {...props} />;
}
