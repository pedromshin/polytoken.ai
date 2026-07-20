# RFC — Cloud Desktop: polytoken spawns a cloud machine and renders its realtime desktop in-app

> **Status:** DRAFT for review — implementation-ready design, verification deferred.
> **Slice:** 999.39 (canonical scope: `.planning/ROADMAP.md` → Parking Lot → 999.39).
> **THIS RFC IS THE INPUT TO `/gsd:new-milestone` FOR THE CLOUD-DESKTOP EPOCH.** When the epoch
> is opened, point `/gsd:new-milestone` at this file; the phase breakdown in §7 is written in
> ROADMAP.md house style so it lifts directly.
> **What this is:** the realization of VISION E5 *as the user actually means it* — not a browser
> panel, but a **whole remote computer**, provisioned by polytoken on demand, streamed live into a
> polytoken UI surface, driven with mouse+keyboard in realtime. "i want to have a remote computer
> so that i don't have a local computer at all anymore" — the cloud desktop REPLACES the local
> machine; polytoken becomes the computer (ROADMAP.md 999.39, user verbatim).
> **What this is NOT:** the D3/999.26 remote desktop (RDP/Sunshine into the user's own physical
> Windows PC — DIRECTIVES-2026-07-17.md D3). Do not conflate; D3 is the travel floor, this is the
> product feature.

---

## 0. Sources this RFC is built from (and cites throughout)

| Tag | Document | What it contributes |
|---|---|---|
| [999.39] | `.planning/ROADMAP.md` → 999.39 entry | Canonical scope, user verbatim, the four design surfaces |
| [FRONTIER-B] | `.planning/night-run/reports/frontier.md` §B | 2026 remote-desktop tech findings: Sunshine/Moonlight NVENC, Selkies WebRTC, neko, noVNC, Cloudflare Tunnel + Calls TURN |
| [VISION] | `.planning/research/polytoken-vision/VISION.md` | E4 (daemon), E5 (original browser-panel scope, now redefined), E7 job-shaping, guardrail 2 (generic daemon envelope), jailed-iframe precedent (E4, Phase 20 reuse note) |
| [D2] | `.planning/night-run/DIRECTIVES-2026-07-17.md` D2 | The capability-registry invariant every new feature rides |
| [NEG] | `.planning/night-run/reports/negative-space.md` | INV-1..14 (esp. INV-4 risk-is-data, INV-8..13 tenancy), Q5 cost ceiling, Q6 model class |
| [CAP-TS] | `packages/capabilities/src/capability.ts` | The frozen `Capability` shape: `id/input/output/risk/cost/describe/source/trust/scope/execute` |
| [REG-TS] | `apps/daemon/src/tools/registry.ts` | Daemon-local specialization pattern (`TCtx`/`TScope` binding) the desktop provider will mirror |
| [PROTO] | `packages/daemon-protocol/src/tools.ts` | The FROZEN `Risk` enum: `"read" \| "write" \| "exec"` (R-04) — see §5.2 for the collision |
| [ENDGAME] | `.planning/research/two-epoch-endgame/ENDGAME-PLAN.md` | Epoch structure; v2.0 = E4+E5+E6 merged; this epoch sequences after it |

Pricing figures below are marked **ESTIMATE** — they are order-of-magnitude from provider list
prices as of knowledge cutoff, and MUST be re-verified in the phase-planning conversation
(verification deferred per this slice's rules; frontier §C's practice note applies: this space
churns faster than memory [FRONTIER-B]).

---

## 1. Problem statement and product shape

Polytoken must be able to, from its own UI: **(a)** provision a fresh cloud machine on demand,
**(b)** stream that machine's live desktop into an in-app component at interactive latency,
**(c)** let the user drive it with mouse/keyboard/clipboard exactly like a local computer,
**(d)** own the machine's full lifecycle (spawn → attach → hibernate → destroy) as registry
capabilities with risk and cost declared as data, and **(e)** do all of this inside the tenancy
and cost-ceiling invariants the project has already locked [999.39] [NEG].

The acceptance bar is the dogfood scenario, verbatim from the user: *"we just make one for
ourselves and clone, run and test the repo from within the project itself"* — spawn a desktop,
`git clone` polytoken, run the dev stack on localhost there, and operate that running polytoken
from within polytoken [999.39]. §8 turns this into a checklist. Note the scenario is a **use**,
not the definition [999.39] — the definition is "a normal computer, it's just remote."

