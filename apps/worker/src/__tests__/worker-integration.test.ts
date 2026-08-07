/**
 * worker-integration.test.ts — proves the graphile-worker ↔ Python-HTTP seam end to end.
 *
 * Harness-gated: runs ONLY when WORKER_TEST_DATABASE_URL points at a real Postgres (a session-
 * mode connection; graphile-worker needs LISTEN/NOTIFY). It self-skips otherwise, so the default
 * `vitest run` stays hermetic. Locally we point it at a `runuser`-launched pg16 cluster:
 *   WORKER_TEST_DATABASE_URL=postgresql://postgres@localhost:5433/graphile_test npm test -w @polytoken/worker
 *
 * What it proves (the parts the fake-fetch unit test cannot):
 *  1. a job enqueued via `public.enqueue_job` is drained by `runOnce` with our taskList and
 *     POSTs the payload to the internal route;
 *  2. a route returning 500 leaves the job in the queue with attempts incremented (the retry
 *     contract graphile-worker gives us around the unchanged Python pipeline).
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeWorkerUtils, runOnce, type TaskList, type WorkerUtils } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION = process.env.WORKER_TEST_DATABASE_URL;

// The enqueue_job wrapper under test IS the migration: the CREATE OR REPLACE statement is read
// at test setup from packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql (the
// current widened allowlist — 0061 CREATE OR REPLACEs the 0054 wrapper), replacing the
// hand-synced byte-copy that used to live here and could drift from the source of truth.
// Of the migration's `--> statement-breakpoint`-separated statements only the CREATE OR
// REPLACE FUNCTION is executed — exactly what the embedded copy contained: the DO-block
// ordering guard is redundant after utils.migrate() installs the graphile_worker schema, and
// the REVOKE/GRANT trailer targets a service_role this scratch cluster does not have (grant
// posture is not what this seam test proves).
const ENQUEUE_MIGRATION_RELATIVE_PATH =
  "../../../../packages/db/migrations/0061_enqueue_allowlist_cascade_recipe.sql";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

function loadEnqueueWrapperSql(): string {
  const migrationPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ENQUEUE_MIGRATION_RELATIVE_PATH,
  );
  let raw: string;
  try {
    raw = readFileSync(migrationPath, "utf8");
  } catch (cause) {
    throw new Error(
      `worker-integration: enqueue_job migration not found at ${migrationPath} — if the ` +
        "migration was renamed or superseded by a later enqueue_job allowlist migration, " +
        "update ENQUEUE_MIGRATION_RELATIVE_PATH in this test.",
      { cause },
    );
  }
  const createStatement = raw
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .find((statement) => statement.startsWith("CREATE OR REPLACE FUNCTION public.enqueue_job"));
  if (createStatement === undefined) {
    throw new Error(
      'worker-integration: no "CREATE OR REPLACE FUNCTION public.enqueue_job" statement in ' +
        `${migrationPath} — the migration's statement shape changed; update the selection in ` +
        "loadEnqueueWrapperSql.",
    );
  }
  return createStatement;
}

interface StubServer {
  server: Server;
  url: string;
  received: Array<{ path: string; body: unknown }>;
  setStatus: (status: number) => void;
}

async function startStub(): Promise<StubServer> {
  const received: Array<{ path: string; body: unknown }> = [];
  let status = 200;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      received.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null });
      res.statusCode = status;
      res.end(status >= 400 ? "stub failure" : "ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}`, received, setStatus: (s) => (status = s) };
}

describe.skipIf(!CONNECTION)("graphile-worker → Python HTTP seam", () => {
  let utils: WorkerUtils;
  let stub: StubServer;

  const taskList: TaskList = {
    ingest_inbound_email: async (payload) => {
      const res = await fetch(`${stub.url}/v1/emails/ingest-job`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`ingest-job -> ${res.status}`);
    },
  };

  beforeAll(async () => {
    // Read inside beforeAll (not at module scope) so the hermetic default run — where the
    // whole describe self-skips without WORKER_TEST_DATABASE_URL — never touches the file.
    const enqueueWrapperSql = loadEnqueueWrapperSql();
    utils = await makeWorkerUtils({ connectionString: CONNECTION! });
    await utils.migrate();
    await utils.withPgClient(async (pg) => {
      await pg.query(enqueueWrapperSql);
      // graphile_worker.jobs is a (non-updatable) VIEW; the backing table is _private_jobs.
      await pg.query("DELETE FROM graphile_worker._private_jobs");
    });
    stub = await startStub();
  });

  afterAll(async () => {
    await utils?.release();
    await new Promise<void>((resolve) => stub?.server.close(() => resolve()));
  });

  it("drains an enqueued job and POSTs the payload to the internal route", async () => {
    stub.setStatus(200);
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('ingest_inbound_email', $1::jsonb, 8, 'ingest:ok')", [
        JSON.stringify({ ses_message_id: "m-ok" }),
      ]),
    );

    await runOnce({ connectionString: CONNECTION!, taskList });

    const forOk = stub.received.filter((r) => (r.body as { ses_message_id?: string })?.ses_message_id === "m-ok");
    expect(forOk).toHaveLength(1);
    expect(forOk[0].path).toBe("/v1/emails/ingest-job");
  });

  it("leaves the job with attempts incremented when the route returns 500", async () => {
    stub.setStatus(500);
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('ingest_inbound_email', $1::jsonb, 8, 'ingest:fail')", [
        JSON.stringify({ ses_message_id: "m-fail" }),
      ]),
    );

    await runOnce({ connectionString: CONNECTION!, taskList });

    const { rows } = await utils.withPgClient((pg) =>
      pg.query<{ attempts: number; last_error: string | null }>(
        "SELECT attempts, last_error FROM graphile_worker.jobs WHERE key = 'ingest:fail'",
      ),
    );
    expect(rows).toHaveLength(1); // still queued (not dead-lettered — max_attempts=8)
    expect(rows[0].attempts).toBe(1); // one failed attempt recorded
    expect(rows[0].last_error).toContain("500");
  });

  // MORN-01 — the allowlist (0061 wrapper) accepts the morning-board identifiers; anything else still raises.
  it("accepts the morning-board identifiers and rejects an unknown one (MORN-01)", async () => {
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('assemble_morning_board', $1::jsonb, 8, 'morn:allow:1')", [
        JSON.stringify({ user_id: "u1" }),
      ]),
    );
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('dispatch_morning_boards', '{}'::jsonb, 8, 'morn:dispatch:1')"),
    );

    const { rows } = await utils.withPgClient((pg) =>
      pg.query<{ task_identifier: string }>(
        "SELECT task_identifier FROM graphile_worker.jobs WHERE key IN ('morn:allow:1','morn:dispatch:1') ORDER BY task_identifier",
      ),
    );
    expect(rows.map((r) => r.task_identifier)).toEqual(["assemble_morning_board", "dispatch_morning_boards"]);

    await expect(
      utils.withPgClient((pg) =>
        pg.query("SELECT public.enqueue_job('not_a_task', '{}'::jsonb)"),
      ),
    ).rejects.toThrow(/unknown identifier/);
  });

  // MORN-02 — the idempotent job_key: a same-day re-enqueue REPLACES the pending job, never dupes.
  it("re-enqueuing the same morning job_key replaces rather than duplicates (MORN-02)", async () => {
    const key = "morning:user-x:2026-07-26";
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('assemble_morning_board', $1::jsonb, 8, $2)", [
        JSON.stringify({ user_id: "user-x" }),
        key,
      ]),
    );
    await utils.withPgClient((pg) =>
      pg.query("SELECT public.enqueue_job('assemble_morning_board', $1::jsonb, 8, $2)", [
        JSON.stringify({ user_id: "user-x" }),
        key,
      ]),
    );

    const { rows } = await utils.withPgClient((pg) =>
      pg.query<{ n: string }>("SELECT count(*)::text AS n FROM graphile_worker.jobs WHERE key = $1", [key]),
    );
    expect(rows[0].n).toBe("1"); // one pending job, not two
  });
});
