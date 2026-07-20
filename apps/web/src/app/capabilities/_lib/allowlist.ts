"use client";

/**
 * allowlist.ts — the per-user capability allowlist, CLIENT-persisted (deliberate seam).
 *
 * ## Why localStorage and not a tRPC get/set pair
 *
 * There is no per-user settings table in `@polytoken/db` today, and this wave cannot run a
 * migration. A `capabilities.allowlist` procedure pair that pretended to persist would be
 * dishonest, so persistence lives here for now. The hook's surface (`isAllowed`/`setAllowed`/
 * `hydrated`) is shaped so that swapping the storage backend for the future
 * `api.capabilities.allowlist.get/set` procedures (keyed on `ctx.user.id` server-side) touches
 * ONLY this file — see the seam note in
 * `packages/api-client/src/router/capabilities/index.ts`.
 *
 * ## Storage shape — denials only
 *
 * The store records ONLY `id -> false`. A missing id means allowed: "default allowed" is
 * structural, not a boolean convention someone can get backwards, and a capability that
 * registers tomorrow arrives switched on without a store migration. Toggling something back on
 * DELETES its key.
 *
 * NOTE: this is a UI preference surface today — the daemon's own permission broker and the chat
 * loop do not read this store yet (that wiring is the panel's next slice). Nothing here grants
 * anything; it can only record the user's intent to narrow.
 */
import * as React from "react";

const STORAGE_KEY = "polytoken.capability-allowlist.v1";

/** id -> false for every switched-off capability. Never stores `true`. */
type DenialStore = Readonly<Record<string, false>>;

/** Parse defensively: any non-object / corrupt value degrades to "nothing denied". */
function readStore(): DenialStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const denials: Record<string, false> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (value === false) denials[id] = false;
    }
    return denials;
  } catch {
    return {};
  }
}

function writeStore(denials: DenialStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(denials));
  } catch {
    // Quota/private-mode failure: the in-memory state still reflects the choice
    // for this session; nothing to surface beyond that.
  }
}

export type CapabilityAllowlist = {
  /** False until the first client read — render switches disabled before this flips. */
  readonly hydrated: boolean;
  /** Default-allowed: only an explicit denial returns false. */
  readonly isAllowed: (id: string) => boolean;
  readonly setAllowed: (id: string, allowed: boolean) => void;
  /** How many capabilities are currently switched off (for the summary line). */
  readonly deniedCount: number;
};

export function useCapabilityAllowlist(): CapabilityAllowlist {
  // null = not yet hydrated (SSR renders nothing stateful, avoiding a mismatch flash).
  const [denials, setDenials] = React.useState<DenialStore | null>(null);

  React.useEffect(() => {
    setDenials(readStore());
    // Cross-tab sync: another tab's toggle lands here without a reload.
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setDenials(readStore());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAllowed = React.useCallback((id: string, allowed: boolean) => {
    setDenials((prev) => {
      const next: Record<string, false> = { ...(prev ?? {}) };
      if (allowed) {
        delete next[id];
      } else {
        next[id] = false;
      }
      writeStore(next);
      return next;
    });
  }, []);

  const isAllowed = React.useCallback(
    (id: string) => (denials === null ? true : denials[id] !== false),
    [denials],
  );

  return {
    hydrated: denials !== null,
    isAllowed,
    setAllowed,
    deniedCount: denials === null ? 0 : Object.keys(denials).length,
  };
}
