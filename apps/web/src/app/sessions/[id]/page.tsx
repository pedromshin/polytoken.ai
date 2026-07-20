import type { Metadata } from "next";

import { SessionTerminal } from "./_components/session-terminal";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  await params;
  return { title: "Your session — Polytoken" };
}

/**
 * /sessions/[id] — server-component wrapper around the client terminal. The id is the
 * daemon's sessionId; attach/stream/input all happen client-side over the local WS.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return <SessionTerminal sessionId={decodeURIComponent(id)} />;
}
