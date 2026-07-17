---
phase: 65-agent-daemon
plan: 02
subsystem: daemon-permissions
tags: [security, permissions, allowlist, windows, path-boundary]
requires: [65-01]
provides:
  - "the ONE decision point: createPermissionBroker().decide()"
  - "canonicalizePath / isInsideRoots — the hard, non-promptable boundary"
  - "persistent allowlist keyed on capabilityId (INV-2), fail-closed"
  - "structural-redaction audit log"
affects: [65-03, lane-e-67-sessions, phase-68-capabilities]
tech-stack:
  added: []
  patterns:
    - "default-deny by construction: executors receive ONLY the broker, never the store"
    - "structural redaction: meta accepts number|boolean, so contents cannot be typed"
    - "atomic tmp+rename persistence; corrupt state fails CLOSED"
key-files:
  created:
    - apps/daemon/package.json
    - apps/daemon/tsconfig.json
    - apps/daemon/vitest.config.ts
    - apps/daemon/.gitignore
    - apps/daemon/daemon.config.example.json
    - apps/daemon/src/config.ts
    - apps/daemon/src/permissions/paths.ts
    - apps/daemon/src/permissions/store.ts
    - apps/daemon/src/permissions/broker.ts
    - apps/daemon/src/permissions/audit.ts
    - apps/daemon/src/__tests__/paths.test.ts
    - apps/daemon/src/__tests__/store.test.ts
    - apps/daemon/src/__tests__/broker.test.ts
  modified: []
decisions:
  - "INV-2: permission rules key on `capabilityId` (registry id), NOT the plan's `tool` enum"
  - "vitest.config.ts added — vitest does not read tsconfig paths (plan gap, Rule 3)"
  - ".gitignore uses `.state` not `.state/` — a dir-only pattern cannot match before the dir exists"
deps:
  - "apps/daemon: @polytoken/daemon-protocol *, chokidar ^3.6.0, ws ^8.21.1, zod ^3.25.0 (all hoisted)"
  - "apps/daemon devDeps: @types/node ^20, @types/ws ^8 (ABSENT — see 65-03), tsx ^4.23.1, typescript ^5.8.0, vitest ^2.1.9"
metrics:
  duration: ~35min
  completed: 2026-07-17
requirements: [DMON-01, DMON-02]
---

# Phase 65 Plan 02: The ONE Permission Model Summary

The law before the citizens: config (roots = the universe), the hard path boundary, the persistent
allowlist, and the decision broker every tool consults — built first, pure, and tested almost
entirely through what it REFUSES. 69 tests green, `tsc --noEmit` clean.

## What is USABLE end-to-end

The permission core is complete and consumable by 65-03's executors. It is a library, not a
service, tonight: no transport is wired here by design (`AskFn` is injected).

## Export signatures (verbatim — 65-03 imports these)

```ts
// config.ts
export const daemonConfigSchema: ZodObject   // NOTE: no `host` field, by design (R-07/T-65-12)
export type DaemonConfig = {
  readonly version: 1; readonly roots: readonly CanonicalPath[];
  readonly watch: { readonly root: CanonicalPath };
  readonly port: number; readonly permTimeoutMs: number;
  readonly exec: { readonly defaultTimeoutMs: number; readonly maxOutputBytes: number };
  readonly stateDir: string;
};
export const loadConfig: (explicitPath?: string) => DaemonConfig   // frozen; throws, never boots invalid

// permissions/paths.ts
export type CanonicalPath = string & { readonly __brand: "CanonicalPath" };
export const canonicalizePath: (raw: string) => { ok: true; path: CanonicalPath } | { ok: false; reason: string };
export const isInsideRoots: (target: CanonicalPath, roots: readonly CanonicalPath[]) => boolean;

// permissions/store.ts
export const permissionRuleSchema; export const allowlistFileSchema;
export type PermissionRule = { id; capabilityId; risk; scope; decision: "allow"|"deny"; createdAt; origin };
export type AllowlistStore = {
  readonly rules: readonly PermissionRule[];
  match(q: { capabilityId: string; scope: string }): "allow" | "deny" | "none";
  append(rule: PermissionRule): Promise<AllowlistStore>;   // immutable — returns a NEW store
};
export const loadAllowlist: (filePath: string) => Promise<AllowlistStore>;

// permissions/broker.ts
export type Verdict = { kind: "allow" }
  | { kind: "deny"; code: "outside_roots"|"permission_denied"|"permission_timeout"; message: string };
export type AskFn = (req: PermRequestPayload) => Promise<{ allow: boolean; remember: boolean } | null>;
export type DecideQuery = { capabilityId: string; risk: Risk; scope: string;
                            pathsToCheck: readonly string[]; args?: unknown };
export const createPermissionBroker: (opts: { config; store; ask; audit }) => PermissionBroker;

// permissions/audit.ts
export type AuditEntry = { event: "decision"|"execution"; capabilityId: string; scope: string;
                           verdict?: "allow"|"deny"; code?: string;
                           meta?: Record<string, number | boolean> };   // numbers/flags ONLY
export const createAuditLog: (filePath: string) => AuditLog;
```

**Config resolution order:** env `DAEMON_CONFIG` > `explicitPath` argument >
`daemon.config.json` beside the package root. `stateDir` resolves relative to the config FILE's
directory.

## Amendment conformance (INV-2 / INV-4 / the "one authority" finding)