**Hard constraint discovered while designing:** the dogfood requires the desktop to run the
polytoken dev stack, and the dev stack requires Docker (local Supabase runs as containers — the
D3 night found the dev server dead *because* Docker Desktop had died [DIRECTIVES D3 status
note]). So the desktop must offer **real Docker**, not a crippled container sandbox. This single
requirement drives the §2 recommendation more than any latency figure.

---

## 2. Provisioning architecture — the decision

Three candidate architectures were named in the canonical scope [999.39]. Compared on the axes
that matter for this product (single-user today per INV-8 [NEG], dogfood needs Docker, spawn is
a UI action so cold start is UX):

### 2.1 Comparison

| Axis | (A) Firecracker microVM (self-hosted fleet) | (B) Container-desktop (Kasm/Selkies-on-pod, webtop-class images) | (C) Cloud-VM API (Hetzner/EC2) |
|---|---|---|---|
| **Cold start** | ~sub-second VM boot, BUT only after you own warm bare-metal hosts; fleet bring-up is the real cold start | Seconds (image pull cached) | ~30–90s (create + cloud-init) — acceptable for "turn on a computer" |
| **Isolation** | Hardware-virt, excellent | Shared kernel — weakest; needs gVisor/Kata/sysbox to approach VM grade | Hardware-virt per user, excellent — INV-8..11 trivially satisfied by 1 VM = 1 owner [NEG] |
| **Docker inside (dogfood-critical, §1)** | Yes (it's a VM) but nested-virt/device plumbing is ours to build | Docker-in-Docker: privileged mode (unacceptable) or sysbox (extra runtime to operate) | Native — it IS a machine |
| **GPU** | Effectively no (Firecracker has no GPU passthrough story worth building on) | Possible on GPU nodes, complex scheduling | Available as an instance-type choice when needed later; NOT needed now (§3.2) |
| **Persistence ("replaces my computer")** | Ours to build (block-device management) | Volume mounts; identity of "my machine" is weak | First-class: the VM's disk IS the machine; snapshot = hibernate (§5.1) |
| **Ops burden** | HIGHEST: we run a bare-metal fleet before we run a feature | Medium: we run a container host/cluster | LOWEST: one API client + cloud-init; provider runs the fleet |
| **Cost shape** | Bare-metal host ~ESTIMATE €40–130/mo always-on, amortized only at multi-tenant scale | Cheapest per-desktop at density; but a host must be always-on | Pay-per-hour per desktop; €0 when no desktop exists |

### 2.2 RECOMMENDATION: (C) Cloud-VM API — Hetzner Cloud, one VM per desktop, Selkies streaming stack installed by cloud-init

**Why:**
1. **The dogfood decides it.** Real Docker with zero exotic runtime work only falls out of a
   real machine (§1). Options A/B both make the acceptance scenario the hardest part; C makes
   it free.
2. **"A whole remote computer" is the product** [999.39]. A VM with a persistent disk *is* a
   computer the user can own, hibernate, and come back to. A pod is a session.
3. **Tenancy for free.** 1 VM = 1 owner principal maps directly onto INV-8 user-as-tenant and
   INV-11 opaque-key authz [NEG] — no shared-kernel hardening project.
4. **Lowest irreversibility.** The provider is hidden behind a port (§2.4); Firecracker (A) is
   the one option that commits us to owning hardware before demand exists — exactly the class
   of premature commitment VISION guardrail thinking exists to prevent [VISION §3].
5. **Frontier §B's transport findings port cleanly**: Selkies is "architected for
   containerized/cloud Linux desktops" [FRONTIER-B §B adopt-vs-build] — a cloud Linux VM
   running the Selkies container is its home turf.

**What each rejected option is deferred TO (not killed):**
- **(B) container-desktop** becomes the **multi-tenant density play** — when polytoken has real
  multi-user demand, a Kasm/Selkies-on-k8s pool is the cost-optimized tier for *ephemeral*
  desktops (INV-3-style: it's a second `DesktopProvider` implementation, a populate not a
  re-architecture — same pattern as [NEG] INV-3).
- **(A) Firecracker** is E7-adjacent territory (own-fleet economics) and inherits E7's gate:
  demonstrated demand, treated as its own venture decision [VISION E7]. Do not design now.

### 2.3 Costed default instance shape (ESTIMATE — re-verify at phase planning)

| | Default: **Hetzner CPX41-class** (8 vCPU shared / 16 GB / 240 GB NVMe) | Floor: CPX31-class (4 vCPU / 8 GB) | Escape hatch: dedicated-vCPU / GPU types |
|---|---|---|---|
| Hourly | ~€0.05/h ESTIMATE | ~€0.025/h ESTIMATE | decide only when a workload demands it |
| Monthly cap (24/7) | ~€30/mo ESTIMATE | ~€15/mo ESTIMATE | — |
| Fits | polytoken dev stack (node + Supabase containers + browser + Selkies encode ≈ 10–12 GB working set) | light desktop, no full dev stack | ML/GPU sessions later |

Sizing rationale: the dev stack alone killed an under-resourced environment once already
(Docker + Supabase + dev server [DIRECTIVES D3]); 8 GB is too tight for stack + browser +
software video encode; 16 GB is the honest default. Software x264 encode at 1080p costs 1–2
cores — budgeted inside 8 vCPU (§3.2). Region: pick the provider region nearest the user
(latency budget §3.4 spends 20 ms on RTT; Hetzner eu-central for the current user).

Cost posture per Q5 [NEG]: **cap first, tune later** — see §5.3.

### 2.4 The provider port

House pattern: storage behind repository ports [VISION §3 guardrail 1]. Same move here — a
`DesktopProvider` port (spawn/status/hibernate/resume/destroy/snapshot) with `HetznerProvider`
as the only implementation in this epoch. The port is what keeps §2.2's choice reversible and
what makes (B) a future populate. Mirrors exactly how `apps/daemon/src/tools/registry.ts` is a
thin local specialization over the shared substrate [REG-TS].

---

## 3. Streaming transport

### 3.1 Decision: Selkies-class WebRTC primary; noVNC kept only as break-glass diagnostics

Frontier §B already did this research for the personal-box case; 999.39 directs REUSE of the
transport findings with a spawned cloud machine as the target [999.39] [FRONTIER-B]:

- **Selkies (WebRTC, GStreamer)** — "purpose-built for pure browser access (HTML5, no client
  install) to Linux containers/Kubernetes/cloud/HPC… the strongest candidate if the hard
  requirement is 'opens in a browser tab'" [FRONTIER-B §B]. Our requirement is stronger than a
  browser tab — an **in-app component** — which rules out anything needing a native client.
  **CRITICAL config note from frontier:** Selkies "defaults to plain WebSockets, WebRTC is
  opt-in — check this default before assuming WebRTC-grade latency out of the box"
  [FRONTIER-B §B]. Enabling WebRTC mode is an explicit success criterion (Phase CD-2, §7).
