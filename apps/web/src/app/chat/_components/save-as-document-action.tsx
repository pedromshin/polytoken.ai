"use client";

// Explicit React import — vitest's classic-runtime esbuild JSX transform needs
// `React` in scope for any suite that mounts this file directly (the same
// documented gotcha turn-action-row.tsx / message-list.tsx call out).
import * as React from "react";

import { useCallback, useContext, useState } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "~/trpc/react";
import type { MessagePart } from "../_hooks/use-chat-stream";
import { buildDocumentDraft } from "./message-to-document";

const SAVE_ERROR_COPY = "Couldn't save as a document. Try again.";

/** The turn's text parts, joined — the SAME projection TurnActionRow copies, so
 * "save as document" and "copy" always act on identical content. */
function textForDocument(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
}

export interface SaveAsDocumentActionProps {
  /** The turn's canonical parts — text is converted to real report blocks. */
  readonly parts: readonly MessagePart[];
  /** Title fallback when the text has no heading/first-line to derive from
   * (a deep-research trace can pass "Deep research report"). */
  readonly fallbackTitle?: string;
}

/**
 * The LIVE button — the half that actually calls `documents.create` and
 * navigates. It is only ever rendered by {@link SaveAsDocumentAction} once the
 * App Router context is real (see below), so its `useMutation` hook always has
 * the tRPC provider it needs: the two providers are co-mounted in the app, and
 * both are absent together in a bare test mount. `router` is the concrete
 * `AppRouterInstance` from context — passed in rather than re-derived via
 * `useRouter()` (which THROWS with no provider), so this component never adds a
 * throwing hook to the transcript's render path.
 */
function SaveAsDocumentButton({
  parts,
  fallbackTitle,
  router,
}: SaveAsDocumentActionProps & {
  readonly router: { push: (href: string) => void };
}): React.ReactElement {
  const create = api.documents.create.useMutation();
  const [saving, setSaving] = useState(false);

  const hasText = textForDocument(parts).trim() !== "";

  const handleSave = useCallback(() => {
    const text = textForDocument(parts);
    if (text.trim() === "" || saving) return;
    const draft = buildDocumentDraft(text, fallbackTitle);
    setSaving(true);
    // ReportBlock's `runs`/`items` are `readonly` (the model is immutable by
    // contract); the trpc input's zod-inferred shape is mutable. The difference
    // is pure readonly-vs-mutable variance — safe, since the server re-validates
    // — so the input is cast to the mutation's own parameter type.
    const createInput = {
      title: draft.title,
      blocks: draft.blocks,
    } as Parameters<typeof create.mutate>[0];
    create.mutate(createInput, {
      onSuccess: ({ documentId }) => {
        setSaving(false);
        toast.success("Saved as a document.", {
          action: {
            label: "Open",
            onClick: () => router.push(`/documents/${documentId}`),
          },
        });
      },
      onError: () => {
        setSaving(false);
        toast.error(SAVE_ERROR_COPY, {
          action: { label: "Retry", onClick: () => handleSave() },
        });
      },
    });
  }, [parts, fallbackTitle, saving, create, router]);

  return (
    <button
      type="button"
      aria-label="Save as document"
      disabled={!hasText || saving}
      onClick={handleSave}
      className="rounded-md p-1 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:opacity-30"
    >
      {saving ? (
        <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
      ) : (
        <FileText className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/**
 * SaveAsDocumentAction (DOCS-01) — the chat affordance that turns an assistant
 * message (or a deep-research report) into a STORED document with REAL blocks.
 * It is the missing entry point: the typeset-PDF pipeline is already correct for
 * a stored document, but nothing in chat ever created one from a response. The
 * live button converts the turn's text to the report grammar
 * ({@link buildDocumentDraft}) and hands it to `documents.create`, after which
 * the existing PDF export applies unchanged.
 *
 * ────────────────────────────────────────────────────────────────────────
 * IT RENDERS NOTHING WITHOUT THE APP ROUTER — and that is the whole reason it
 * is split in two, mirroring message-turn.tsx's "three trees, no throw in a bare
 * test mount" law.
 * ────────────────────────────────────────────────────────────────────────
 *
 * `TurnActionRow` sits inside every settled assistant turn, and `MessageTurn` is
 * mounted BARE (no providers) across the message-stream-law / transcript suites.
 * The live button's `useMutation` needs the tRPC provider and its "Open" needs
 * the router; both throw when absent. Rather than force every one of those
 * unrelated suites to stub `api.documents` and a router, the affordance probes
 * the App Router context — a NON-throwing `useContext` read that is `null` in a
 * bare mount and the real `AppRouterInstance` in the running app (where the tRPC
 * provider is co-mounted). No router ⇒ render nothing, so a bare `MessageTurn`
 * mount is byte-identical to before this affordance existed; the real app always
 * has both providers, so the button always shows for users.
 */
export function SaveAsDocumentAction({
  parts,
  fallbackTitle,
}: SaveAsDocumentActionProps): React.ReactElement | null {
  const router = useContext(AppRouterContext);
  if (!router) return null;
  return (
    <SaveAsDocumentButton parts={parts} fallbackTitle={fallbackTitle} router={router} />
  );
}
