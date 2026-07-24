/**
 * install-schema.ts — one-shot installer for the graphile-worker schema (Track 3a, A3/D1).
 *
 * graphile-worker owns its own (volatile, internal) `graphile_worker` schema and migrates it
 * itself. We run that migration ONCE, decoupled from the always-on worker (so there is no
 * first-boot race), as `postgres` over POSTGRES_URL_NON_POOLING — the same role/URL
 * packages/db/src/migrate.ts uses. It MUST run BEFORE the `public.enqueue_job` wrapper
 * migration (which references the graphile_worker schema). Idempotent: re-running only applies
 * any new graphile-worker migrations.
 */
import { makeWorkerUtils } from "graphile-worker";

function connectionString(): string {
  const cs = process.env.GRAPHILE_WORKER_CONNECTION_STRING ?? process.env.POSTGRES_URL_NON_POOLING;
  if (!cs) {
    throw new Error("GRAPHILE_WORKER_CONNECTION_STRING (or POSTGRES_URL_NON_POOLING) is required");
  }
  return cs;
}

async function main(): Promise<void> {
  const utils = await makeWorkerUtils({ connectionString: connectionString() });
  try {
    await utils.migrate();
    // eslint-disable-next-line no-console
    console.log("graphile_worker schema installed/upgraded");
  } finally {
    await utils.release();
  }
}

main().catch((err: unknown) => {
  console.error("install_schema_fatal", err);
  process.exit(1);
});
