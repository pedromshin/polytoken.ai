/**
 * enqueue-migration.ts — content-addressed selection of the latest `public.enqueue_job`
 * wrapper migration (test support for worker-integration.test.ts).
 *
 * Pinning a migration by FILENAME (e.g. 0061_…) rots silently: a future 0062 that
 * CREATE OR REPLACEs enqueue_job would leave the integration test validating stale SQL with
 * no failure anywhere. Instead the test enumerates packages/db/migrations/*.sql and this
 * module picks the HIGHEST-numbered file whose text contains the wrapper marker, then
 * extracts that single statement via drizzle's `--> statement-breakpoint` separators (same
 * split idiom as packages/db/src/entity-resolution-dismiss.test.ts).
 *
 * The selector is a pure function over an in-memory file list — hermetically tested in
 * __tests__/enqueue-migration.test.ts. It lives in src/ (not __tests__/) so
 * `npm run typecheck -w @polytoken/worker` covers it (tsconfig excludes __tests__).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The content marker that identifies an enqueue_job wrapper (re)definition. */
export const ENQUEUE_JOB_MARKER = "CREATE OR REPLACE FUNCTION public.enqueue_job";

/** drizzle-kit's statement separator inside generated migration files. */
export const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export interface MigrationFile {
  readonly name: string;
  readonly text: string;
}

export interface EnqueueJobStatement {
  readonly file: string;
  readonly sql: string;
}

/** Numeric migration prefix (`0061_foo.sql` → 61); null when the name has no `NNNN_` prefix. */
export function migrationNumber(name: string): number | null {
  const match = /^(\d+)_/.exec(name);
  return match === null ? null : Number.parseInt(match[1], 10);
}

/**
 * Pick the HIGHEST-numbered migration whose text contains the enqueue_job wrapper and extract
 * that statement. Ordering is NUMERIC on the filename prefix (never lexicographic — `10000_`
 * must beat `9999_`). Throws loudly when no migration defines the wrapper: the integration
 * test must never run against an implicit/absent function definition.
 */
export function selectEnqueueJobStatement(files: ReadonlyArray<MigrationFile>): EnqueueJobStatement {
  const latest = files
    .filter((f) => migrationNumber(f.name) !== null && f.text.includes(ENQUEUE_JOB_MARKER))
    .reduce<MigrationFile | null>(
      (best, f) =>
        best === null || (migrationNumber(f.name) ?? -1) > (migrationNumber(best.name) ?? -1) ? f : best,
      null,
    );
  if (latest === null) {
    throw new Error(
      `enqueue-migration: no numbered migration contains "${ENQUEUE_JOB_MARKER}" ` +
        `(searched ${files.length} file(s)) — the enqueue_job wrapper migration is missing or was renamed`,
    );
  }
  const statement = latest.text.split(STATEMENT_BREAKPOINT).find((part) => part.includes(ENQUEUE_JOB_MARKER));
  if (statement === undefined) {
    throw new Error(`enqueue-migration: ${latest.name} contains the marker but no extractable statement`);
  }
  return { file: latest.name, sql: statement.trim() };
}

/** Enumerate the .sql migration files in a directory (impure shell around the pure selector). */
export function readMigrationFiles(dir: string): ReadonlyArray<MigrationFile> {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}
