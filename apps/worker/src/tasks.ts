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
 * cascade_relabel — Phase 75 (75-04), the correction-flywheel re-label fan-out. The listener's
 * `CascadeCorrectionUseCase` enqueues one job per confirmed merge (identifier
 * `_RELABEL_IDENTIFIER = "cascade_relabel"`, job_key `cascade:{survivor}:{absorbed}`, payload
 * `{ survivor_id, absorbed_id, email_ids }`). Mirrors ingest exactly: POST the payload unchanged
 * to the co-located listener's internal relabel route; a non-2xx throws so graphile-worker
 * retries → dead-letters. NO-SWALLOW: a failed re-label must surface as a failed job.
 */
const cascade_relabel: Task = async (payload) => {
  await callPython("/v1/emails/relabel-job", payload);
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

// ===========================================================================
// Phase 73 Wave C (LCAN-09) — durable after-close recipe recompute
// ===========================================================================
//
// A `canvas_recipes` row stores a `source_ref` re-poll descriptor (persisted opaque by the
// canvas-recipes router; THIS seam defines its shape). The worker re-polls the named read,
// re-projects it with the SAME bounds the UI publish port applies
// (apps/web/src/app/chat/_canvas/canvas-publish.ts — mirrored here because the worker cannot
// import from apps/web), and bumps the published value at `shared.published.{nodeId}` inside
// `chat_canvas_layouts.shared_state` — the exact slot the UI's `useCanvasPublish` writes and
// `usePanelData`/`resolveCanvasPath` resolves — so the tile shows the newer value on next open.
//
// LWW discipline (vNEXT roadmap landmine): the write is ONE atomic single-key `jsonb_set`
// UPDATE, never a whole-blob save, and it enforces the canvas-schema.ts sharedState size cap
// in SQL so a worker bump can never push the blob over the cap and get the UI's next save
// refused. An OPEN tab's debounced whole-blob save can still overwrite the bump — the recorded
// LWW race — but LCAN-09 is defined for the tab-CLOSED window, where no such save exists.

/** Forbidden jsonb/store keys (mirrors the FORBIDDEN_KEYS pollution guard the UI save path
 * re-validates — a worker-written key must never make the next UI save fail validation). */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A named re-poll read: re-fetch one spreadsheet row and publish its bounded projection
 * under the given canvas node id. The ONLY read kind implemented so far — the descriptor is
 * versioned + discriminated so further kinds extend the union without a migration. */
export interface SpreadsheetSourceRead {
  readonly kind: "spreadsheet";
  /** The canvas node whose `shared.published.{nodeId}` slot this read bumps. ONE dotted-path
   * segment — dots are rejected at parse (they would split the resolution path). */
  readonly nodeId: string;
  readonly spreadsheetId: string;
}
export type RecipeSourceRead = SpreadsheetSourceRead;

/** The durable re-poll descriptor persisted in `canvas_recipes.source_ref` (LCAN-09). */
export interface RecipeSourceRef {
  readonly version: 1;
  readonly reads: readonly RecipeSourceRead[];
}

/**
 * parseRecipeSourceRef — fail-closed narrowing of the opaque jsonb descriptor at the worker
 * boundary (this package carries no zod; the checks are explicit). Throws on ANY malformed
 * shape so graphile-worker records the failure (retry → dead-letter) rather than silently
 * skipping a recipe the user believes is alive.
 */
export function parseRecipeSourceRef(value: unknown): RecipeSourceRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("source_ref: expected an object descriptor");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`source_ref: unsupported version ${String(record.version)}`);
  }
  if (!Array.isArray(record.reads)) {
    throw new Error("source_ref: reads must be an array");
  }
  return { version: 1, reads: record.reads.map((read, i) => parseRead(read, i)) };
}

function parseRead(value: unknown, index: number): RecipeSourceRead {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`source_ref.reads[${index}]: expected an object`);
  }
  const read = value as Record<string, unknown>;
  if (read.kind !== "spreadsheet") {
    throw new Error(`source_ref.reads[${index}]: unknown read kind ${String(read.kind)}`);
  }
  const { nodeId, spreadsheetId } = read;
  if (
    typeof nodeId !== "string" ||
    nodeId.length === 0 ||
    nodeId.length > 512 ||
    nodeId.includes(".") ||
    FORBIDDEN_KEYS.has(nodeId)
  ) {
    throw new Error(`source_ref.reads[${index}]: nodeId must be a non-empty dot-free key`);
  }
  if (typeof spreadsheetId !== "string" || !UUID_RE.test(spreadsheetId)) {
    throw new Error(`source_ref.reads[${index}]: spreadsheetId must be a uuid`);
  }
  return { kind: "spreadsheet", nodeId, spreadsheetId };
}