- **Sunshine + Moonlight (NVENC) — rejected for in-app** despite being frontier §B's raw-latency
  winner: "the actual video stream is a native Moonlight client… not a pure browser tab — this
  matters if 'browser-accessible' is a hard requirement" [FRONTIER-B §B]. In-app rendering makes
  it a hard requirement. (Sunshine remains D3's tool for the *physical PC* use case — different
  problem [DIRECTIVES D3].)
- **noVNC / VNC-over-WS — rejected as fallback transport**: "image-diff-over-WebSocket, not
  video-over-WebRTC — meaningfully higher latency and worse motion quality" [FRONTIER-B §B].
  Kept ONLY as an operator break-glass path (Selkies images commonly ship a WS mode anyway —
  its default, per the same finding); it is never a product surface.
- **neko** — noted as the narrow "browser-in-browser" tool [FRONTIER-B §B]; not a full desktop;
  not selected.
- **Do not build a bespoke streaming stack** — frontier §B's closing law: "this space is dense
  with mature, actively-maintained open source in 2026" [FRONTIER-B §B]. Adopt, don't build.

### 3.2 Encoding: software x264 now, NVENC only if a GPU shape ever ships

The default instance (§2.3) has no GPU. Selkies' GStreamer pipeline does software x264/VP8 at
1080p on 1–2 cores — adequate for a *dev desktop* (mostly text/UI deltas, not 4K gaming; the
sub-30ms/4K60 NVENC numbers in frontier §B are the gaming ceiling, not our floor
[FRONTIER-B §B]). The encode budget is why the default shape is 8 vCPU (§2.3). If a GPU
instance type is ever added (§2.3 escape hatch), NVENC drops in on the same Selkies pipeline.

