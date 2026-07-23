# Remote-desktop provisioning plan — from fail-closed shell to live desktops (2026-07-23)

> Companion to `.planning/research/cloud-desktop/RFC.md` (the authority — this doc defers to it on
> scope) and `.planning/research/cloud-desktop/AWS-ARCHITECTURE.md`. It records the concrete path
> from what ships in branch `b7-desktop` (cost VISIBILITY + management UI over the existing
> fail-closed foundation) to live desktops, and marks the billing/appetite gate explicitly at every
> money-spending step. **Nothing here binds a real provider.** DX-03 in the FEATURE-CATALOG governs
> the increment; the RFC governs the endgame.

## 0. What ships now (this branch) vs. what stays gated

**Shipped now — safe, no provisioning, no migration, no new node type:**
- Live cost ticker on the `desktop` canvas node chrome and the ST-03 pane, from
  `desktop_sessions.hourly_rate_cents` × wall-clock runtime (`created_at → now`). Pure math in
  `apps/web/src/lib/desktop-cost.ts` (unit-tested to the cent); the tick is a 1s client-side
  interval that re-derives elapsed locally — **no server poll storm** (the rate + start time are
  fetched once via the owner-scoped `desktop.list`).
- ST-03 desktop-management pane at `/settings/desktops`: the user's sessions, each with live cost,
  status, and the existing `hibernate` / `destroy` verbs. Owned-scoped (server query +
  `selectOwnedDesktops` defence). `destroy` is confirm-gated by reading
  `reversibility: "irreversible"` off the capability descriptor (INV-4), not a hard-coded flag.

**Still fails closed (unchanged):** `getDesktopProvider()` returns `failClosedDesktopProvider`;
every verb that would touch a machine returns a clean "provisioning not enabled" error and writes
no orphan row. The ticker shows cost for rows that exist; today rows only exist in tests/seed
because spawn is refused. That is the honest floor.

## 1. The gate (read this before any step in §2)

Every step below that spends money is **BILLING-GATED**: it must not be built or enabled until the
user gives an explicit budget go-ahead. The RFC's Q5 stance is adopted wholesale — *cap first, tune
later* (RFC §5.3). The single flip that turns provisioning on is `getDesktopProvider()`
(`packages/api-client/src/router/desktop/provider.ts`): it stays returning the fails-closed floor
until (a) an operator opt-in flag is set, AND (b) budget ceilings + a scoped provider credential are
configured. There is no "default on"; absence of config is a refusal.

## 2. The path to live desktops (each step names its gate)

### CD-2 — Bind the provider (Hetzner) — **BILLING-GATED**
RFC §2.2 recommends **Hetzner Cloud, one VM per desktop** (the dogfood needs real Docker, which only
a real VM gives for free; 1 VM = 1 owner satisfies INV-8/11 trivially). Implement
`hetznerDesktopProvider(config)` behind the existing `DesktopProvider` port
(`packages/capabilities/src/desktop.ts`) — `spawn` = create server + cloud-init the Selkies stack;
`hibernate` = snapshot + power off; `destroy` = delete server + disk; `attach` = return the
per-session gateway origin. Credentials read ONLY in the control plane, never on the row, never on
the desktop (RFC §6). Note the current schema/manifest default `provider = "aws"` and
AWS-ARCHITECTURE.md describes an EC2+DCV binding — the port makes provider choice a config decision;
the RFC's Hetzner recommendation and the AWS doc are two candidate implementations of the same port.
**Gate:** budget go-ahead + provider account + the operator flag in `provider.ts`.

### CD-3 — Stream-token minting + the jailed iframe mount — **gated on CD-2**
- **Token mint (RFC §4.3):** `desktop.attach` runs server-side (user already authenticated), asserts
  DB ownership on the session row (never parses the hostname — INV-11), and mints a short-lived,
  audience-scoped token signed by the polytoken API. The token rides the iframe URL **fragment**
  (never query — no log leakage); the VM's auth-gateway sidecar validates signature + audience +
  expiry and upgrades to a gateway-origin cookie. The substrate holds no signing key; the token is
  NOT part of the `desktop.attach` capability output and NEVER persisted into a layout row (the
  `DesktopNodeDataSchema` `.strict()` refusal of `gatewayUrl`/`token` is the enforcement).
- **Iframe mount (RFC §4.2):** replace the `desktop` node's placeholder with a sandboxed iframe —
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`,
  `allow="clipboard-read; clipboard-write; fullscreen"`, CSP `frame-src` pinned to the per-session
  gateway origin, which never shares the app origin. The remote machine is untrusted content by
  definition. The dedicated surface is the node's expand state (the stream component is *moved*, not
  remounted, so the WebRTC session survives). This is where the live cost ticker's numbers become
  real burn against a running VM.

### CD-4 — Live cost reconciliation — **gated on CD-2**
The ticker shipped now is an on-screen ESTIMATE (declared rate × runtime). The authoritative layer
is a per-runtime-hour ledger carrying the owner principal on every row (INV-13, same pattern as
`chat_cost_ledger`), plus RFC §5.3's three enforcement layers: (1) spawn-time ceiling — max hourly
rate + max concurrent (already enforced at 1 in the router) + max lifetime → auto-hibernate;
(2) idle reaper — control-plane cron hibernates a session with no attached stream for N minutes
(hibernate, never auto-destroy — suggest-only, INV-6); (3) monthly per-owner budget — `spawn` fails
closed at the cap. The pane's live figure then reconciles against this ledger rather than estimating.

### Concurrency — one or multiple desktops
Router enforces `MAX_CONCURRENT_DESKTOPS = 1` today (RFC §5.3 layer 1, conservative). The schema,
list query, pane, and per-node ticker are all already multi-row-shaped, so raising the cap is a
one-constant change **plus** the monthly-budget ledger (CD-4) — do not raise it before that ledger
exists, or a user can run N VMs past their budget. **Gate:** budget ledger in place.

## 3. What this branch deliberately did NOT do
- No real provider binding (provider.ts unchanged, still fails closed).
- No migration, no new canvas node type (`desktop` already exists), no stream/iframe.
- No change to the WebLLM/inference picker, teams schema, or files/canvas mirror.

## 4. Handoff — the one gate that unblocks everything downstream
**The billing/appetite decision.** CD-2 (Hetzner binding), CD-3 (token + iframe), CD-4 (reconciliation
ledger), and raising the concurrency cap are all gated on an explicit budget go-ahead. Until then the
safe, useful increment is exactly what shipped here: the cost is VISIBLE and the lifecycle is
MANAGEABLE over the fail-closed foundation, so the day the gate opens the UI is already in place.
