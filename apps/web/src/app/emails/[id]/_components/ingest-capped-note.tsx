/**
 * ingest-capped-note.tsx — the email-detail's one-line explanation for an
 * ingest the A1 daily cost cap finalized 'degraded' (vLAUNCH B-lane).
 *
 * The parse-status marker already says "degraded" and carries the raw
 * parse_error on its tooltip (ING-6); this note adds the plain-words WHY for
 * the one degradation whose story the raw entry does not tell: nothing is
 * wrong with the email, the day's processing budget was simply reached, the
 * message is stored in full, and the Reprocess button beside it is the way
 * out.
 *
 * SELF-DECIDING ON PURPOSE: EmailDetail renders this unconditionally in both
 * header branches (embedded/inbox + standalone editor) and the component
 * returns null for every non-capped input — so until the cap flag flips,
 * absence renders NOTHING and both surfaces stay byte-identical to today.
 *
 * Law 1: this is a status, and it is fully reversible — quiet faded ink,
 * never a hue, never the loud ink-border register (that weight belongs to
 * failures the user should investigate; a capped email needs no alarm).
 * Law 2: our words, so sans — never serif.
 */

import * as React from "react";

import {
  INGEST_COST_CAPPED_NOTE,
  isIngestCostCapped,
} from "../../../_vocabulary/ingest-degradation";

interface IngestCappedNoteProps {
  /** The email's parse_status as recorded by the listener. */
  status: string;
  /** The email's parse_error as recorded by the listener. */
  error?: string | null;
}

export function IngestCappedNote({
  status,
  error,
}: IngestCappedNoteProps): React.ReactElement | null {
  if (!isIngestCostCapped(status, error)) return null;
  return (
    <p
      data-field="ingest-capped-note"
      className="shrink-0 border-b border-hair px-row-x py-1.5 text-xs text-faded"
    >
      {INGEST_COST_CAPPED_NOTE}
    </p>
  );
}
