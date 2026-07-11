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
