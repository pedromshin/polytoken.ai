"use client";

import { Skeleton } from "@polytoken/ui/skeleton";

/**
 * email-detail-frames — the three pre-content frames (loading / error /
 * not-found) the email-detail surface returns before data renders. Extracted
 * verbatim from email-detail.tsx (800-line law); markup unchanged. Each frame
 * mirrors the parent's Root rule: the standalone page renders as `<main>`,
 * embedded (inbox) renders as a plain `<div>` so it never nests a second
 * `<main>` inside the inbox's landmark.
 */

interface DetailFrameProps {
  readonly embedded: boolean;
}

export function DetailLoadingFrame({ embedded }: DetailFrameProps) {
  const Root = embedded ? "div" : "main";
  // The skeleton predicts the frame it stands in — a header bar, then the
  // canvas zone — so the load reads as this page assembling rather than as
  // three slabs that resemble nothing which ever arrives.
  return (
    <Root className="h-full">
      <div
        className="flex h-full flex-col"
        aria-busy="true"
        aria-label="Loading…"
      >
        <div className="flex shrink-0 items-center gap-4 border-b border-hair px-row-x py-row-y">
          <Skeleton className="h-4 w-28 rounded-sm" />
          <Skeleton className="h-6 max-w-md flex-1 rounded-sm" />
          <Skeleton className="h-5 w-14 rounded-sm" />
          <Skeleton className="h-8 w-32 rounded-sm" />
        </div>
        <div className="min-h-0 flex-1 p-4">
          <Skeleton className="h-full w-full rounded-card" />
        </div>
      </div>
    </Root>
  );
}

export function DetailErrorFrame({ embedded }: DetailFrameProps) {
  const Root = embedded ? "div" : "main";
  // An error is not irreversible, so it earns no madder (law 1: "never
  // errors, never warnings"). It is ink on a rule — the same framed block
  // the inbox uses, so a failure reads the same way on both surfaces.
  //
  // T-60-10: the copy stays generic on purpose. The underlying error is
  // NOT interpolated here — a tRPC message or a raw error object would
  // leak server-side detail to the client for no user benefit. Whatever
  // went wrong, the user's move is the same: refresh.
  return (
    <Root className="h-full p-6">
      <div role="alert" className="border border-rule p-panel">
        <p className="text-sm font-semibold text-ink">
          Failed to load email
        </p>
        <p className="mt-1 text-xs text-faded">
          Unable to load this email. Please try refreshing the page.
        </p>
      </div>
    </Root>
  );
}

export function DetailNotFoundFrame({ embedded }: DetailFrameProps) {
  const Root = embedded ? "div" : "main";
  return (
    <Root className="h-full p-6">
      <div className="border border-rule p-panel">
        <p className="text-sm font-semibold text-ink">Email not found</p>
        <p className="mt-1 text-xs text-faded">
          Email not found. It may have been deleted or the link is invalid.
        </p>
      </div>
    </Root>
  );
}
