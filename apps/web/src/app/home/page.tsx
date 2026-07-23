import type { Metadata } from "next";
import * as React from "react";

import { HomeBoard } from "./_components/home-board";

export const metadata: Metadata = {
  title: "Home — Polytoken",
  description:
    "Your pinned home board: inbox summary, today's entities, recent documents, and the morning brief.",
};

/**
 * /home route — HM-01: the pinned, conversation-independent home board.
 *
 * Server-component shell (metadata + frame) over one "use client" surface,
 * mirroring documents/page.tsx. The board REUSES the canvas persistence (a
 * `home`-scoped `chat_canvas_layouts` row via chat.getHomeCanvasLayout /
 * chat.saveHomeCanvasLayout — migration 0046's scope discriminator), and reads
 * its panels from EXISTING routers only (emails / entities / documents / the
 * EN-02 reviewQueue). The inbox three-pane stays one click away via the header
 * link (HM-01 "inbox one click away").
 *
 * ROUTING NOTE: the flagship intent is home-at-`/` with the inbox one click
 * away. This lands the board at `/home` (added to the nav registry) to avoid
 * churning the inbox's existing route + tests in this batch; promoting it to
 * the default `/` is a one-line route swap held as a follow-up.
 */
export default function HomePage(): React.ReactElement {
  return <HomeBoard />;
}
