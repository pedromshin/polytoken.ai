# STOPPED LANES — 2026-08-07, two-strikes rule invoked

> Standing order: *"If a lane stalls twice on the same error, stop the lane and surface it
> instead of retrying a third time."* These three have been through **three** build+review
> rounds (0.11 → 0.12 → 0.13). Each round closed real defects and each round found new ones in
> the same neighbourhood. They are stopped here, not retried a fourth time.
>
> **None of them blocks anything.** All three are *pre-staging tooling* — conveniences for waves
> that have not run yet. Nothing in Batch A, Batch B, or the milestone close depends on them.

## What DID land from these three rounds

| Merged | Value |
|---|---|
| `w12-wave1-kit` | Wave-1 verification kit — 69 tests, and it independently verified staging live (**26 assertions, 0 failures**) |
| `w13-close-kit` | Close kit — exit contract verified by hand (`1` = not ready, `2` = could not verify); correctly reports the 7 seams as ASSUMED-not-EXECUTED |
| `w13-injection-fix` | Canvas emitter field guards + import-time read-tier gate; **2389 listener tests** green |

## Stopped, with the exact reason

### 1. `lane/w13-cutover-kit` — DO NOT MERGE, DO NOT RUN
Round 3 verdict: 2 HIGH remaining (down from 2 CRITICAL + 3 HIGH).
- A job whose **final attempt is executing right now** is reported as a permanent dead letter.
- H-3 **still reports clean green over a five-hour mail outage** — the rule changed but the new
  arithmetic still has a hole.

Both CRITICAL credential leaks from round 2 *were* genuinely fixed (verified by re-execution) —
`redact()` no longer leaks on a scheme-less URL, and the connection string no longer reaches
stderr via Node's uncaught-exception printer. But a kit whose job is to certify the **live mail
cutover** cannot ship while it can report green over an outage. That is the precise failure it
exists to prevent.

**What to use instead:** `scripts/staging-enqueue-drain-proof.mjs` — the manual proof that ran
green on staging tonight (enqueue → drain → terminal success in ~1s, 0 dead letters, confirmed
from the worker's own log). It is small enough to read in full before trusting it, which is the
opposite of this kit's problem.

### 2. `lane/w13-driver-tooling` — DO NOT MERGE
Round 3 verdict: 2 HIGH.
- A lane that merges as "already up to date" is **pushed with no gate covering it** whenever any
  other lane in the same run supplies a diff.
- The gate `merge-wave` selects for its own source does not exercise its own source.

Round 1's two CRITICALs (the `--cleanup` that reproduced the 1265-file incident, and the
dirty-worktree check that failed open) were closed. But this tool merges code and deletes
directories; "mostly correct" is not a standard it can ship under. The manual driver loop worked
all night and is documented in `VLAUNCH-WAVE-PLAN.md` §4.

### 3. `lane/w12-flag-gate-fix` — DO NOT MERGE
Its Wave-0.12 reviewer died on an API error, so Wave 0.13 produced the missing verdict from
scratch: **2 CRITICAL + 2 HIGH**.
- **One alias line makes an entire module invisible to the whole gate**, while
  `docs/FLAG-POSTURE.md` claims otherwise.
- The `destructured` axis is **100% naming-bound** — structurally incapable of ever being a
  boolean-context read — while the docs claim it is covered.

A posture gate that can be defeated by renaming a helper, while its own documentation says it
cannot be, is worse than no gate: it manufactures false confidence about which flags are dark.
**The flags themselves are unaffected** — they are set correctly today; only the *automated
proof* of that is unreliable. Verify flag posture by reading the settings classes directly until
this is redone.

## If these are picked up later
Treat each as a **fresh design**, not a fourth patch. The recurring shape across all three is the
same: a mechanism that is *almost* general (a census that misses a read shape, a gate that misses
a diff shape, an arithmetic rule that misses a queue shape) shipped alongside documentation
asserting it is general. The fix is not another patch — it is to make each mechanism's blind spot
an explicit, tested, documented part of its contract, the way
`docs/INJECTION-SURFACE-AUDIT.md`'s final paragraph now does.
