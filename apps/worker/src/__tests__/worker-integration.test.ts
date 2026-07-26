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
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { makeWorkerUtils, runOnce, type TaskList, type WorkerUtils } from "graphile-worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CONNECTION = process.env.WORKER_TEST_DATABASE_URL;

const ENQUEUE_WRAPPER_SQL = `
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_identifier text, p_payload jsonb, p_max_attempts integer DEFAULT 8, p_job_key text DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, graphile_worker AS $$
DECLARE v_id bigint;
BEGIN
  IF p_identifier NOT IN (
    'ingest_inbound_email', 'deep_research', 'assemble_morning_board', 'dispatch_morning_boards'
  ) THEN
    RAISE EXCEPTION 'enqueue_job: unknown identifier %', p_identifier;
  END IF;
  SELECT (graphile_worker.add_job(p_identifier, p_payload::json, max_attempts := p_max_attempts, job_key := p_job_key)).id INTO v_id;
  RETURN v_id;
END; $$;`;

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
    utils = await makeWorkerUtils({ connectionString: CONNECTION! });
    await utils.migrate();
    await utils.withPgClient(async (pg) => {
      await pg.query(ENQUEUE_WRAPPER_SQL);
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

  // MORN-01 — the 0054 allowlist accepts the two new identifiers; anything else still raises.
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
