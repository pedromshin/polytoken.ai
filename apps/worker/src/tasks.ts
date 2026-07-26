/**
 * tasks.ts — the graphile-worker task list (Track 3a).
 *
 * The taskList IS the seam that scales past a single task: each durable job identifier maps to
 * a handler that POSTs the job payload to the co-located Python listener over localhost (an
 * internal, api-key-guarded route), off the ALB idle-timeout path. The Python pipeline is
 * UNCHANGED — graphile-worker supplies the durable queue + retries + permanent dead-letter
 * AROUND it; the job row is the durable record. A non-2xx response throws, which graphile-worker
 * treats as a failed attempt (retried up to the job's max_attempts, then dead-lettered).
 */
import type { Task, TaskList } from "graphile-worker";

/** The co-located listener base URL (same ECS task, awsvpc shared netns → localhost). */
const INTERNAL_URL = process.env.LISTENER_INTERNAL_URL ?? "http://localhost:8000";

/** POST the job payload to an internal listener route; throw on non-2xx so graphile retries. */
export async function callPython(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${INTERNAL_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // auth.py reads the api key header case-insensitively; API_KEY is a container secret.
      "x-api-key": process.env.API_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${path} -> ${res.status} ${text}`.trim());
  }
}

const ingest_inbound_email: Task = async (payload) => {
  await callPython("/v1/emails/ingest-job", payload);
};

/**
 * assemble_morning_board — one per-user job (payload `{ user_id }`). Mirrors ingest exactly:
 * POST the payload to the co-located listener's internal assembly route; a non-2xx throws so
 * graphile-worker retries → dead-letters. Same NO-SWALLOW posture as ingest (a failed nightly
 * assembly must surface as a failed job, not silently 200). The listener (Wave 2) shapes the
 * brief and writes the user's home canvas snapshot.
 */
const assemble_morning_board: Task = async (payload) => {
  await callPython("/v1/home/assemble-job", payload);
};

/** The yyyy-mm-dd (UTC) day stamp used to make a day's morning job idempotent. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The idempotent job_key for a user's morning board on a given day. graphile-worker's job_key
 * contract: a second enqueue with the SAME key REPLACES the still-pending job rather than
 * creating a duplicate — so a same-day dispatcher re-run (retry, manual re-fire) collapses to
 * one job per user per day. Format: `morning:<userId>:<yyyy-mm-dd>`.
 */
export function morningJobKey(userId: string, day: string): string {
  return `morning:${userId}:${day}`;
}

/** Enqueue seam the fan-out is tested against: identifier + payload + idempotent job_key. */
export type EnqueueFn = (identifier: string, payload: unknown, jobKey: string) => Promise<void>;

/**
 * Per-user fan-out: for each active user id, enqueue exactly one `assemble_morning_board` job
 * keyed on `morning:<userId>:<day>`. Pure over its inputs (user ids, enqueue fn, clock) so the
 * fan-out contract — N users → N jobs, deterministic idempotent keys — is unit-testable without
 * a database. Returns the number of jobs enqueued.
 */
export async function fanOutMorningBoards(
  userIds: readonly string[],
  enqueue: EnqueueFn,
  now: Date = new Date(),
): Promise<number> {
  const day = todayUtc(now);
  for (const userId of userIds) {
    await enqueue("assemble_morning_board", { user_id: userId }, morningJobKey(userId, day));
  }
  return userIds.length;
}

/**
 * SQL for "active users": owners of a home canvas board (`chat_canvas_layouts` scope='home').
 * Lowest-risk definition available to the worker's existing pg pool — it targets exactly the
 * write destination (one home row per user, mig-0046) and bounds nightly cost to users who have
 * actually engaged with /home, rather than every row in auth.users. A brand-new user gets their
 * first board on their first /home open; subsequent nights refresh it.
 */
const ACTIVE_USERS_SQL =
  "SELECT user_id FROM chat_canvas_layouts WHERE scope = 'home' AND user_id IS NOT NULL";

/**
 * dispatch_morning_boards — the cron-fired fan-out task. Uses the worker's existing pg pool
 * (graphile-worker job helpers — no new DB wiring) to (1) enumerate active users and (2) enqueue
 * one morning job each THROUGH the guarded `public.enqueue_job` wrapper (so every enqueue passes
 * the SECURITY DEFINER allowlist), with an idempotent job_key. The cron fires this ONCE globally;
 * the per-user jobs it enqueues are what actually assemble each board.
 */
const dispatch_morning_boards: Task = async (_payload, helpers) => {
  const { rows } = await helpers.query<{ user_id: string }>(ACTIVE_USERS_SQL);
  const userIds = rows.map((r) => r.user_id);
  const enqueued = await fanOutMorningBoards(userIds, async (identifier, payload, jobKey) => {
    await helpers.query("SELECT public.enqueue_job($1, $2::jsonb, 8, $3)", [
      identifier,
      JSON.stringify(payload),
      jobKey,
    ]);
  });
  helpers.logger.info(`dispatch_morning_boards: enqueued ${enqueued} morning-board job(s)`);
};

/**
 * The durable job identifiers. Kept in lock-step with the `public.enqueue_job` allowlist
 * (packages/db migration) and the listener's internal routes. `deep_research` is added with
 * A9 (its `/v1/research/run-job` route + turn-detach are Part B). `dispatch_morning_boards`
 * (cron fan-out) + `assemble_morning_board` (per-user) are added with Phase 74.
 */
export const taskList: TaskList = {
  ingest_inbound_email,
  assemble_morning_board,
  dispatch_morning_boards,
};
