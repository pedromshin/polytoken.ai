/**
 * apps/web/e2e/helpers/screenshot-fixtures.ts — DB fixture seeding for the
 * screenshot-review harness's `/emails/[id]` surface (Phase 50 Plan 01,
 * LIVE-06 / todo W-1).
 *
 * Mirrors the fixture-seed pattern proven in `live-loop-green.spec.ts`
 * (Phase 49 Plan 03): a fixed-id thread + email upserted for the seeded
 * user's own importer, so re-running the harness never grows a pile of
 * duplicate rows and `/emails/[id]` always renders the SAME real content.
 * Reuses the same root `.env.local` load path as `seed-session.ts` since
 * Playwright's own test runner does not dotenv-wrap itself.
 */

import path from "node:path";

import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

// Fixed fixture ids — own constants, distinct from live-loop-green.spec.ts's
// fixture ids, so the two specs never collide when run back-to-back against
// the same local DB (ON CONFLICT(id) DO UPDATE keeps re-runs idempotent).
const FIXTURE_THREAD_ID = "cccccccc-3333-4ccc-8ccc-cccccccccccc";
const FIXTURE_EMAIL_ID = "dddddddd-4444-4ddd-8ddd-dddddddddddd";
const FIXTURE_MESSAGE_ID = "screenshot-review-fixture@polytoken.local";
const FIXTURE_SUBJECT = "Screenshot review fixture: Q3 renewal quote";
const FIXTURE_BODY =
  "Hi there — attached is the renewal quote for Q3. Please review and let us know if you " +
  "have any questions. Total: $1,180.00.";
const FIXTURE_SENDER_ADDRESS = "sender@example.com";
const FIXTURE_SENDER_NAME = "Example Sender";

export interface SeedEmailFixtureResult {
  readonly emailId: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `screenshot-fixtures: missing required environment variable "${name}". ` +
        "Ensure the local Supabase stack is running (scripts/preflight-local.ps1) " +
        "and root .env.local is populated per docs/RUN-LOCAL.md.",
    );
  }
  return value;
}

/**
 * The seeded user's own importer. Extracted from `seedEmailFixture`'s body so the chat fixture
 * resolves it through the SAME query rather than a second copy that could drift.
 */
