/**
 * enqueue-migration.test.ts — hermetic tests for the content-addressed enqueue_job migration
 * selector (../enqueue-migration). Two layers:
 *
 *  1. pure-function tests over an in-memory fixture list (no fs, no DB) — the selection,
 *     ordering, extraction, and loud-error contracts;
 *  2. a repo tripwire against the REAL packages/db/migrations directory (fs only, no DB) —
 *     fails CI the moment the wrapper migration disappears or stops being extractable, so
 *     the "loud error if none" path does not wait for the env-gated integration run to fire.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ENQUEUE_JOB_MARKER,
  migrationNumber,
  readMigrationFiles,
  selectEnqueueJobStatement,
  type MigrationFile,
} from "../enqueue-migration";

const MIGRATIONS_DIR = resolve(__dirname, "../../../../packages/db/migrations");

const wrapper = (version: string): string =>
  `CREATE OR REPLACE FUNCTION public.enqueue_job(p_identifier text) RETURNS bigint\nAS $$ BEGIN /* ${version} */ RETURN 1; END; $$;`;

/** A realistic multi-statement migration in drizzle breakpoint format (mirrors 0061's shape). */
const migration = (version: string): string =>
  [
    `-- header comment for ${version}`,
    "DO $$ BEGIN RAISE NOTICE 'ordering guard'; END $$;",
    "--> statement-breakpoint",
    wrapper(version),
    "--> statement-breakpoint",
    "REVOKE ALL ON FUNCTION public.enqueue_job(text) FROM public;",
    "--> statement-breakpoint",
    "GRANT EXECUTE ON FUNCTION public.enqueue_job(text) TO service_role;",
  ].join("\n");

const FIXTURES: ReadonlyArray<MigrationFile> = [
  { name: "0053_graphile_enqueue_wrapper.sql", text: migration("v53") },
  { name: "0054_enqueue_allowlist_morning_board.sql", text: migration("v54") },
  { name: "0060_unrelated_table.sql", text: "CREATE TABLE widgets (id uuid PRIMARY KEY);" },
  { name: "0061_enqueue_allowlist_cascade_recipe.sql", text: migration("v61") },
];

describe("migrationNumber", () => {
  it("parses the numeric prefix and rejects unprefixed names", () => {
    expect(migrationNumber("0061_enqueue_allowlist_cascade_recipe.sql")).toBe(61);
    expect(migrationNumber("10000_future.sql")).toBe(10000);
    expect(migrationNumber("meta.sql")).toBeNull();
    expect(migrationNumber("_journal.json")).toBeNull();
  });
});

describe("selectEnqueueJobStatement (pure, fixture list)", () => {
  it("picks the highest-numbered migration containing the wrapper, skipping unrelated files", () => {
    const selected = selectEnqueueJobStatement(FIXTURES);
    expect(selected.file).toBe("0061_enqueue_allowlist_cascade_recipe.sql");
    expect(selected.sql).toBe(wrapper("v61"));
  });

  it("a future CREATE OR REPLACE migration wins automatically (the anti-rot contract)", () => {
    const withFuture: ReadonlyArray<MigrationFile> = [
      ...FIXTURES,
      { name: "0062_enqueue_allowlist_widened.sql", text: migration("v62") },
    ];
    const selected = selectEnqueueJobStatement(withFuture);
    expect(selected.file).toBe("0062_enqueue_allowlist_widened.sql");
    expect(selected.sql).toBe(wrapper("v62"));
  });

  it("orders numerically, never lexicographically (10000 beats 9999)", () => {
    const selected = selectEnqueueJobStatement([
      { name: "9999_old.sql", text: migration("v9999") },
      { name: "10000_new.sql", text: migration("v10000") },
    ]);
    expect(selected.file).toBe("10000_new.sql");
  });

  it("extracts ONLY the enqueue_job statement, not the neighbors around the breakpoints", () => {
    const { sql } = selectEnqueueJobStatement(FIXTURES);
    expect(sql.startsWith(ENQUEUE_JOB_MARKER)).toBe(true);
    expect(sql).not.toContain("REVOKE");
    expect(sql).not.toContain("GRANT");
    expect(sql).not.toContain("DO $$");
  });

  it("ignores marker-bearing files without a numeric prefix", () => {
    const selected = selectEnqueueJobStatement([
      ...FIXTURES,
      { name: "scratch.sql", text: migration("v-scratch") },
    ]);
    expect(selected.file).toBe("0061_enqueue_allowlist_cascade_recipe.sql");
  });

  it("throws loudly when no migration defines the wrapper", () => {
    expect(() =>
      selectEnqueueJobStatement([{ name: "0001_init.sql", text: "CREATE TABLE t (id int);" }]),
    ).toThrow(/enqueue_job wrapper migration is missing/);
    expect(() => selectEnqueueJobStatement([])).toThrow(/enqueue_job wrapper migration is missing/);
  });
});

describe("repo tripwire (real packages/db/migrations, fs only)", () => {
  it("the repo's migrations always yield an executable enqueue_job wrapper statement", () => {
    const selected = selectEnqueueJobStatement(readMigrationFiles(MIGRATIONS_DIR));
    // No filename pin: assert content properties + a floor on the migration number so the
    // selector can only ever move FORWARD from the known-latest wrapper (0061 at time of writing).
    expect(selected.sql.startsWith(ENQUEUE_JOB_MARKER)).toBe(true);
    expect(selected.sql).toContain("graphile_worker.add_job");
    expect(selected.sql).toContain("SECURITY DEFINER");
    expect(migrationNumber(selected.file)).toBeGreaterThanOrEqual(61);
  });
});