// Publish bounds — MIRRORED from apps/web/src/app/chat/_canvas/canvas-publish.ts (the worker
// cannot import apps/web). A published value is a glanceable SUMMARY, never a full dataset.
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_STRING_LEN = 2_000;
const MAX_SERIALIZED_BYTES = 8_192;
/** The whole-blob cap canvas-schema.ts enforces on every UI save — the SQL write below
 * re-enforces it so a worker bump can never make the UI's next save refuse. */
const MAX_SHARED_STATE_SERIALIZED_CHARS = 100_000;

/** Bounded JSON-only clamp (mirror of canvas-publish.ts `projectForPublish`): caps depth,
 * breadth, string length and total size; drops non-JSON values and forbidden keys. Returns
 * `undefined` when the value cannot be represented within bounds. Pure. */
export function projectForPublish(value: unknown): unknown {
  const clamped = clamp(value, 0);
  if (clamped === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(clamped);
  } catch {
    return undefined; // circular / unserializable after clamp — skip
  }
  if (serialized === undefined) return undefined;
  if (Buffer.byteLength(serialized, "utf8") > MAX_SERIALIZED_BYTES) return undefined;
  return clamped;
}

function clamp(value: unknown, depth: number): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return (value as string).slice(0, MAX_STRING_LEN);
  if (t === "number") return Number.isFinite(value) ? value : undefined;
  if (t === "boolean") return value;
  if (t === "bigint") return Number(value as bigint);
  if (t === "function" || t === "symbol" || t === "undefined") return undefined;

  if (depth >= MAX_DEPTH) return undefined; // too deep — prune this branch

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const c = clamp(item, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }
  if (t === "object") {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (kept >= MAX_OBJECT_KEYS) break;
      if (FORBIDDEN_KEYS.has(key)) continue;
      const c = clamp(v, depth + 1);
      if (c === undefined) continue;
      out[key] = c;
      kept += 1;
    }
    return out;
  }
  return undefined;
}

/** The UI sheet projection's sample cap (mirror of spreadsheet-publish.ts). */
const PUBLISH_SAMPLE_ROWS = 8;

/**
 * projectSpreadsheetForPublish — the worker-side mirror of the UI's
 * `projectSheetForPublish` (spreadsheet-publish.ts): `{ label, columns, rowCount, sample }`,
 * SHAPE + small sample, never the full sheet — so a wired tile shows the SAME projection
 * whether the UI or the worker published it. Defensive over raw jsonb: junk columns are
 * dropped, non-array rows read as empty. Pure.
 */
export function projectSpreadsheetForPublish(row: {
  readonly title: unknown;
  readonly columns: unknown;
  readonly rows: unknown;
}): unknown {
  const label = typeof row.title === "string" ? row.title : "Untitled table";
  const columns = (Array.isArray(row.columns) ? row.columns : []).flatMap((col: unknown) => {
    if (typeof col !== "object" || col === null) return [];
    const { name, type } = col as Record<string, unknown>;
    if (typeof name !== "string" || typeof type !== "string") return [];
    return [{ name, type }];
  });
  const rows = Array.isArray(row.rows) ? row.rows : [];
  const sample = rows.slice(0, PUBLISH_SAMPLE_ROWS).flatMap((r: unknown) => {
    if (typeof r !== "object" || r === null) return [];
    const data = (r as Record<string, unknown>).data;
    return typeof data === "object" && data !== null ? [data] : [];
  });
  return projectForPublish({ label, columns, rowCount: rows.length, sample });
}

/** The minimal query seam both recompute functions run over — structurally satisfied by
 * graphile-worker's `helpers.query` and by a unit-test stub. */
export type QueryFn = (
  text: string,
  values?: unknown[],
) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** One published-value write: land `projection` at `shared.published.{nodeId}` on the
 * conversation's layout row. Returns false when nothing landed (missing row / cap tripped). */
export interface ProjectionWriteArgs {
  readonly conversationId: string;
  readonly nodeId: string;
  readonly projection: unknown;
}
export type ProjectionWriter = (args: ProjectionWriteArgs) => Promise<boolean>;

/**
 * The single-key patch. A CTE computes the patched blob (creating the `shared` →
 * `published` parents when absent), then ONE atomic UPDATE lands it — guarded by the
 * canvas-schema.ts serialized-size cap so the worker can never push `shared_state` past what
 * the UI's own save validation would accept. RETURNING distinguishes landed/refused.
 */