### 3.3 NAT path: mostly direct; Cloudflare Calls TURN as the standing fallback

A spawned cloud VM has a public IP — the *server* side of WebRTC has no NAT problem (unlike
frontier §B's home-PC case). The client side (user on hotel/office Wi-Fi — the D3 travel
scenario's network reality [DIRECTIVES D3]) can still force a relay. Adopt frontier §B's
finding directly: **Cloudflare Calls TURN** — "a free geodistributed TURN relay (1000GB/mo free
tier)… a fallback path, not the primary path" (relay hop adds latency/stutter)
[FRONTIER-B §B]. Configure Selkies' ICE with the Calls TURN credentials; expect direct
srflx/host paths in the common case.

### 3.4 Input path, clipboard, and the latency budget

- **Input:** pointer + keyboard travel over the Selkies WebRTC data channel (its designed input
  path — do not invent one, per adopt-don't-build [FRONTIER-B §B]). The in-app component must
  request **pointer-lock and keyboard-capture** while focused so browser shortcuts don't
  swallow desktop keystrokes (iframe `allow` list, §4.2).
- **Clipboard:** two-way sync via Selkies' clipboard channel on the desktop side + the browser
  Clipboard API on ours; browser permission (`clipboard-read`/`clipboard-write`) is requested
  by the component, surfaced through the ONE permission posture — never silently (suggest-only
  house stance [VISION E4 security note]).
- **Latency budget (same-region target, ESTIMATE — measured, not assumed, in Phase CD-2):**

  | Segment | Budget |
  |---|---|
  | capture + x264 encode (software, 1080p) | ≤ 20 ms |
  | network RTT (user ↔ same-region VM, direct path) | ≤ 40 ms |
  | decode + render in browser | ≤ 10 ms |
  | **glass-to-glass total (direct)** | **≤ 70 ms** — "feels like a computer" |
  | TURN-relayed worst case | ≤ 120 ms — degraded-but-usable, surfaced in UI as relay mode |

  Frontier §B's Sunshine sub-30ms figure [FRONTIER-B §B] is the proof the *physics* allows
  better; 70 ms is the honest software-encode/browser-decode target. Phase CD-2's success
  criterion is a measured number, and frontier §C's rule applies to any published latency
  claim: "cross-check numbers against at least two independent tests" [FRONTIER-B §C sources].

---

## 4. The in-app component

### 4.1 Canvas node first, dedicated surface as its fullscreen mode

999.39 poses canvas node vs dedicated surface [999.39]. Answer: **both, as one component in two
states** — the pattern already proven by the panel system:

- **Canvas node** (`desktop` node type) rides the genui **panel-as-node registry seam** named
  in 999.39 as the reuse point [999.39]; the registry's fourth consumer is literally "the
  canvas → as a node type" [CAP-TS header]. A desktop session on the canvas sits next to the
  directory panels and chats it is being used *with* — that adjacency is the E4/E5 composition
  the vision draws (directory panels + browser/desktop panels + run-trees side by side
  [VISION E4, §2 absorption map ORCH-01 row]).
- **Dedicated surface = the node's expand state.** Driving a real desktop in a 400px panel is a
  demo, not a computer. The node carries an expand-to-fullscreen affordance (same overlay
  discipline as existing panel expansion); the stream component is *moved*, not remounted, so
  the WebRTC session survives the transition. The user's "use it like a normal computer"
  [999.39] happens in this state; the canvas node is its home and its thumbnail.

### 4.2 Jailed-iframe discipline

The Phase 20 jailed-iframe discipline is the named reuse seam [999.39] [VISION E4 embedded-
editor note]. Application here:

- **Epoch phase 1 (CD-3):** the Selkies web client is served from the desktop's own gateway
  origin (§4.3) and embedded in a **sandboxed iframe**: `sandbox="allow-scripts allow-same-
  origin allow-pointer-lock"` (no `allow-top-navigation`, no `allow-popups`, no forms),
  `allow="clipboard-read; clipboard-write; fullscreen"` — the minimum grant set for §3.4's
  input/clipboard path and §4.1's fullscreen state. The desktop origin is per-session and
  never shares the app origin — the remote machine is **untrusted content** by definition (the
  user will run arbitrary software on it), so it gets exactly the jail any untrusted frame
  gets, plus a CSP `frame-src` allowlist pinned to the session's gateway hostname.
- **Later (CD-3 stretch or follow-on):** replace the iframe'd Selkies client with a
  **first-party WebRTC client component** speaking Selkies' signaling protocol directly — no
  iframe, native canvas styling, tighter input handling. Deferred because the iframe path
  ships the epoch and adopt-don't-build applies to clients too [FRONTIER-B §B].

### 4.3 Session auth handoff

The bare Selkies endpoint must never be reachable with static credentials. Handoff design:

1. Every desktop VM runs a tiny **auth gateway sidecar** (Caddy/oauth2-proxy class) in front of
   Selkies' signaling/web endpoints; cloud-init installs it with a per-session public key.
2. `desktop.attach` (§5.1) — executed server-side, where the user is already authenticated —
   mints a **short-lived, session-scoped token** (minutes, renewable) signed by the polytoken
   API, audience = that desktop's session id.
3. The component loads the iframe with the token in the **URL fragment** (never query — no log
   leakage), the gateway validates signature + audience + expiry and upgrades to a cookie
   scoped to the gateway origin.
4. Authorization is a **DB ownership assert on the session row** at mint time — never parsing
   the desktop's hostname/key structure — INV-11 verbatim: "authorization is ALWAYS a DB
   ownership assert, never path parsing" [NEG INV-11].

---

## 5. Lifecycle as registry capabilities

### 5.1 The four capabilities

Every one is a `defineCapability()` descriptor in the shared registry — one declaration read by
the LLM, genui, the executor, and the canvas [D2 §1] [CAP-TS INV-1 header]. A desktop is a
**daemon-protocol-shaped job** per VISION guardrail 2 ("design E4's command envelope generic…
so E7's inference jobs and E5's browser jobs are just new job types" [VISION §3.2]) — desktop
jobs are the third proof of that guardrail.

| id | describe (LLM-facing) | risk (§5.2) | cost [CAP-TS] | scope | notes |
|---|---|---|---|---|---|
| `desktop.spawn` | Provision a new cloud desktop (creates a billed VM) | `exec` + `irreversible` reversibility | `expensive` | `{provider, region, shape}` | ALWAYS behind the confirm widget; declares per-run ceiling (§5.3) |
| `desktop.attach` | Mint a stream token and open an existing desktop session | `read` + `reversible` | `cheap` | `{sessionId}` | ownership assert per INV-11 [NEG]; no billing effect |
| `desktop.hibernate` | Snapshot disk + power off; billing drops to storage-only | `write` + `reversible` | `cheap` | `{sessionId}` | the "close the lid" verb — a computer you come back to (§2.2 why-3) |
| `desktop.destroy` | Delete the VM and its disk permanently | `exec` + `irreversible` | `free` (saves money; destroys data) | `{sessionId}` | confirm widget with explicit data-loss language |

Per INV-4, **no capability implements its own confirm flow** — `risk` is data; the ONE
permission model reads it and drives the prompt [NEG INV-4] [CAP-TS INV-4 header]. The
confirm-action widget machinery (v1.6 Fork-2) keys off the field, exactly as INV-4 prescribes
[NEG INV-4 cheap-now]. Per INV-5, a genui-composed surface can spawn a desktop **only** because
these entries exist — the registry is both the safety model and the extension model [NEG INV-5]
[D2 §3]. Per INV-6, a *generated* flow that spawns desktops is INFERRED-tier and needs human
bless before running unattended [NEG INV-6].

### 5.2 The Risk-enum collision (flagged honestly — a prerequisite seam)

Three documents disagree about the risk vocabulary, and this RFC must not paper over it:

- The **frozen protocol enum** is `"read" | "write" | "exec"` (R-04, closed set) [PROTO], and
  `capability.ts` imports exactly that `Risk` [CAP-TS line 37].
- **INV-4's** cheap-now text specifies `risk: "safe" | "reversible" | "irreversible"`
  [NEG INV-4].
- **999.39** asks for `risk: "irreversible"` on the spawn capability [999.39].

`"irreversible"` is not expressible in the shipped enum. **Proposal (decide at phase planning,
CD-1):** do NOT widen the frozen R-04 enum (it is closed deliberately and the daemon permission
store keys on it [PROTO]); instead add an additive, optional
`reversibility?: "reversible" | "irreversible"` field to `Capability` [CAP-TS] — absent means
reversible (today's capabilities unchanged), and the ONE permission model treats
`reversibility: "irreversible"` as the confirm-modal trigger, which also makes the taste law
("confirm modals and `--bad` share exactly one scope — the irreversible" [NEG INV-4 why])
machine-checkable. This is a one-field, zero-migration change to the substrate package and is
listed as CD-1 work in §7.

### 5.3 Per-run cost ceiling (Q5 applied)

Q5's stance, adopted wholesale: "per-run hard cap declared in the registry entry's `cost`
field, enforced in the loop, surfaced in the UI. **Cap first, tune later.**" [NEG Q5]. A cloud
desktop is the second capability class (after deep research) that burns real money on one user
action [NEG Q5] — and unlike a research run it burns **continuously**, so the cap has three
layers, all enforced by the control plane (never by the desktop — it's untrusted, §4.2):

1. **Spawn-time ceiling:** `desktop.spawn` declares max hourly rate + max concurrent desktops
   (default: 1) + a per-desktop **max lifetime** (default: 8 h, then auto-hibernate). Declared
   in the registry entry; shown in the confirm widget alongside the risk language.
2. **Idle reaper:** control-plane cron hibernates any session with no attached stream for
   N minutes (default: 30). Hibernate, not destroy — never destroy data automatically
   (suggest-only stance generalized [NEG INV-6]).
3. **Monthly budget:** per-owner cap in the `desktop_sessions` ledger; spawn fails closed at
   the cap. Every runtime-hour row carries the owner principal at creation — INV-13 verbatim
   ("every metered/billable event row carries the owner principal" [NEG INV-13]), same pattern
   as `chat_cost_ledger` [NEG INV-13].

Model-class note: any LLM involvement in desktop workflows declares a **model class**, never a
model id, per Q6 [NEG Q6].

---

## 6. Tenancy & security (INV-8..11, applied)

- **INV-8 — user-as-tenant** [NEG]: `desktop_sessions(user_id, …)` with `user_id` as the owner
  principal; ALL scope resolution through `ownership.ts` — no inline `auth.uid()` joins in the
  new routers (the standing rule, verbatim [NEG INV-8]). One VM = one owner (§2.2) means no
  shared-host cross-tenant surface exists in this epoch at all.
- **INV-9 — RLS as the live second wall** [NEG]: `desktop_sessions` (and the runtime-hours
  ledger) ship BOTH `deny_all_*_anon` (RESTRICTIVE) and `*_owner_authenticated` (PERMISSIVE)
  policies **in the same migration** [NEG INV-9].
- **INV-10** [NEG]: no importer coupling exists here; recorded only so nobody invents one —
  `importer` is never a tenant boundary.
- **INV-11 — opaque keys, DB-assert authz** [NEG]: session ids are opaque; VM hostnames,
  provider ids, and gateway URLs are **data on the owned row**, never parsed for authorization
  (§4.3 step 4). Provider API tokens live only in the control plane — **never on the desktop**.
- **The desktop is untrusted, always:** the user runs arbitrary software on it, so it holds no
  polytoken secrets, no provider credentials, and no ability to call back into the control
  plane beyond its own session-scoped gateway keys. Firewall: default-deny inbound except the
  gateway port (and ICE/TURN as configured, §3.3). This is the same posture as the jailed
  iframe (§4.2), applied at the network layer.
- **Audit:** every lifecycle transition is a ledger row (INV-7's "everything the product emits
  carries a ledger ref" applied to machine events [NEG INV-7]), which is also what the cost
  ceiling (§5.3) reads.

---

## 7. Phase breakdown (ROADMAP.md house style — lifts into `/gsd:new-milestone` directly)

Epoch sequencing per 999.39: **a v2.x epoch, after the v2.0 daemon + the capability registry it
rides on** [999.39] [ENDGAME §3]. Five phases; numbers assigned at milestone creation.

### Phase CD-1: Desktop Control Plane & Provisioning Spine

**Goal**: Polytoken can create and destroy a real cloud VM through a `DesktopProvider` port
(Hetzner implementation), with `desktop.spawn`/`desktop.destroy` as registry capabilities whose
risk/cost/ceilings are declared as data, and a `desktop_sessions` table that satisfies the
tenancy invariants.
**Depends on**: v2.0 capability registry (Phase 68) + daemon job envelope (Phase 65)
**Requirements**: (assigned at milestone creation — DESK-01..03 suggested)
**Success Criteria** (what must be TRUE):
  1. `desktop.spawn` and `desktop.destroy` exist as `defineCapability()` entries [CAP-TS];
     resolution is by registry id; an unregistered desktop capability fails closed from every
     consumer (extends Phase 68's adversarial test).
  2. The `reversibility` field (§5.2 proposal, as blessed at planning) exists on the substrate
     `Capability` type; the confirm widget renders from it for `desktop.spawn`/`destroy` with
     cost + data-loss language; NO desktop code implements its own confirm flow (INV-4).
  3. `desktop_sessions` ships with both RLS policies in one migration (INV-9); all access
     resolves through `ownership.ts` (INV-8); provider ids are never parsed for authz (INV-11).
  4. A spawn API call produces a running Hetzner VM via cloud-init and a destroy removes it —
     verified against the real provider API; provider tokens exist only in the control plane.
  5. Spawn fails closed at the declared concurrent-desktop and monthly-budget caps (Q5).

### Phase CD-2: Streaming Path — Selkies WebRTC End-to-End

**Goal**: A spawned desktop streams its display over WebRTC (Selkies with WebRTC mode
explicitly enabled, NOT the WebSocket default) to an authenticated browser tab, with Cloudflare
Calls TURN as the standing relay fallback, at a measured glass-to-glass latency inside budget.
**Depends on**: CD-1
**Requirements**: DESK-04..05 suggested
**Success Criteria** (what must be TRUE):
  1. Cloud-init brings the VM up with the Selkies desktop stack + auth gateway; the stream is
     WebRTC (verified at the RTCPeerConnection level), not the WS default [FRONTIER-B §B].
  2. The gateway rejects unauthenticated access; a short-lived session token minted against a
     DB ownership assert is the only way in (§4.3).
  3. Direct ICE path works from a public network; a TURN-forced client still connects via
     Cloudflare Calls and the UI can tell it is in relay mode (§3.3).
  4. Measured same-region glass-to-glass latency ≤ 70 ms direct / ≤ 120 ms relayed (§3.4),
     recorded in the phase summary with methodology.
  5. Software x264 encode at 1080p leaves the dev-stack workload (§2.3 sizing) responsive —
     measured, not asserted.

### Phase CD-3: The In-App Desktop Surface

**Goal**: The desktop renders inside polytoken — a canvas `desktop` node (panel-as-node
registry) with an expand-to-fullscreen state — via a jailed iframe with the minimum permission
grant set, and mouse/keyboard/clipboard work like a local computer.
**Depends on**: CD-2
**Requirements**: DESK-06..07 suggested
**Success Criteria** (what must be TRUE):
  1. A `desktop` canvas node type exists in the panel-as-node registry; `desktop.attach` from
     chat or canvas opens it (registry as node-type consumer [CAP-TS INV-1]).
  2. The iframe jail carries exactly the §4.2 sandbox/allow set; a CSP `frame-src` allowlist
     pins the session's gateway origin; nothing in the app origin is reachable from the frame.
  3. Expand-to-fullscreen keeps the same WebRTC session (no reconnect); keyboard capture holds
     desktop shortcuts while focused and releases them on blur/escape.
  4. Two-way clipboard works behind an explicit browser permission prompt — never silently.
  5. Node chrome shows live session state: running/hibernated, uptime, burn rate (§5.3 surfacing,
     per Q5's "surfaced in the trace UI" stance [NEG Q5]).

### Phase CD-4: Lifecycle & Cost Hardening

**Goal**: The desktop behaves like a computer you own, not a session you lose: hibernate/resume
via disk snapshot, idle reaping, max-lifetime auto-hibernate, and a per-owner metered ledger —
the full Q5 three-layer cap live.
**Depends on**: CD-3 (CD-4 enforcement is testable without CD-3's UI; sequence flexibly at planning)
**Requirements**: DESK-08..09 suggested
**Success Criteria** (what must be TRUE):
  1. `desktop.hibernate` snapshots and powers off; resume restores the same machine state
     (files, installed software) — verified by writing a file, hibernating, resuming, reading it.
  2. The idle reaper hibernates (never destroys) an unattached session after the configured
     window; max-lifetime auto-hibernate fires; both leave ledger rows carrying the owner
     principal (INV-13).
  3. Every runtime hour is metered in the ledger; the monthly cap blocks new spawns fails-closed
     and the UI says why.
  4. `desktop.destroy` is the ONLY path that deletes data, and only through the irreversible-
     class confirm widget (INV-4).

### Phase CD-5: Dogfood Gate — Polytoken Develops Polytoken (HUMAN GATE)

**Goal**: The acceptance scenario (§8) passes end-to-end, performed live by the user — the
epoch's live-UAT gate per the standing rule that deploy/live-UAT gates are first-class phase
work, never deferrable [ENDGAME standing rule / ROADMAP "Next Two Epochs" note].
**Depends on**: CD-1..4
**Requirements**: DESK-10 suggested
**Success Criteria** (what must be TRUE):
  1. Every step of §8's checklist passes in one continuous session, driven entirely from
     within polytoken.
  2. The session's total cost is visible in-app afterward and matches the provider invoice to
     within rounding (INV-13 / Q5 surfacing).
  3. The user signs off in the phase UAT — this criterion is a human gate by design (house
     precedent: Phase 58's HUMAN GATE [ROADMAP Phase 58]).

---

## 8. The dogfood scenario as acceptance (verbatim-derived checklist)

Source of truth: *"we just make one for ourselves and clone, run and test the repo from within
the project itself … test the browser stuff from within our polytoken ui itself"* [999.39].

1. **Spawn** — from polytoken chat/canvas, invoke `desktop.spawn` (default shape §2.3); the
   confirm widget shows risk + hourly cost + ceilings; approve; a canvas desktop node appears
   and goes live in ≤ 3 minutes.
2. **It's a computer** — expand to fullscreen; open a terminal on the remote desktop; typing
   feels local (≤ 70 ms budget, §3.4); clipboard paste from the local machine works.
3. **Clone polytoken** — `git clone` the repo inside the desktop; auth for the clone is the
   user's own (typed/pasted in-session), never a polytoken-held secret (§6 untrusted-desktop
   posture).
4. **Run the stack on localhost** — start Docker, `supabase start`, run the dev server; open
   the desktop's own browser at `localhost:3000`; polytoken's login page renders — the exact
   stack whose Docker dependency drove §2's recommendation [DIRECTIVES D3].
5. **Operate polytoken from within polytoken** — inside the streamed desktop's browser, log in
   and use the cloned polytoken (chat, canvas, browser-dependent UI) — "test the browser stuff
   from within our polytoken ui itself" [999.39], literally: the outer polytoken renders a
   desktop that runs an inner polytoken.
6. **Hibernate and return** — hibernate from the node chrome; resume later; the clone, the
   running containers' state on disk, and the shell history are still there (CD-4 SC-1).
7. **Settle the bill** — the in-app cost readout for the session matches the provider invoice
   (CD-5 SC-2).

Pass = the epoch shipped what 999.39 means. Fail at any step = the epoch is not done,
regardless of what the phases individually claimed.

---

## 9. Open questions carried to phase planning

1. **Risk-enum resolution (§5.2)** — additive `reversibility` field vs widening R-04; needs the
   user's bless because it touches the frozen protocol's neighborhood [PROTO].
2. **Pricing re-verification** — all §2.3 figures are ESTIMATE; re-quote Hetzner (and one
   comparison provider) live during CD-1 planning [FRONTIER-B §C practice].
3. **Selkies maintenance posture** — frontier §B notes it is "community/academic-maintained"
   [FRONTIER-B §B]; CD-2 planning should re-check project health and pin a known-good image
   digest (supply-chain hygiene per frontier §A's vetting stance [FRONTIER-B §A/§C]).
4. **First-party stream client (§4.2 later-state)** — in-epoch stretch or follow-on backlog
   item; decide by CD-3.
5. **VISION.md fold-in** — 999.39's capture correction requires E5's redefinition to be written
   into VISION.md/the endgame ladder at the next milestone boundary [999.39]; the milestone
   that adopts this RFC should do it in its kickoff commit.
