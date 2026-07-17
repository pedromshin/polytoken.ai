/**
 * The ONE decision point (T-65-06).
 *
 * EVERY tool execution consults `decide()`. The executors (65-03) receive ONLY the broker, never
 * the store — there is no path around this function, by construction rather than by call-site
 * discipline.
 *
 * INV-4 (risk is DATA, not code): `risk` arrives from the capability descriptor and is passed
 * through to the prompt. No capability implements its own confirm flow; the prompt renders from
 * this field. That is what makes "ONE permission model" true rather than aspirational.
 *
 * INV-2: queries key on `capabilityId` (the registry id), not a private tool enum.
 *
 * `ask` is INJECTED (transport-agnostic): 65-03 supplies the WS implementation, tests supply
 * spies. The permission core never imports a socket.
 */
import { randomUUID } from "node:crypto";
import type { PermRequestPayload, Risk } from "@polytoken/daemon-protocol";

import type { DaemonConfig } from "../config.js";
import type { AuditLog } from "./audit.js";
import { canonicalizePath, isInsideRoots } from "./paths.js";
import type { AllowlistStore, PermissionRule } from "./store.js";

export type Verdict =
  | { readonly kind: "allow" }
  | {
      readonly kind: "deny";
      readonly code: "outside_roots" | "permission_denied" | "permission_timeout";
      readonly message: string;
    };

/** Resolves to the decision, or to `null` when nobody answered (timeout / no clients). */
export type AskFn = (
  req: PermRequestPayload,
) => Promise<{ allow: boolean; remember: boolean } | null>;

export type DecideQuery = {
  /** INV-2: the registry id. */
  readonly capabilityId: string;
  /** INV-4: comes from the descriptor, drives the prompt. */
  readonly risk: Risk;
  /** What a remembered rule would be scoped to: a path (fs/git) or an executable name (terminal). */
  readonly scope: string;
  /** Every path this action would touch. ALL must be inside roots or the action dies here. */
  readonly pathsToCheck: readonly string[];
  /** Echoed to the prompt so the user sees what they are approving. Never persisted. */
  readonly args?: unknown;
};

export type PermissionBroker = { decide(q: DecideQuery): Promise<Verdict> };

const deny = (
  code: Extract<Verdict, { kind: "deny" }>["code"],
  message: string,
): Verdict => ({ kind: "deny", code, message });

export const createPermissionBroker = (opts: {
  config: DaemonConfig;
  store: AllowlistStore;
  ask: AskFn;
  audit: AuditLog;
}): PermissionBroker => {
  const { config, ask, audit } = opts;

  // The single sanctioned mutation point, contained in this closure: the store is a value, and
  // remembering a decision rebinds it. Nothing outside can reach it.
  let store = opts.store;

  const finish = async (q: DecideQuery, verdict: Verdict): Promise<Verdict> => {
    await audit.record({
      event: "decision",
      capabilityId: q.capabilityId,
      scope: q.scope,
      verdict: verdict.kind === "allow" ? "allow" : "deny",
      ...(verdict.kind === "deny" ? { code: verdict.code } : {}),
    });
    return verdict;
  };

  /** Race the ask against the timeout. The broker owns the clock — an AskFn cannot hang the daemon. */
  const askWithTimeout = async (
    req: PermRequestPayload,
  ): Promise<{ allow: boolean; remember: boolean } | null> => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), config.permTimeoutMs);
      // Do not hold the event loop open on account of a prompt nobody is answering.
      timer.unref?.();
    });

    try {
      return await Promise.race([ask(req), timeout]);
    } finally {
      // Cleared on BOTH paths — a stray timer is an open handle that hangs vitest and leaks in prod.
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  return Object.freeze({
    async decide(q: DecideQuery): Promise<Verdict> {
      // ── STEP 1: canonicalize. A path we cannot resolve is a path we cannot reason about. ──
      const canonical: string[] = [];
      for (const raw of q.pathsToCheck) {
        const result = canonicalizePath(raw);
        if (!result.ok) {
          return finish(
            q,
            deny("outside_roots", `path "${raw}" is not a usable path: ${result.reason}`),
          );
        }
        canonical.push(result.path);
      }

      // ── STEP 2: the hard boundary. NOT PROMPTABLE (T-65-06). ──
      // This runs BEFORE the allowlist and before any ask. Prompting here would normalize an
      // escape into something the user can click "allow" on; no rule, however broad, may grant
      // a path outside roots. Reordering this below step 3 or 4 is the regression to fear.
      for (const target of canonical) {
        if (!isInsideRoots(target as never, config.roots)) {
          return finish(
            q,
            deny(
              "outside_roots",
              `${target} is outside every configured root. This is not promptable — ` +
                `add the path to "roots" in daemon.config.json if you intend to allow it.`,
            ),
          );
        }
      }

      // ── STEP 3: remembered decisions. Explicit deny beats allow. ──
      const remembered = store.match({ capabilityId: q.capabilityId, scope: q.scope });
      if (remembered === "deny") {
        return finish(
          q,
          deny("permission_denied", `a remembered rule denies ${q.capabilityId} on ${q.scope}`),
        );
      }
      if (remembered === "allow") return finish(q, { kind: "allow" });

      // ── STEP 4: ask. Silence is never consent (T-65-09). ──
      const answer = await askWithTimeout({
        tool: q.capabilityId, // the wire field is frozen as `tool`; it carries the registry id
        args: q.args ?? null,
        risk: q.risk, // INV-4: straight from the descriptor
      });

      if (answer === null) {
        return finish(
          q,
          deny(
            "permission_timeout",
            `nobody answered the permission request for ${q.capabilityId} on ${q.scope} within ` +
              `${config.permTimeoutMs}ms — denied. Silence is not consent.`,
          ),
        );
      }

      if (answer.remember) {
        const rule: PermissionRule = {
          id: randomUUID(),
          capabilityId: q.capabilityId,
          risk: q.risk,
          scope: q.scope,
          decision: answer.allow ? "allow" : "deny",
          createdAt: new Date().toISOString(),
          origin: "perm.decision",
        };
        // Persist BEFORE returning: a grant the user approved must survive a crash one tick later.
        store = await store.append(rule);
      }

      return finish(
        q,
        answer.allow
          ? { kind: "allow" }
          : deny("permission_denied", `permission denied for ${q.capabilityId} on ${q.scope}`),
      );
    },
  });
};
