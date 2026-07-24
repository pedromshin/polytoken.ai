-- Track 3a — public.enqueue_job: the single generic durable-enqueue wrapper over
-- graphile-worker's add_job. The application layer (Python JobEnqueuer) calls ONLY this
-- function; every durable task (ingestion, deep_research) enqueues through it.
--
-- REQUIRES the graphile_worker schema to already exist: apps/worker `install-schema`
-- (runMigrations) MUST run BEFORE this migration (see the Part-B runbook, step P3). The
-- guard below RAISEs loudly if it was skipped.
--
-- PROVEN against a real pg16 + graphile-worker 0.17.3 cluster stood up in-container: the
-- (add_job(...)).id shape returns the job id, an enqueue lands exactly one graphile_worker
-- job row, job_key makes a re-enqueue idempotent (replaces the pending job), the allowlist
-- rejects unknown identifiers, and the service_role GRANT lets the nologin role call it.
-- Files-only here — applied to the live DB by Pedro (P3), never by this workflow.

-- Ordering guard: fail loudly if the graphile_worker schema was not installed first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphile_worker') THEN
    RAISE EXCEPTION 'enqueue_job migration: graphile_worker schema is absent — run apps/worker install-schema (runMigrations) BEFORE applying this migration';
  END IF;
END $$;
--> statement-breakpoint
-- Deviation from the repo RPC convention (0009/0017 are SECURITY INVOKER so RLS applies):
-- add_job REQUIRES owner privileges, so this is SECURITY DEFINER. Internal enqueue seam,
-- called only by service_role (which already bypasses RLS); callers authorize BEFORE enqueue.
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
  IF p_identifier NOT IN ('ingest_inbound_email', 'deep_research') THEN   -- allowlist; extend per task
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
