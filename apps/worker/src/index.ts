/**
 * index.ts — the co-located graphile-worker entrypoint (Track 3a).
 *
 * Runs as the SECOND container in the existing ECS task (essential=false, sharing the listener
 * image via a command override — Part B / ecs.tf), so a worker crash can never take down the
 * SNS receiver. It LISTENs on the durable queue and drains jobs through `taskList`.
 */
import { run } from "graphile-worker";

import { taskList } from "./tasks";

function connectionString(): string {
  const cs = process.env.GRAPHILE_WORKER_CONNECTION_STRING ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!cs) {
    throw new Error(
      "GRAPHILE_WORKER_CONNECTION_STRING (or POSTGRES_URL_NON_POOLING) is required — the worker " +
        "needs a session-mode connection (LISTEN/NOTIFY) to the Postgres holding the graphile_worker schema.",
    );
  }
  return cs;
}

async function main(): Promise<void> {
  const runner = await run({
    connectionString: connectionString(),
    taskList,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? "3"),
    noHandleSignals: false,
    pollInterval: Number(process.env.WORKER_POLL_INTERVAL_MS ?? "2000"),
  });
  await runner.promise;
}

main().catch((err: unknown) => {
  console.error("worker_fatal", err);
  process.exit(1);
});
