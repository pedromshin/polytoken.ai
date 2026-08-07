/**
 * ingest-degradation.ts — the ONE "capped ingest" truth, shared by the inbox
 * row and the email-detail note (vLAUNCH B-lane; same promotion logic as
 * `tier.ts`: two surfaces asking one question must not each derive it).
 *
 * THE STATE: the listener's A1 daily cost cap (mail-bomb blast-radius
 * limiter) can skip an email's expensive enrichment. Nothing is lost — the
 * raw email persists in full — but the pipeline finalizes it
 * `parse_status='degraded'` with a stage-prefixed `parse_error` entry:
 *
 *     ingest_cost_capped: daily ingest cap reached, enrichment skipped
 *
 * (`_finalize_cost_capped` in `ingest_inbound_email.py`; the prefix grammar
 * and its forgery guard live in `pipeline_health.py`.)
 *
 * THE PREDICATE mirrors the listener's decode rule, not a substring search:
 * entries are joined with "; ", details are sanitized so "; " can never occur
 * INSIDE one, and a fragment only decodes when it STARTS with a stage prefix.
 * A sender-controlled filename mentioning the stage mid-fragment must never
 * light the marker (the same forgery concern `KNOWN_STAGES` closes on the
 * health dashboard).
 *
 * This module holds FACTS AND WORDS, not classes — see `tier.ts`'s header for
 * why Tailwind class strings must stay literal at each surface.
 */

/**
 * One parse_error FRAGMENT that decodes as the capped stage: the fragment
 * starts with `ingest_cost_capped`, optionally one `[qualifier]` (the shared
 * prefix grammar allows it; the listener currently emits none), then ": ".
 */
const INGEST_COST_CAPPED_ENTRY = /^ingest_cost_capped(\[[^\]\s]*\])?: /;

/**
 * isIngestCostCapped — did this email's ingest finalize 'degraded' because
 * the daily cost cap skipped enrichment?
 *
 * Both inputs are nullable/optional so the projection types that carry them
 * (`InboxEmail`'s optional fields, the detail row) can call it directly.
 * Every input that is not exactly (status='degraded' AND a decodable capped
 * entry) returns false — the state does not occur until the cap flag flips,
 * and absence must render byte-identical to today.
 */
export function isIngestCostCapped(
  parseStatus: string | null | undefined,
  parseError: string | null | undefined,
): boolean {
  if (parseStatus !== "degraded") return false;
  if (parseError === null || parseError === undefined || parseError === "") {
    return false;
  }
  return parseError
    .split("; ")
    .some((fragment) => INGEST_COST_CAPPED_ENTRY.test(fragment));
}

/**
 * The quiet marker word the inbox row shows. States speak ink (law 1), and
 * this one speaks plainly: the user's experienceable fact is that the email
 * was not analyzed — "capped" is our plumbing, not their vocabulary.
 */
export const INGEST_COST_CAPPED_MARK = "not analyzed";

/**
 * The one-line explanation the email-detail surfaces (and the inbox marker
 * carries on `title`). One line, chrome copy: what happened, what is safe,
 * what the user can do. "Reprocess" names the button already beside it.
 */
export const INGEST_COST_CAPPED_NOTE =
  "Stored in full, but not analyzed — today's processing budget was reached. Reprocess to analyze it.";
