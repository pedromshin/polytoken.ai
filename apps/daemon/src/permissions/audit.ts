/**
 * The audit trail (T-65-08) — append-only JSONL at `<stateDir>/audit.jsonl`.
 *
 * Redaction here is STRUCTURAL, not a filter: the entry type simply has no field that could hold
 * file contents or the token, and `meta` accepts only numbers and booleans (byte counts, exit
 * codes, flags — never strings). You cannot leak what you cannot express. A regex-scrubbing
 * approach would be one careless caller away from writing a secret to disk.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type AuditEntry = {
  readonly event: "decision" | "execution";
  /** The registry id (INV-2). */
  readonly capabilityId: string;
  readonly scope: string;
  readonly verdict?: "allow" | "deny";
  readonly code?: string;
  /** Numbers and flags ONLY — no strings, so no content and no secrets. */
  readonly meta?: Record<string, number | boolean>;
};

export type AuditLog = { record(entry: AuditEntry): Promise<void> };

export const createAuditLog = (filePath: string): AuditLog => {
  let ensured: Promise<void> | null = null;

  const ensureDir = (): Promise<void> => {
    ensured ??= fs.mkdir(path.dirname(filePath), { recursive: true }).then(() => undefined);
    return ensured;
  };

  return Object.freeze({
    async record(entry: AuditEntry): Promise<void> {
      await ensureDir();
      const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
      try {
        await fs.appendFile(filePath, `${line}\n`, "utf8");
      } catch (error) {
        // A failed audit write must not sink a denial: log and carry on. The verdict still holds.
        console.error(`[daemon:audit] could not write audit line: ${(error as Error).message}`);
      }
    },
  });
};