async function resolveImporterIdFor(client: pg.Client, userId: string): Promise<string> {
  const importerRow = await client.query<{ id: string }>(
    "SELECT id FROM importers WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
  const importerId = importerRow.rows[0]?.id;
  if (importerId === undefined) {
    throw new Error(
      `screenshot-fixtures: seeded user ${userId} owns no importer — run scripts/preflight-local.ps1 first`,
    );
  }
  return importerId;
}

/**
 * seedEmailFixture — idempotently upserts a fixed-id thread + parsed email
 * owned by `userId`'s own importer, so `/emails/[id]` renders real seeded
 * content. Throws a clear, secret-free error if the user owns no importer
 * (tells the operator to run scripts/preflight-local.ps1 first, the exact
 * same guidance live-loop-green.spec.ts gives for the identical precondition).
 */
export async function seedEmailFixture(userId: string): Promise<SeedEmailFixtureResult> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("screenshot-fixtures: seedEmailFixture requires a non-empty userId string");
  }

  const client = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
  await client.connect();

  try {
    const importerId = await resolveImporterIdFor(client, userId);

    // to_addresses reads as "who received this email" in the UI (metadata-card.tsx)
    // — use the seeded user's own auth.users email so the rendered card reads
    // realistically ("To: <the operator's real seed email>"), not the sender's.
    const userRow = await client.query<{ email: string }>(
      "SELECT email FROM auth.users WHERE id = $1",
      [userId],
    );
    const recipientEmail = userRow.rows[0]?.email ?? FIXTURE_SENDER_ADDRESS;

    await client.query(
      `INSERT INTO threads (id, importer_id, subject)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, updated_at = now()`,
      [FIXTURE_THREAD_ID, importerId, FIXTURE_SUBJECT],
    );

    await client.query(
      `INSERT INTO emails (
         id, importer_id, message_id, received_at, sender_address, sender_name,
         to_addresses, subject, body_text, parse_status, thread_id
       )
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, 'parsed', $9)
       ON CONFLICT (id) DO UPDATE
         SET subject = EXCLUDED.subject, received_at = now(), thread_id = EXCLUDED.thread_id`,
      [
        FIXTURE_EMAIL_ID,
        importerId,
        FIXTURE_MESSAGE_ID,
        FIXTURE_SENDER_ADDRESS,
        FIXTURE_SENDER_NAME,
        [recipientEmail],
        FIXTURE_SUBJECT,
        FIXTURE_BODY,
        FIXTURE_THREAD_ID,
      ],
    );

    return { emailId: FIXTURE_EMAIL_ID };
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Chat thread fixture — the message stream the harness could never see
// ---------------------------------------------------------------------------

/**
 * Fixed ids, same rationale as the email fixture's: re-running the harness must not grow a pile
 * of duplicate conversations in the dev DB.
 */
const FIXTURE_CONVERSATION_ID = "eeeeeeee-5555-4eee-8eee-eeeeeeeeeeee";
export const FIXTURE_CONVERSATION_TITLE = "Screenshot review: Q3 renewal thread";
/**
 * The seeded user turn's text. Exported so the harness can WAIT for the transcript to actually
 * render rather than hardcoding a copy that would silently drift out of sync with the fixture.
 */
export const FIXTURE_USER_QUESTION = "What's the total on the Q3 renewal quote?";
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

export interface SeedChatThreadFixtureResult {
  readonly conversationId: string;
  readonly conversationTitle: string;
}

/**
 * Seeds a conversation carrying a REAL settled turn — user text, an assistant tool round with a
 * citation, and an assistant answer.
 *
 * WHY THIS EXISTS: `/chat` selects a conversation by state, not by URL, so the harness — which
 * only ever navigated to a path — captured the "Ask me anything" EMPTY STATE on every run since
 * the surface existed. 61-04 redesigned the message stream, tool rounds and the citation chip and
 * then found it had "zero coverage in .planning/ui-reviews/": the whole surface was invisible to
 * every committed capture, so its visual claims rested on a throwaway probe. 61-05..08 and the
 * phase verifier would each have inherited that blindness.
 *
 * `chat.getHistory` replays `chat_messages.parts` VERBATIM (D-18), so a seeded turn renders
 * through exactly the same components a live turn would — this is real coverage, not a mock. The
 * parts shape is taken from `uat-48-token-surfaces.spec.ts`, which already proved it renders.
 *
 * Never invokes a model: the rows are pre-settled (`status: 'completed'`), so no Bedrock call, no
 * cost, and no nondeterminism enters the capture.
 */
export async function seedChatThreadFixture(
  userId: string,
): Promise<SeedChatThreadFixtureResult> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("screenshot-fixtures: seedChatThreadFixture requires a non-empty userId");
  }

  const client = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
  await client.connect();
  try {
    const importerId = await resolveImporterIdFor(client, userId);

    await client.query(
      `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
      [FIXTURE_CONVERSATION_ID, userId, importerId, FIXTURE_CONVERSATION_TITLE, CHAT_MODEL_ID],
    );

    // Idempotent: drop this fixture's turns before re-seeding, or every run stacks another copy.
    await client.query(`DELETE FROM chat_messages WHERE conversation_id = $1`, [
      FIXTURE_CONVERSATION_ID,
    ]);

    const userParts = [
      { type: "text", text: FIXTURE_USER_QUESTION },
    ];
    const assistantParts = [
      {
        type: "tool_invocation_result",
        toolUseId: "screenshot-review-tool-use",
        toolName: "search_emails",
        content: JSON.stringify({
          results: [{ id: FIXTURE_EMAIL_ID, subject: FIXTURE_SUBJECT }],
          citations: [{ kind: "email", id: FIXTURE_EMAIL_ID, route: "" }],
        }),
        isError: false,
      },
      {
        type: "text",
        text:
          "The Q3 renewal quote totals **$1,180.00**. It came in from Example Sender and asks " +
          "you to review and reply with any questions.",
      },
    ];

    await client.query(
      `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
       VALUES ($1, 'user', $2::jsonb, 0, 'completed')`,
      [FIXTURE_CONVERSATION_ID, JSON.stringify(userParts)],
    );
    await client.query(
      `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
       VALUES ($1, 'assistant', $2::jsonb, 0, 'completed')`,
      [FIXTURE_CONVERSATION_ID, JSON.stringify(assistantParts)],
    );

    return {
      conversationId: FIXTURE_CONVERSATION_ID,
      conversationTitle: FIXTURE_CONVERSATION_TITLE,
    };
  } finally {
    await client.end();
  }
}
