-- Phase 74 (Plan 74-01) — extend public.enqueue_job's identifier allowlist for the
-- self-assembling morning board. FORWARD, ADDITIVE migration: it CREATE OR REPLACEs the
-- 0053 wrapper verbatim and only WIDENS the allowlist array — no schema change, no drop,
-- no data change. Do NOT edit 0053 in place (this supersedes it via replace).
--
-- New identifiers:
--   assemble_morning_board — one per-user job the worker drains → POST /v1/home/assemble-job.
--   dispatch_morning_boards — the cron-fired fan-out task that enumerates active users and
--     enqueues one assemble_morning_board job each (idempotent job_key). Listed here so the
--     dispatcher can also be enqueued through the same guarded seam (defense-in-depth; the
--     graphile-worker crontab enqueues it internally, but a manual re-enqueue still routes
--     through enqueue_job).
--
-- Same posture as 0053: SECURITY DEFINER (add_job needs owner privileges), REVOKE from public,
-- GRANT to service_role. Files-only here — applied to the live DB by Pedro, never by this
-- workflow (the enqueue_job allowlist is a privileged-function change).

-- Ordering guard: fail loudly if the graphile_worker schema was not installed first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE EXCEPTION 'enqueue_job migration: graphile_worker schema is absent — run apps/worker install-schema (runMigrations) BEFORE applying this migration';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_identifier   text,
  p_payload      jsonb,
  p_max_attempts integer DEFAULT 8,
  p_job_key      text    DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, graphile_worker
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_identifier NOT IN (
    'ingest_inbound_email',
    'deep_research',
    'assemble_morning_board',   -- Phase 74: per-user morning board assembly
    'dispatch_morning_boards'   -- Phase 74: cron-fired per-user fan-out
  ) THEN   -- allowlist; extend per task
    RAISE EXCEPTION 'enqueue_job: unknown identifier %', p_identifier;
  END IF;
  SELECT (graphile_worker.add_job(
    p_identifier, p_payload::json, max_attempts := p_max_attempts, job_key := p_job_key
  )).id INTO v_id;
  RETURN v_id;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.enqueue_job(text, jsonb, integer, text) FROM public;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.enqueue_job(text, jsonb, integer, text) TO service_role;