| Requirement | Status |
|---|---|
| Store keys on registry `id`, not a private tool enum | **Conforms** — `PermissionRule.capabilityId`, typed `z.string().min(1)` (open, so Phase 68's external capability ids persist unchanged; the REGISTRY closes the set, not the file) |
| `risk` read off the descriptor, never computed | **Conforms** — `DecideQuery.risk` is passed through from the descriptor to the prompt |
| No capability implements its own confirm flow | **Conforms** — one `decide()`; executors receive ONLY the broker |
| Plain data, no daemon-private coupling | **Conforms for the store/rule shape** (zod + plain records). The BROKER is daemon-side enforcement and does import config/paths — correct, since it is the enforcement point, not the registry |

### ⚠ Delta worth your attention (not a silent divergence)

The second amendment says the daemon "enforces the decision it is handed and does not invent a
parallel policy." **The daemon retains exactly ONE policy of its own: default-deny outside
`roots`, which is NOT promptable** — no `perm.decision`, however emphatic, can grant a path
outside the configured roots (proven by test: a seeded broad `allow` rule for an outside path is
still denied, and `ask` is never invoked).

I kept this deliberately, because the original brief makes it a non-negotiable and DMON-02
specifies it. The reconciliation: **roots is a containment invariant of the machine, not a risk
judgment.** The agent-loop interceptor is the single authority on *risk* and on *whether to ask*;
the daemon is the single authority on *what this process may physically touch*. They cannot
disagree about risk because the daemon never computes it. If the intended design is that the
daemon should honor an interceptor decision that reaches outside roots, that is a real conflict
with the brief and needs the user's call — **flagging, not resolving.**

## Verification performed (exercised, not asserted)

- `npx tsc --noEmit` → clean. `npx vitest run` → **69/69 green** (35 paths/config, 17 store, 17 broker).
- **RED-first evidence, both suites:**
  - `paths.test.ts` before implementation:
    `Error: Failed to load url ../permissions/paths.js ... Does the file exist?` → `Tests: no tests`
  - `store.test.ts` / `broker.test.ts` before implementation:
    `Error: Failed to load url ../permissions/store.js` / `../permissions/broker.js` → `Tests: no tests`
- **Mutation check — the boundary test has teeth:** disabling the outside-roots check
  (`if (false && !isInsideRoots(...))`) turned **4 broker tests red**, including the ask-spy proof
  that an escape never becomes promptable. Restored → 17/17 green.
- **Real junction escape, no admin:** the suite creates an actual NTFS junction
  (`fs.symlinkSync(target, path, "junction")`) inside the root pointing at an outside dir; both the
  existing-leaf and the **absent-leaf** (`<root>\jct\brand\new.txt`) cases resolve out and are
  denied. Not skipped, not mocked.
- **Ignore rules proven against REAL files:** created `.state/allowlist.json` +
  `daemon.config.json`, confirmed `git check-ignore` matches both and `git status` shows neither.

## Deviations from Plan

**1. [Rule 3 — blocking] `vitest.config.ts` added (not in the plan's file list)**
- **Found during:** Task 2 GREEN. Every suite importing `@polytoken/daemon-protocol` failed to
  load: `Failed to load url @polytoken/daemon-protocol`.
- **Root cause:** R-09 says "tsx honors tsconfig paths" — true, and `tsc` does too. But **Vite/
  vitest does not read tsconfig `paths`**, and `apps/daemon` is not a workspace tonight, so there
  is no `node_modules` symlink either. The plan had no way to run its own tests.
- **Fix:** `vitest.config.ts` with an explicit `resolve.alias`. Stays correct after the merge adds
  `apps/daemon` to `workspaces`; deletion NOT required.
- **Commit:** 5f279c8

**2. [Rule 1 — bug] `.gitignore` pattern `.state/` → `.state`**
- The plan's done-criteria (`git check-ignore apps/daemon/.state` must match) **failed**: a
  trailing-slash pattern is directory-only and cannot match a path that does not exist yet. The
  allowlist must be unstageable from the instant it appears, so the pattern is now `.state`.
- Caught only because I checked the gate against real files instead of trusting it.
- **Commit:** ac246c3

**3. [INV-2 amendment] `PermissionRule.tool` → `PermissionRule.capabilityId`**
- The plan specified `tool: z.enum([...5 names])`. The mid-execution contract amendment requires
  the allowlist to key on registry ids. Renamed and widened to an open string.
- The wire field stays frozen as `tool` in `perm.request` (it carries the registry id) — the
  protocol did not drift.

**4. [Rule 2] `toolNameSchema` imported from the protocol rather than re-declared**
- The plan had the store re-declare the 5-name enum. Two sources of truth for the tool list is the
  drift the protocol package exists to prevent. (Superseded in effect by deviation 3, which opens
  the field entirely; `riskSchema` is still imported from the protocol.)

## Notes for the orchestrator

- **`apps/daemon` is NOT a workspace tonight** (R-09). Add `"apps/daemon"` to root `workspaces` at
  merge. Everything resolves via hoisted deps + tsconfig paths + the vitest alias until then.
- **deps to install at merge:** `@types/ws ^8` is the only genuinely ABSENT package (see 65-03's
  shim + its deletion instruction). `ws`, `chokidar`, `zod`, `tsx`, `typescript`, `vitest`,
  `@types/node` are all already lockfile-pinned and hoisted — nothing to install for this plan.
- **No `apps/daemon/src/sessions/`** exists — Lane E's namespace is untouched.
- **No DB tables** requested by this plan. The allowlist is a FILE (`<stateDir>/allowlist.json`);
  the registry table remains a SCHEMA-REQUEST (see 65-03's summary).

## Self-Check: PASSED

All 13 created files exist on disk; commits ac246c3 and 5f279c8 present in `git log`.
