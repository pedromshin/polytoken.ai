import { redirect } from "next/navigation";

/**
 * /emails/[id] — the standalone editor route is gone: the editor IS the inbox
 * inline preview now ("no separate things. just one thing"). This route stays
 * resolvable so every deep link into it (provenance, chat citations, knowledge,
 * the omnibox, circle-pack leaves) keeps working — it redirects to the inbox
 * with that email pre-selected (?email=<id>), where the same editor renders
 * inline.
 */
export default async function EmailDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?email=${encodeURIComponent(id)}`);
}
