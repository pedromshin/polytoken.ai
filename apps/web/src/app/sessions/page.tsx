import type { Metadata } from "next";

import { SessionsList } from "./_components/sessions-list";

export const metadata: Metadata = {
  title: "Your sessions — Polytoken",
  description: "Terminal sessions running on your machine, through the local daemon.",
};

/**
 * /sessions — server-component wrapper. Everything live is client-side: the daemon is a
 * local companion on the user's machine (ws://127.0.0.1), so no server seam exists here
 * by design.
 */
export default function SessionsPage(): React.ReactElement {
  return <SessionsList />;
}
