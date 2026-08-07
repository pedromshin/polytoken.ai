/**
 * index.ts — the co-located graphile-worker entrypoint (Track 3a).
 *
 * Runs as the SECOND container in the existing ECS task (essential=false — ecs.tf) from its own
 * DEDICATED image (apps/worker/Dockerfile → ECR nauta-services-email-worker; the listener image
 * is Python-only), so a worker crash can never take down the SNS receiver. It LISTENs on the
 * durable queue and drains jobs through `taskList`.
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
 * EventBridge, per the CLAUDE.md live-infra landmines). Each line fires ONCE globally and
 * enqueues a DISPATCHER task — never a per-user/per-recipe task directly, because a global cron
 * fires once and the dispatcher fans out the per-row jobs. graphile-worker dedupes cron firings
 * across multiple workers via its `known_crontabs` table.
 *   - 05:00 UTC `dispatch_morning_boards` (Phase 74): enumerates active users and enqueues one
 *     `assemble_morning_board` job each.
 *   - every 15 min `dispatch_recipe_recomputes` (Phase 73 Wave C, LCAN-09): enumerates
 *     source-bearing `canvas_recipes` rows and enqueues one `recompute_canvas_recipe` job each.
 */
const MORNING_CRONTAB_LINE = "0 5 * * * dispatch_morning_boards";
const RECIPE_CRONTAB_LINE = "*/15 * * * * dispatch_recipe_recomputes";

/** The shared truthy-env convention both ship-dark gates read. */
function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  return raw === "true" || raw === "1";
}

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
  return envFlagEnabled("MORNING_BOARD_ENABLED");
}

/**
 * Ship-dark gate (Phase 73 Wave C, LCAN-09). Same posture as the morning board:
 * `RECIPE_RECOMPUTE_ENABLED` default OFF — a fresh deploy adds no recompute
 * crontab line, so no recipe is re-polled until the feature is turned on. The
 * `recompute_canvas_recipe`/`dispatch_recipe_recomputes` handlers stay registered
 * either way (a manually-enqueued job still runs — the live-verification seam);
 * only the automatic schedule is gated.
 */
function recipeRecomputeEnabled(): boolean {
  return envFlagEnabled("RECIPE_RECOMPUTE_ENABLED");
}

/** The composed crontab: only the ENABLED lines, or undefined when everything is dark
 * (graphile-worker then runs with no schedule at all — exactly today's default). */
function crontab(): string | undefined {
  const lines = [
    ...(morningBoardEnabled() ? [MORNING_CRONTAB_LINE] : []),
    ...(recipeRecomputeEnabled() ? [RECIPE_CRONTAB_LINE] : []),
  ];
  return lines.length > 0 ? lines.join("\n") : undefined;
}

async function main(): Promise<void> {
  const schedule = crontab();
  const runner = await run({
    connectionString: connectionString(),
    taskList,
    ...(schedule !== undefined ? { crontab: schedule } : {}),
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
