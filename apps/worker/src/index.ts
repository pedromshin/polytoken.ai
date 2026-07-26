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

/** Parse a positive-integer env var, falling back on empty / non-numeric / non-positive input.
 * (`??` does NOT guard an empty string: Number("") === 0 would start the worker with
 * concurrency 0, and Number("abc") === NaN — both silently wrong. This guards them.) */
function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * The in-process cron schedule (graphile-worker `crontab`, NOT cloud infra — no Terraform/
 * EventBridge, per the CLAUDE.md live-infra landmines). It fires ONCE globally at 05:00 UTC and
 * enqueues the `dispatch_morning_boards` fan-out task — which then enumerates active users and
 * enqueues one per-user `assemble_morning_board` job. The cron points at the DISPATCHER, never at
 * `assemble_morning_board` directly, because a global cron fires once and we need per-user jobs.
 * graphile-worker dedupes cron firings across multiple workers via its `known_crontabs` table.
 */
const CRONTAB = "0 5 * * * dispatch_morning_boards";

/**
 * Ship-dark gate (Phase 74). The morning-board cron only fires when
 * `MORNING_BOARD_ENABLED` is truthy — the SAME env var the listener's
 * settings read (`MORNING_BOARD_ENABLED: bool = False`), so ONE flip activates
 * both ends. Default OFF: a fresh deploy adds no crontab, so nothing is
 * enqueued nightly until the feature is turned on (no no-op job churn against a
 * darkened listener route). The `assemble_morning_board`/`dispatch_morning_boards`
 * task handlers stay registered either way — a manually-enqueued job (dev/MVP
 * verify) still runs; only the automatic schedule is gated.
 */
function morningBoardEnabled(): boolean {
  const raw = process.env.MORNING_BOARD_ENABLED;
  return raw === "true" || raw === "1";
}

async function main(): Promise<void> {
  const runner = await run({
    connectionString: connectionString(),
    taskList,
    ...(morningBoardEnabled() ? { crontab: CRONTAB } : {}),
    concurrency: envPositiveInt("WORKER_CONCURRENCY", 3),
    noHandleSignals: false,
    pollInterval: envPositiveInt("WORKER_POLL_INTERVAL_MS", 2000),
  });
  await runner.promise;
}

main().catch((err: unknown) => {
  console.error("worker_fatal", err);
  process.exit(1);
});
