# Thread-grouping fixtures

Fixtures for `tests/domain/services/test_thread_grouping.py`'s integration test —
parsed via `app.domain.services.mime_parser.parse_mime` (the same parser the real
ingest pipeline uses) rather than hand-built `ThreadableEmail` objects, so the
grouping service is proven against real RFC 5322 bytes, not just synthetic dataclasses.

## `reply_chain_headers.eml`

**Provenance: constructed.** A normal RFC 5322 reply — `Message-ID`, `In-Reply-To`,
and `References` all present and correctly linking to two earlier messages in a
3-message chain (`<a-original@example.com>` -> `<b-reply@example.com>` -> this
message, `<c-reply@example.com>`). The two earlier messages are constructed
in-test via the `_email()` helper (not separate fixture files) — this fixture's
job is to prove `parse_mime` -> `ThreadableEmail` mapping threads correctly for
Tier 0 (THRD-01) on a message that went through the real MIME parser.

No provenance ambiguity here: standard header-threading semantics are
unambiguous and don't require a "real" sourced example to validate — the parser
itself is exhaustively tested elsewhere (`tests/test_mime_parser.py`).

## `gmail_forward_stripped.eml`

**Provenance: CONSTRUCTED (not sourced from a real ingested Gmail forward).**

Per `45-CONTEXT.md`'s fixture decision, a real Gmail-UI-forwarded `.eml` was
preferred: an automated search of the local Supabase `emails` table for a row
with a `body_text` containing a Gmail forward marker and empty/null
`references_ids` was attempted during this plan's autonomous execution, but the
live-DB read was blocked by the execution sandbox's action-permission
classifier (no reason surfaced) — see `45-02-SUMMARY.md` Deviations. No manual
retry loop was available in the autonomous run, so this fixture was instead
constructed from the documented Gmail UI forward structure:

- `References` and `In-Reply-To` headers are both **absent** (Gmail's forward
  compose flow does not carry them over — this is the exact THRD-02
  fragmentation hazard).
- A **new** `Message-ID` is minted for the forward itself.
- `Subject` carries the `Fwd:` prefix (stripped by `normalize_subject` for
  Tier 2 matching).
- The body embeds the classic `---------- Forwarded message ---------` marker
  followed by the quoted original headers, **including** a `Message-ID:` line
  for the original message — the exact string `extract_embedded_message_ids`
  scans for (Tier 1).

**Manual UAT item (tracked in `45-HUMAN-UAT.md` / phase human-verify backlog):**
once a real email has been forwarded through the live forwarding seam (Plan
45-05/45-06), pull its raw `.eml` from Supabase Storage and diff its forwarded-block
structure against this fixture. If a real Gmail forward's visible block ever
omits the `Message-ID:` line (some Gmail configurations/clients don't surface
it), Tier 1 silently falls through to Tier 2 (subject + window) — already
covered by dedicated unit tests in `test_thread_grouping.py` (Task 2) — so
correctness does not regress, but the Tier 1 fixture's realism assumption
should still be verified against a genuine sample when one is available.

## Anti-fragmentation assertion

The integration test parses both fixtures with `parse_mime`, maps each
`ParsedEmail` onto a `ThreadableEmail`, and asserts:

1. `reply_chain_headers.eml`, together with its two earlier chain members,
   groups into **exactly one** thread (Tier 0, real-parser path).
2. `gmail_forward_stripped.eml`, together with the original message it embeds
   the `Message-ID` of, groups into **exactly one** thread — i.e. the forward
   does **not** fragment the thread (THRD-02 acceptance).
