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
 * The durable job identifiers. Kept in lock-step with the `public.enqueue_job` allowlist
 * (packages/db migration) and the listener's internal routes. `deep_research` is added with
 * A9 (its `/v1/research/run-job` route + turn-detach are Part B).
 */
export const taskList: TaskList = {
  ingest_inbound_email,
};
