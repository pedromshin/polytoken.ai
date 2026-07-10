# 45-UI-SPEC: Thread-Grouped Inbox

**Phase:** 45-email-threads-forwarding-seam · **Plan:** 04 · **Requirement:** THRD-03
**Status:** Decision-ready design contract, NOT a mockup.

## Purpose

The inbox currently lists one row per email. This spec governs the ONE real UI
change in this milestone: the middle pane groups emails into thread entries,
each expandable to its member emails. This is intentionally the milestone's
only visual surface change — everything else in v1.7 is backend/auth/tenancy.

## Scope boundary (hard constraint)

- **The existing email detail/editor view (`apps/web/src/app/emails/[id]`) is
  UNTOUCHED.** Selecting a member email in the reading preview and clicking
  "Open editor →" must reach the identical, unmodified detail page.
- **The reading preview (right pane) behavior is unchanged** — it still shows
  whichever single email is selected (now a thread *member*, not necessarily
  the thread's newest message).
- E3 (thread cards on canvas, next epoch) is explicitly OUT of scope — this
  plan does not touch canvas/React Flow surfaces.

## Styling posture: intentionally minimal (v1.4 tokens only)

This is a **functional grouping change**, not a redesign. No new components,
no new tokens, no new npm dependencies (T-45-04-SC). Reuse exactly what
`inbox-three-pane.tsx` / `inbox-row.tsx` already use:

- `Badge` (existing `secondary`/`outline` variants) for the message-count
  indicator — same primitive already used for the inbox item counter and
  entity chips.
- `muted-foreground` text token for the latest snippet + relative date, same
  as the existing row's subject/date treatment.
- No new color, no new radius/shadow work. v1.8 re-skins this surface; this
  plan's job is correctness and information architecture, not visual polish.

## Thread-entry anatomy

Each row in the middle pane represents ONE thread (or one singleton email).
Top to bottom / left to right, mirroring `InboxRow`'s existing 3-line layout:

```
┌──────────────────────────────────────────────────────────┐
│  Subject line                              [3]      2d ago │  <- line 1: subject (semibold, truncated) + count Badge + relative date
│  latest snippet text, truncated to one line…                │  <- line 2: latest message's snippet (muted-foreground)
│  [entity chip] [entity chip] [+2]                            │  <- line 3: entity chips (unchanged from InboxRow, aggregated is NOT required — v1 shows chips only when the group is expanded to individual InboxRows; the collapsed thread row itself carries no chips to avoid a new aggregation query)
└──────────────────────────────────────────────────────────┘
       ▸ (click subject/row to expand — reveals member InboxRows below, indented)
```

- **Subject**: the latest member email's subject (server-computed — reflects
  the live conversation, e.g. "Re: Original subject", not the thread's
  original/normalized subject).
- **Count badge**: `Badge variant="secondary"`, shown ONLY when
  `messageCount > 1` (a singleton thread shows no badge — no visual noise for
  the common case).
- **Latest snippet**: server-truncated (`THREAD_SNIPPET_CHARS = 240`),
  single-line `truncate` CSS, `text-muted-foreground text-xs`, same tone as
  the existing row's subject line.
  **Relative date**: reuse `InboxRow`'s existing `formatDate` behavior
  (`toLocaleDateString()`) — no new relative-time library (zero-dep, T-45-04-SC).

## Expand/collapse interaction

- **Count 1 (singleton thread):** renders as a single flat row — identical to
  today's `InboxRow`, no disclosure chrome, no chevron. Selecting it drives
  the reading preview exactly as before.
- **Count > 1 (real thread):** the row is a disclosure trigger (local
  `useState<boolean>` toggle per group — no new dependency, no Radix
  Collapsible needed for this minimal v1). Clicking the subject/row area
  toggles expansion; a small chevron (▸/▾ via existing icon set already
  imported project-wide, e.g. `lucide-react` `ChevronRight`) indicates state.
  - **Collapsed (default):** shows only the group summary line (subject +
    count + latest snippet/date).
  - **Expanded:** reveals the group's member emails, each rendered via the
    EXISTING `InboxRow` component (unmodified), indented slightly
    (`pl-4` or similar) to signal membership. Selecting a member row behaves
    exactly as it does today (drives `ReadingPreview`, entity chips resolve
    per-member via the existing batched `entitySummary` query).
- Threads default to **collapsed** on load. Expansion state resets when the
  seed query changes (mirrors the existing `extraItems`/`nextOffset` reset
  pattern in `inbox-three-pane.tsx`).

## Data contract

Backed by `emails.listThreads` (packages/api-client/src/router/emails/list-threads.ts):

```ts
interface ThreadListEntry {
  key: string;              // threadId, or `email:{id}` singleton key
  threadId: string | null;
  importerId: string;
  subject: string | null;   // latest member's subject
  messageCount: number;
  latestReceivedAt: Date;
  latestSnippet: string | null;
  memberEmailIds: readonly string[]; // most-recent-first, capped at 50
}
```

The web client does NOT re-derive membership from `memberEmailIds` alone —
member rows are fetched via the same `allItems` pool the page already loads
(the seed `listThreads` query's flat email rows are NOT separately fetched;
instead, Task 2 keeps a per-thread member-row cache populated from the
existing paginated email data it already has access to, OR issues `emails.list`
scoped by importerId + filtered client-side to `memberEmailIds` for the
expanded group — implementation detail left to Task 2, contract-stable either
way since `memberEmailIds` is the addressable member set).

## Filters / load-more / entity chips (existing behavior, adapted)

- **Filters rail** (`All` / `Unread` / `With entities`) stays — "With
  entities" filtering now operates at the entry level: a thread entry is
  visible under "With entities" if ANY of its member emails carry extracted
  entities.
- **Load-more** stays — paginates over thread ENTRIES (not raw emails) via
  `listThreads`'s own `limit`/`offset`/`hasMore`/`nextOffset`, same shape as
  today's `emails.list` paging.
- **Entity chips**: rendered per-member `InboxRow` on expand (unchanged
  component, unchanged batched `entitySummary` query) — the collapsed
  summary row does not show chips (avoids requiring an aggregated
  chip-rollup-per-thread, out of scope for this minimal v1).

## Non-goals (explicitly deferred)

- Aggregated/rolled-up entity chips on the collapsed thread row.
- Thread-level actions (archive/mute/etc.) — none exist today per-email
  either.
- Any visual restyle beyond what's needed to add the count badge + expand
  affordance — v1.8 owns the re-skin.
