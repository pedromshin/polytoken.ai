/**
 * ingest-degradation.test.ts — vLAUNCH B-lane (ingest-degraded visibility),
 * TDD RED before `_vocabulary/ingest-degradation.ts` exists.
 *
 * The predicate under test decides whether an email's ingest finalized
 * 'degraded' BECAUSE the per-importer daily cost cap fired (A1): the listener
 * stamps `parse_status='degraded'` plus a stage-prefixed `parse_error` entry
 * (`ingest_cost_capped: ...` — see `pipeline_health.py`'s prefix grammar and
 * `_finalize_cost_capped` in `ingest_inbound_email.py`).
 *
 * The state DOES NOT OCCUR until the cost-cap flag flips, so the predicate's
 * false branches are the live behavior today: every non-capped input must
 * return false so the surfaces render byte-identical to the pre-lane UI.
 */

import { describe, expect, it } from "vitest";

import {
  INGEST_COST_CAPPED_NOTE,
  isIngestCostCapped,
} from "../ingest-degradation";

/** The exact parse_error `_finalize_cost_capped` writes today (post-sanitize:
 * `failure_entry` folds the detail's "; " into ", "). */
const CAPPED_ERROR = "ingest_cost_capped: daily ingest cap reached, enrichment skipped";

describe("isIngestCostCapped — the one 'capped ingest' truth", () => {
  it("recognizes the exact entry the listener writes", () => {
    expect(isIngestCostCapped("degraded", CAPPED_ERROR)).toBe(true);
  });

  it("recognizes a capped entry among other '; '-joined entries", () => {
    expect(
      isIngestCostCapped(
        "degraded",
        `adapter_degraded[classifier]: classify_regions failed; ${CAPPED_ERROR}`,
      ),
    ).toBe(true);
  });

  it("tolerates a bracketed qualifier (the shared prefix grammar allows one)", () => {
    expect(
      isIngestCostCapped("degraded", "ingest_cost_capped[daily]: cap reached"),
    ).toBe(true);
  });

  it("is false for a degraded email whose reason is an adapter degradation", () => {
    expect(
      isIngestCostCapped(
        "degraded",
        "adapter_degraded[segmenter]: propose failed: APIError (+2 more)",
      ),
    ).toBe(false);
  });

  it("is false when the status is not 'degraded', whatever the error says", () => {
    // 'failed' carrying a capped-looking entry is a hard failure, not the
    // capped finalization; 'parsed'/'received' never carry the state.
    expect(isIngestCostCapped("failed", CAPPED_ERROR)).toBe(false);
    expect(isIngestCostCapped("parsed", CAPPED_ERROR)).toBe(false);
    expect(isIngestCostCapped("received", CAPPED_ERROR)).toBe(false);
  });

  it("is false for null/undefined/blank inputs (the entire inbox today)", () => {
    expect(isIngestCostCapped("degraded", null)).toBe(false);
    expect(isIngestCostCapped("degraded", undefined)).toBe(false);
    expect(isIngestCostCapped("degraded", "")).toBe(false);
    expect(isIngestCostCapped(undefined, CAPPED_ERROR)).toBe(false);
    expect(isIngestCostCapped(null, CAPPED_ERROR)).toBe(false);
  });

  it("forgery guard: a mid-fragment mention never counts as an entry", () => {
    // Sender-controlled details are sanitized ("; " -> ", ") by the listener,
    // so hostile text can only ever appear INSIDE a fragment — a fragment must
    // START with the stage prefix to decode (mirrors `decode_stage_prefix`).
    expect(
      isIngestCostCapped(
        "degraded",
        "adapter_degraded[classifier]: filename ingest_cost_capped: x.pdf",
      ),
    ).toBe(false);
    expect(
      isIngestCostCapped("degraded", "legacy plain-text failure with no prefix"),
    ).toBe(false);
  });

  it("the detail note is one line of chrome copy", () => {
    expect(INGEST_COST_CAPPED_NOTE.length).toBeGreaterThan(0);
    expect(INGEST_COST_CAPPED_NOTE).not.toContain("\n");
  });
});
