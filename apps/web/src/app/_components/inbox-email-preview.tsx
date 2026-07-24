"use client";

/**
 * inbox-email-preview.tsx — the inline email preview pane. The editor IS the
 * preview now ("editor is the email preview itself, no separate things. just
 * one thing"): selecting a row renders the FULL email editor in place — body +
 * attachments, region overlays, layers/inspector — with no separate
 * /emails/[id] surface and no "Open in editor" hop.
 *
 * The pane keeps its own subject + From/To meta header and the MAIL-01
 * rule-review slot, then hands the rest of the frame to the embedded
 * EmailDetail editor (embedded mode: no page <main>, no back-link, no
 * focus-steal — a compact status/reprocess row instead).
 *
 * The editor (react-pdf / CanvasShell / all the editing machinery) is
 * next/dynamic'd with ssr:false so it never ships with the inbox shell and
 * only loads when a preview actually mounts — preserving the old carousel's
 * "pdfjs stays out of the inbox" property.
 */

// Explicit React import — vitest's esbuild transform needs `React` in scope
// when a test mounts this component (see inbox-three-pane.tsx's note).
import * as React from "react";
import dynamic from "next/dynamic";

import { Skeleton } from "@polytoken/ui/skeleton";

import type { InboxEmailItem } from "./inbox-three-pane";

/** The full email editor, embedded. Lazy + client-only so the inbox shell
 * never bundles react-pdf / the editor machinery until a preview mounts. */
const EmailEditor = dynamic(
  () =>
    import("~/app/emails/[id]/_components/email-detail").then(
      (m) => m.EmailDetail,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-0 flex-1 p-4" aria-busy="true" aria-label="Loading…">
        <Skeleton className="h-full w-full rounded-card" />
      </div>
    ),
  },
);

interface InboxEmailPreviewProps {
  /** The emails.list projection the parent already resolved (instant paint). */
  readonly email: InboxEmailItem | null;
  /**
   * MAIL-01: the suggest-only rule-review panel for THIS email, rendered
   * between the meta line and the editor — in-context during triage (HEY
   * Screener model), never a settings destination. Pre-built by the parent
   * so this pane stays presentational. Passed through UNCHANGED.
   */
  readonly ruleReview?: React.ReactNode;
}

export function InboxEmailPreview({
  email,
  ruleReview,
}: InboxEmailPreviewProps): React.ReactElement {
  if (!email) {
    return (
      <div
        data-pane="reading"
        className="flex h-full flex-col items-center justify-center gap-2 bg-leaf p-12 text-center"
      >
        <p className="text-sm font-semibold text-ink">No email selected</p>
        <p className="text-sm text-faded">
          Select a message from the list to preview it here.
        </p>
      </div>
    );
  }

  const sender = email.senderName
    ? `${email.senderName} <${email.senderAddress}>`
    : email.senderAddress;

  return (
    <div
      data-pane="reading"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-leaf"
    >
      <div className="shrink-0 px-panel pt-panel">
        {/* .rp-head: the subject is the user's own material (law 2) — a serif
            h2, not muted chrome. */}
        <h2
          data-field="subject"
          data-evidence
          className="min-w-0 font-serif text-xl text-ink"
        >
          {email.subject ?? "(no subject)"}
        </h2>

        {/* .rp-meta: From/To are the user's material but they are metadata,
            not prose — sans, under a ruled boundary. */}
        <div className="mt-2.5 border-b border-hair pb-3.5 text-xs text-faded">
          From: {sender} · To: {email.toAddresses.join(", ") || "—"}
        </div>

        {ruleReview}
      </div>

      {/* The editor IS the preview. It fills the rest of the frame; on a phone
          its side panels collapse to sheets (CanvasShell), on desktop they sit
          inline. `key` remounts it per email so its internal state resets. */}
      <div className="min-h-0 flex-1">
        <EmailEditor key={email.id} emailId={email.id} embedded />
      </div>
    </div>
  );
}
