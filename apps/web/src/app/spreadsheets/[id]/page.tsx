import type { Metadata } from "next";
import * as React from "react";

import { SpreadsheetDetail } from "../_components/spreadsheet-detail";

export const metadata: Metadata = {
  title: "Table — Polytoken",
  description: "Open a stored table and read its rows off the canvas.",
};

/**
 * /spreadsheets/[id] route — the standalone table viewer (vLAUNCH Wave 0.65
 * lane P2 — PEDRO-CHECKLIST §5: /spreadsheets rows get an open affordance).
 *
 * WHY A VIEWER ROUTE, not a canvas deep-link: a table opens on canvas only as
 * a `spreadsheet` node inside a conversation's saved layout — the canvas route
 * has no URL/search-param mechanism to target a node, and adding one is a
 * chat-tree edit (off-limits to this lane; another wave owns chat/**). So the
 * cheapest HONEST affordance is this route: a server-component shell (metadata
 * + the awaited id) over one "use client" detail surface, mirroring
 * `/documents/[id]` exactly. The detail surface reads the owner-scoped
 * `spreadsheets.byId` procedure and renders the SAME read-only
 * `SpreadsheetGrid` the canvas node mounts — no new grid, no new write path.
 */
export default async function SpreadsheetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return <SpreadsheetDetail id={id} />;
}
