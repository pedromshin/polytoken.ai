/**
 * The persistent allowlist — the ONE permission model's memory.
 *
 * This file is state that GRANTS POWER, so its rules are severe:
 * - **Fail CLOSED (T-65-07):** anything unparseable — bad JSON, a bad rule, a wrong version —
 *   yields ZERO remembered allows. It is backed up and replaced by an empty store, loudly. There
 *   is no partial salvage: a file we cannot fully understand is a file we cannot safely obey.
 * - **Atomic writes:** `<file>.tmp` then `rename` (atomic on NTFS, same volume), so a crash
 *   mid-write cannot leave a half-parsed grant. The `.tmp` is never loaded as state.
 * - **Deny beats allow**, always, regardless of insertion order.
 *
 * INV-2 (capability registry convergence): rules key on **`capabilityId`** — the registry id —
 * not on a daemon-private tool enum. Tonight every builtin capability's id IS its frozen wire
 * tool name (`fs.read`, `terminal.exec`, `git`…), so the store is already registry-keyed; when
 * `packages/capabilities` lands in Phase 68, external capability ids persist here unchanged.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { riskSchema } from "@polytoken/daemon-protocol";
import { z } from "zod";

/**
 * `scope` semantics depend on the capability family:
 * - fs.* / git → a canonical path prefix (matches the path itself and anything beneath it)
 * - terminal.exec → a case-folded executable BASENAME (R-13: the executable is permitted by NAME,
 *   since it naturally lives outside roots, e.g. C:\Program Files\nodejs\node.exe)
 */
export const permissionRuleSchema = z
  .object({
    id: z.string().min(1),
    /** INV-2: the registry id. Open string — the registry, not this file, closes the set. */
    capabilityId: z.string().min(1),
    risk: riskSchema,
    scope: z.string().min(1),
    decision: z.enum(["allow", "deny"]),
    createdAt: z.string(),
    origin: z.enum(["perm.decision", "seed", "cli"]),
  })
  .strict();

export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const allowlistFileSchema = z
  .object({
    version: z.literal(1),
    rules: z.array(permissionRuleSchema),
    /**
     * The user-facing allowlist panel's kill-switches: capability ids the user has DISABLED. A
     * disabled capability is denied at the broker BEFORE it can prompt (a stronger, blunter control
     * than a remembered per-scope rule). Absent = every capability is enabled by default (a
     * disabled set is opt-in, so an old file with no field keeps working — fail-open on ABSENCE is
     * correct here because absence means "the user disabled nothing", not "the file is corrupt";
     * a corrupt file still fail-CLOSES the whole store via loadAllowlist).
     */
    disabledCapabilities: z.array(z.string().min(1)).optional().default([]),
  })
  .strict();

export type MatchQuery = { capabilityId: string; scope: string };
export type MatchResult = "allow" | "deny" | "none";

export type AllowlistStore = {
  readonly rules: readonly PermissionRule[];
  readonly disabledCapabilities: readonly string[];
  match(q: MatchQuery): MatchResult;
  /** The /capabilities panel's enforcement: is this capability currently allowed to run at all? */
  isCapabilityEnabled(capabilityId: string): boolean;
  /** Persists, then returns a NEW store (immutability rule). */
  append(rule: PermissionRule): Promise<AllowlistStore>;
  /** Toggle a capability's kill-switch; persists, returns a NEW store. */
  setCapabilityEnabled(capabilityId: string, enabled: boolean): Promise<AllowlistStore>;
};

/** terminal.exec scopes are executable names; everything else is a path prefix. */
const isExecutableScope = (capabilityId: string): boolean => capabilityId === "terminal.exec";

/** Case-fold + drop a trailing `.exe` so "node" matches "NODE.EXE" but never "nodemon". */
const foldExecutableName = (raw: string): string => {
  const base = path.win32.basename(raw.replace(/\//g, "\\")).toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
};

/**
 * Path containment with a separator boundary — the same `path.relative` logic as paths.ts, for
 * the same reason: `startsWith` would let a rule scoped `C:\roots\a` grant `C:\roots\abc`.
 */
const scopeContainsPath = (scope: string, target: string): boolean => {
  const relative = path.win32.relative(scope.toLowerCase(), target.toLowerCase());
  if (relative === "") return true;
  if (path.win32.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith("..\\");
};

const ruleMatches = (rule: PermissionRule, q: MatchQuery): boolean => {
  if (rule.capabilityId !== q.capabilityId) return false;
  return isExecutableScope(q.capabilityId)
    ? foldExecutableName(rule.scope) === foldExecutableName(q.scope)
    : scopeContainsPath(rule.scope, q.scope);
};

const writeAtomic = async (filePath: string, contents: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, contents, "utf8");
  await fs.rename(tmpPath, filePath);
};

const makeStore = (
  filePath: string,
  rules: readonly PermissionRule[],
  disabled: readonly string[],
): AllowlistStore => {
  const disabledSet = new Set(disabled);
  const persist = (nextRules: readonly PermissionRule[], nextDisabled: readonly string[]): Promise<void> =>
    writeAtomic(
      filePath,
      JSON.stringify({ version: 1, rules: nextRules, disabledCapabilities: [...nextDisabled] }, null, 2),
    );

  return Object.freeze({
    rules: Object.freeze([...rules]),
    disabledCapabilities: Object.freeze([...disabled]),

    match(q: MatchQuery): MatchResult {
      const matching = rules.filter((rule) => ruleMatches(rule, q));
      if (matching.length === 0) return "none";
      // Deny wins ties — an explicit refusal is never overridden by a broader allow.
      return matching.some((rule) => rule.decision === "deny") ? "deny" : "allow";
    },

    isCapabilityEnabled(capabilityId: string): boolean {
      return !disabledSet.has(capabilityId);
    },

    async append(rule: PermissionRule): Promise<AllowlistStore> {
      const next = [...rules, rule];
      await persist(next, disabled);
      return makeStore(filePath, next, disabled);
    },

    async setCapabilityEnabled(capabilityId: string, enabled: boolean): Promise<AllowlistStore> {
      const nextDisabled = new Set(disabled);
      if (enabled) nextDisabled.delete(capabilityId);
      else nextDisabled.add(capabilityId);
      const nextArr = [...nextDisabled];
      await persist(rules, nextArr);
      return makeStore(filePath, rules, nextArr);
    },
  });
};

/**
 * Load the allowlist. A missing file is a normal first run (empty). A CORRUPT file is backed up
 * and treated as empty — never as a partial grant.
 */
export const loadAllowlist = async (filePath: string): Promise<AllowlistStore> => {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return makeStore(filePath, [], []);
    throw error;
  }

  const failClosed = async (reason: string): Promise<AllowlistStore> => {
    const backup = `${filePath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(filePath, backup);
    } catch {
      // If even the backup fails, we still refuse to honor the file.
    }
    console.error(
      `[daemon:permissions] allowlist at ${filePath} is unusable (${reason}). ` +
        `Failing CLOSED: starting with ZERO remembered permissions. ` +
        `The previous file was preserved at ${backup}. Every action will be asked again.`,
    );
    return makeStore(filePath, [], []);
  };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    return failClosed(`invalid JSON: ${(error as Error).message}`);
  }

  const parsed = allowlistFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return failClosed(
      `schema violation: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }

  return makeStore(filePath, parsed.data.rules, parsed.data.disabledCapabilities);
};
