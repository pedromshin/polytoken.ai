/**
 * The parse-status marker (60-06 Task 2, law 1; ING-6 makes it honest).
 *
 * WHAT WAS WRONG (60-06): "failed" drove the madder variant. Law 1 spends
 * madder on the irreversible and on nothing else — "never errors, never
 * warnings" (58-IDENTITY). A failed parse is a STATUS, and it is the most
 * reversible thing on this page: the header renders a Reprocess button that
 * undoes it. Painting it madder told the user a retryable machine hiccup was
 * a point of no return.
 *
 * WHAT WAS WRONG (ING-6): the 'failed' branch was unreachable — the listener
 * never wrote anything but the frozen 'received', so a corrupt attachment was
 * pixel-identical to a healthy email. The listener now drives the lifecycle
 * ('parsed' on success, 'failed'/'degraded' when a post-persist stage — e.g.
 * an attachment parse — fails), so this marker must be VISIBLY distinct for
 * the failure states while staying inside law 1:
 *   - loud in INK WEIGHT, not hue: ink text on an ink border (the quiet
 *     states sit on the hairline `rule` border). Survives greyscale, makes no
 *     claim of irreversibility.
 *   - the recorded parse_error surfaces on the marker (title attr), so the
 *     user can see WHICH attachment failed and why without leaving the page.
 *
 * WHY "parsed" IS NOT VERDIGRIS, though it is tempting: verdigris means one
 * thing — "a human verified this fact". A parse succeeding is a MACHINE fact
 * no human confirmed. So a parse status earns no hue at all: it is chrome,
 * and it reads on the ink ladder.
 *
 * The shape is the inbox header's `.count` marker, so the two surfaces state
 * a small fact the same way.
 */

import * as React from "react";

const PARSE_STATUS_MARKER =
  "tabular rounded-sm border bg-bright px-1.5 py-0.5 text-2xs font-semibold whitespace-nowrap";

/** The statuses the listener stamps when a post-persist stage failed (ING-6). */
export function isFailedParseStatus(status: string): boolean {
  return status === "failed" || status === "degraded";
}

export function parseStatusToneClasses(status: string): string {
  // A clean parse has nothing to announce — it is the expected case.
  if (status === "parsed") return "border-rule text-faded";
  // A failure is loud in INK WEIGHT, not in hue: ink text AND an ink border
  // (vs the hairline rule everywhere else). It survives greyscale, and it
  // makes no claim to being irreversible, because it is not.
  if (isFailedParseStatus(status)) return "border-ink text-ink";
  return "border-rule text-pencil";
}

interface ParseStatusMarkerProps {
  status: string;
  /** parse_error recorded by the listener — shown only for failure states. */
  error?: string | null;
}

export function ParseStatusMarker({ status, error }: ParseStatusMarkerProps) {
  const failed = isFailedParseStatus(status);
  return (
    <span
      data-field="parse-status"
      title={failed && error ? error : undefined}
      className={`${PARSE_STATUS_MARKER} ${parseStatusToneClasses(status)}`}
    >
      {status}
    </span>
  );
}