const PUBLISH_PROJECTION_SQL = `
  WITH patched AS (
    SELECT id,
           jsonb_set(
             jsonb_set(
               jsonb_set(
                 COALESCE(shared_state, '{}'::jsonb),
                 '{shared}',
                 COALESCE(shared_state -> 'shared', '{}'::jsonb),
                 true
               ),
               '{shared,published}',
               COALESCE(shared_state -> 'shared' -> 'published', '{}'::jsonb),
               true
             ),
             ARRAY['shared', 'published', $2::text],
             $3::jsonb,
             true
           ) AS next_state
      FROM chat_canvas_layouts
     WHERE conversation_id = $1
  )
  UPDATE chat_canvas_layouts AS l
     SET shared_state = p.next_state,
         updated_at = now()
    FROM patched AS p
   WHERE l.id = p.id
     AND length(p.next_state::text) <= ${MAX_SHARED_STATE_SERIALIZED_CHARS}
  RETURNING l.id
`;

/** The production ProjectionWriter over a QueryFn (helpers.query in the task handler). */
export function makeProjectionWriter(query: QueryFn): ProjectionWriter {
  return async ({ conversationId, nodeId, projection }) => {
    const result = await query(PUBLISH_PROJECTION_SQL, [
      conversationId,
      nodeId,
      JSON.stringify(projection),
    ]);
    return result.rows.length > 0;
  };
}

/** Dependencies of one recompute run — injected so the contract is unit-testable sans DB. */
export interface RecipeRecomputeDeps {
  readonly query: QueryFn;
  readonly writeProjection: ProjectionWriter;
  readonly log: (message: string) => void;
}

/**
 * recomputeCanvasRecipe — one recipe's re-poll + republish. Returns how many published
 * values were bumped. Posture:
 *   - recipe row gone / `source_ref` NULL → clean no-op (deleted-or-unbound between dispatch
 *     and drain is a legitimate state, not a failure);
 *   - malformed descriptor, missing/un-owned source, refused write → THROW (fail loudly so
 *     graphile retries → dead-letters; a silently-stale "live" recipe is the worst outcome).
 * Every source read re-asserts ownership IN SQL (id AND the recipe row's user_id) — the
 * worker's DB role sees every row, so tenancy is re-derived from the recipe, never assumed.
 */
export async function recomputeCanvasRecipe(
  recipeId: string,
  deps: RecipeRecomputeDeps,
): Promise<number> {
  const { rows } = await deps.query(
    "SELECT id, user_id, conversation_id, source_ref FROM canvas_recipes WHERE id = $1",
    [recipeId],
  );
  const recipe = rows[0];
  if (recipe === undefined) {
    deps.log(`recompute_canvas_recipe: recipe ${recipeId} no longer exists — nothing to do`);
    return 0;
  }
  if (recipe.source_ref === null || recipe.source_ref === undefined) {
    deps.log(`recompute_canvas_recipe: recipe ${recipeId} has no source_ref — nothing to re-poll`);
    return 0;
  }
  const userId = recipe.user_id;
  const conversationId = recipe.conversation_id;
  if (typeof userId !== "string" || typeof conversationId !== "string") {
    throw new Error(`recompute_canvas_recipe: recipe ${recipeId} row is missing its owner anchors`);
  }

  const sourceRef = parseRecipeSourceRef(recipe.source_ref);
  let written = 0;
  for (const read of sourceRef.reads) {
    // read.kind is "spreadsheet" — the only member of the union today; a future kind extends
    // the discriminated union AND this dispatch (parseRead already rejects unknown kinds).
    const sheet = await deps.query(
      "SELECT title, columns, rows FROM spreadsheets WHERE id = $1 AND user_id = $2",
      [read.spreadsheetId, userId],
    );
    const sheetRow = sheet.rows[0];
    if (sheetRow === undefined) {
      throw new Error(
        `recompute_canvas_recipe: spreadsheet ${read.spreadsheetId} missing or not owned by the recipe owner`,
      );
    }
    const projection = projectSpreadsheetForPublish({
      title: sheetRow.title,
      columns: sheetRow.columns,
      rows: sheetRow.rows,
    });
    if (projection === undefined) {
      throw new Error(
        `recompute_canvas_recipe: spreadsheet ${read.spreadsheetId} produced no publishable projection`,
      );
    }
    const landed = await deps.writeProjection({ conversationId, nodeId: read.nodeId, projection });
    if (!landed) {
      throw new Error(
        `recompute_canvas_recipe: projection write refused for node ${read.nodeId} ` +
          "(no conversation layout row, or the sharedState size cap would be exceeded)",
      );
    }
    written += 1;
  }
  return written;
}

/** Narrow the job payload `{ recipe_id }` at the boundary — throw on anything else. */
function recipeIdFromPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("recompute_canvas_recipe: payload must be { recipe_id }");
  }
  const recipeId = (payload as Record<string, unknown>).recipe_id;
  if (typeof recipeId !== "string" || !UUID_RE.test(recipeId)) {
    throw new Error("recompute_canvas_recipe: recipe_id must be a uuid");
  }
  return recipeId;
}

/** recompute_canvas_recipe — the per-recipe durable job (payload `{ recipe_id }`). */
const recompute_canvas_recipe: Task = async (payload, helpers) => {
  const recipeId = recipeIdFromPayload(payload);
  const query: QueryFn = (text, values) => helpers.query(text, values);
  const written = await recomputeCanvasRecipe(recipeId, {
    query,
    writeProjection: makeProjectionWriter(query),
    log: (message) => helpers.logger.info(message),
  });
  helpers.logger.info(
    `recompute_canvas_recipe: bumped ${written} published value(s) for recipe ${recipeId}`,
  );
};

/** The minute-resolution (UTC) stamp making one cron firing's fan-out idempotent:
 * a dispatcher retry within the same minute REPLACES the pending job (job_key contract)
 * rather than duplicating it; the next firing mints fresh keys. */
export function recomputeStampUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16);
}

/** The idempotent job_key for one recipe's recompute in one dispatch window:
 * `recipe:<recipeId>:<stamp>`. */
export function recipeJobKey(recipeId: string, stamp: string): string {
  return `recipe:${recipeId}:${stamp}`;
}

/**
 * Per-recipe fan-out (pattern-copy of `fanOutMorningBoards`): for each source-bearing recipe
 * id, enqueue exactly one `recompute_canvas_recipe` job keyed `recipe:<id>:<stamp>`. Pure
 * over its inputs so N recipes → N jobs + deterministic keys are unit-testable without a DB.
 */
export async function fanOutRecipeRecomputes(
  recipeIds: readonly string[],
  enqueue: EnqueueFn,
  now: Date = new Date(),
): Promise<number> {
  const stamp = recomputeStampUtc(now);
  for (const recipeId of recipeIds) {
    await enqueue("recompute_canvas_recipe", { recipe_id: recipeId }, recipeJobKey(recipeId, stamp));
  }
  return recipeIds.length;
}

/** Recipes worth re-polling: exactly those carrying a `source_ref` descriptor. */
const RECIPE_SOURCES_SQL = "SELECT id FROM canvas_recipes WHERE source_ref IS NOT NULL";

/**
 * dispatch_recipe_recomputes — the cron-fired fan-out (pattern-copy of
 * `dispatch_morning_boards`): enumerate source-bearing recipes, enqueue one per-recipe job
 * each THROUGH the guarded `public.enqueue_job` wrapper (every enqueue crosses the SECURITY
 * DEFINER allowlist), with an idempotent job_key. The cron fires this ONCE globally.
 */
const dispatch_recipe_recomputes: Task = async (_payload, helpers) => {
  const { rows } = await helpers.query<{ id: string }>(RECIPE_SOURCES_SQL);
  const recipeIds = rows.map((r) => r.id);
  const enqueued = await fanOutRecipeRecomputes(recipeIds, async (identifier, payload, jobKey) => {
    await helpers.query("SELECT public.enqueue_job($1, $2::jsonb, 8, $3)", [
      identifier,
      JSON.stringify(payload),
      jobKey,
    ]);
  });
  helpers.logger.info(`dispatch_recipe_recomputes: enqueued ${enqueued} recompute job(s)`);
};

/**
 * The durable job identifiers. Kept in lock-step with the `public.enqueue_job` allowlist
 * (packages/db migration) and the listener's internal routes. `deep_research` is added with
 * A9 (its `/v1/research/run-job` route + turn-detach are Part B). `dispatch_morning_boards`
 * (cron fan-out) + `assemble_morning_board` (per-user) are added with Phase 74.
 * `cascade_relabel` (Phase 75, 75-04) + `recompute_canvas_recipe`/`dispatch_recipe_recomputes`
 * (Phase 73 Wave C, LCAN-09) are added with migration 0061.
 */
export const taskList: TaskList = {
  ingest_inbound_email,
  assemble_morning_board,
  dispatch_morning_boards,
  cascade_relabel,
  recompute_canvas_recipe,
  dispatch_recipe_recomputes,
};
