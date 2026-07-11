/**
 * apps/web/e2e/helpers/uat-thread-fixtures.ts — DB fixture seeding for the
 * Phase-45 thread/forwarding UAT burn-down (Phase 50 Plan 03, LIVE-05).
 *
 * Seeds three fixtures for the seeded user's own importer, mirroring the
 * fixed-id `ON CONFLICT DO UPDATE` idempotency discipline of
 * live-loop-green.spec.ts / screenshot-fixtures.ts (re-running the harness
 * never grows a duplicate pile):
 *
 *   (a) a real multi-message thread (3 emails sharing one `thread_id`,
 *       distinct `received_at` so a deterministic "latest" member exists —
 *       45.1's count-Badge/latest-snippet scenario and 45.2's
 *       expand-to-member/"Open editor →" scenario);
 *   (b) a singleton email with a NULL `thread_id` (the pre-backfill-orphan
 *       shape `groupEmailsIntoThreads` falls back to a per-email singleton
 *       key for — 45.3);
 *   (c) a verification-code email (also a NULL-`thread_id` singleton) whose
 *       body contains a synthetic, recognizable code token — 45.7's
 *       UI-visibility slice. The code is deliberately fake (T-50-09): never
 *       a real code, never logged.
 *
 * Own fixture-id namespace (`50030...`), distinct from every other e2e
 * fixture file's ids (live-loop-green.spec.ts's `aaaa.../bbbb...`,
 * screenshot-fixtures.ts's `cccc.../dddd...`, uat-chat-fixtures.ts's
 * `ee000000-41xx-...`) so specs can run back-to-back against the same local
 * DB without colliding.
 */

import path from "node:path";

import { config as loadDotenv } from "dotenv";
import pg from "pg";

// Playwright's test runner does not load root .env.local itself — see
// seed-session.ts's identical note. npm workspaces run this with
// cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

// -- Multi-message thread (45.1, 45.2) --------------------------------------
const FIXTURE_THREAD_ID = "50030001-0000-4000-8000-000000000001";
const FIXTURE_EMAIL_THREAD_OLDEST_ID = "50030001-0000-4000-8000-000000000002";
const FIXTURE_EMAIL_THREAD_MIDDLE_ID = "50030001-0000-4000-8000-000000000003";
const FIXTURE_EMAIL_THREAD_LATEST_ID = "50030001-0000-4000-8000-000000000004";

const THREAD_SUBJECT_OLDEST =
  "Fwd: Packing List — UAT-45 Fixture Vessel BF-80 (original)";
const THREAD_SUBJECT_MIDDLE =
  "Re: Fwd: Packing List — UAT-45 Fixture Vessel BF-80 (reply)";
const THREAD_SUBJECT_LATEST =
  "Re: Fwd: Packing List — UAT-45 Fixture Vessel BF-80 (final confirmation)";
const THREAD_LATEST_SNIPPET =
  "Final packing list confirmed for BF-80 — UAT-45 fixture snippet marker.";

// -- Singleton (45.3 — count-1, null thread_id orphan) -----------------------
const FIXTURE_SINGLETON_EMAIL_ID = "50030002-0000-4000-8000-000000000001";
const SINGLETON_SUBJECT = "UAT-45 Fixture Singleton — standalone confirmation";
const SINGLETON_BODY =
  "This is a standalone singleton email fixture (no thread_id) for UAT 45.3.";

// -- Verification-code email (45.7 — UI-visibility slice) -------------------
const FIXTURE_VERIFICATION_EMAIL_ID = "50030003-0000-4000-8000-000000000001";
const VERIFICATION_SUBJECT = "UAT-45 Fixture — Verify your email address";
const VERIFICATION_CODE = "483920";
const VERIFICATION_BODY = `Your verification code is ${VERIFICATION_CODE}. Enter it to confirm your email address. (UAT-45 synthetic fixture — never a real code.)`;

export interface SeedThreadFixturesResult {
  readonly importerId: string;
  readonly threadId: string;
  /** The thread's latest-member subject — what the collapsed row shows. */
  readonly threadLatestSubject: string;
  readonly threadLatestSnippet: string;
  /** Oldest -> latest, matching `received_at` ordering. */
  readonly threadEmailIds: readonly [string, string, string];
  readonly threadOldestSubject: string;
  readonly threadMiddleSubject: string;
  readonly singletonEmailId: string;
  readonly singletonSubject: string;
  readonly verificationEmailId: string;
  readonly verificationSubject: string;
  readonly verificationCode: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `uat-thread-fixtures: missing required environment variable "${name}". ` +
        "Ensure the local Supabase stack is running (scripts/preflight-local.ps1) " +
        "and root .env.local is populated per docs/RUN-LOCAL.md.",
    );
  }
  return value;
}

async function upsertEmail(
  client: pg.Client,
  params: {
    readonly id: string;
    readonly importerId: string;
    readonly messageId: string;
    readonly subject: string;
    readonly bodyText: string;
    readonly threadId: string | null;
    /** SQL interval offset applied to `now()`, e.g. "-2 hours". Determines
     * `received_at` ordering deterministically across re-runs. */
    readonly receivedAtOffset: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO emails (
       id, importer_id, message_id, received_at, sender_address, sender_name,
       to_addresses, subject, body_text, parse_status, thread_id
     )
     VALUES (
       $1, $2, $3, now() + $4::interval, $5, $6, $7, $8, $9, 'parsed', $10
     )
     ON CONFLICT (id) DO UPDATE
       SET subject = EXCLUDED.subject,
           body_text = EXCLUDED.body_text,
           received_at = EXCLUDED.received_at,
           thread_id = EXCLUDED.thread_id`,
    [
      params.id,
      params.importerId,
      params.messageId,
      params.receivedAtOffset,
      "sender@example.com",
      "Example Sender",
      ["uat45-fixture@polytoken.local"],
      params.subject,
      params.bodyText,
      params.threadId,
    ],
  );
}

/**
 * seedThreadFixtures — idempotently upserts a multi-message thread, a
 * null-thread_id singleton, and a null-thread_id verification-code email,
 * all owned by `userId`'s own importer. Throws a clear, secret-free error if
 * the user owns no importer (same guidance every other fixture helper in
 * this suite gives for the identical precondition).
 */
export async function seedThreadFixtures(
  userId: string,
): Promise<SeedThreadFixturesResult> {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error(
      "uat-thread-fixtures: seedThreadFixtures requires a non-empty userId string",
    );
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
        `uat-thread-fixtures: seeded user ${userId} owns no importer — run scripts/preflight-local.ps1 first`,
      );
    }

    await client.query(
      `INSERT INTO threads (id, importer_id, subject)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, updated_at = now()`,
      [FIXTURE_THREAD_ID, importerId, THREAD_SUBJECT_LATEST],
    );

    await upsertEmail(client, {
      id: FIXTURE_EMAIL_THREAD_OLDEST_ID,
      importerId,
      messageId: "uat45-thread-oldest@polytoken.local",
      subject: THREAD_SUBJECT_OLDEST,
      bodyText: "Original packing list attached — UAT-45 fixture body (oldest).",
      threadId: FIXTURE_THREAD_ID,
      receivedAtOffset: "-2 hours",
    });
    await upsertEmail(client, {
      id: FIXTURE_EMAIL_THREAD_MIDDLE_ID,
      importerId,
      messageId: "uat45-thread-middle@polytoken.local",
      subject: THREAD_SUBJECT_MIDDLE,
      bodyText: "Reply with a correction — UAT-45 fixture body (middle).",
      threadId: FIXTURE_THREAD_ID,
      receivedAtOffset: "-1 hour",
    });
    await upsertEmail(client, {
      id: FIXTURE_EMAIL_THREAD_LATEST_ID,
      importerId,
      messageId: "uat45-thread-latest@polytoken.local",
      subject: THREAD_SUBJECT_LATEST,
      bodyText: THREAD_LATEST_SNIPPET,
      threadId: FIXTURE_THREAD_ID,
      receivedAtOffset: "0 seconds",
    });

    await upsertEmail(client, {
      id: FIXTURE_SINGLETON_EMAIL_ID,
      importerId,
      messageId: "uat45-singleton@polytoken.local",
      subject: SINGLETON_SUBJECT,
      bodyText: SINGLETON_BODY,
      threadId: null,
      receivedAtOffset: "-30 minutes",
    });

    await upsertEmail(client, {
      id: FIXTURE_VERIFICATION_EMAIL_ID,
      importerId,
      messageId: "uat45-verification@polytoken.local",
      subject: VERIFICATION_SUBJECT,
      bodyText: VERIFICATION_BODY,
      threadId: null,
      receivedAtOffset: "-15 minutes",
    });

    return {
      importerId,
      threadId: FIXTURE_THREAD_ID,
      threadLatestSubject: THREAD_SUBJECT_LATEST,
      threadLatestSnippet: THREAD_LATEST_SNIPPET,
      threadEmailIds: [
        FIXTURE_EMAIL_THREAD_OLDEST_ID,
        FIXTURE_EMAIL_THREAD_MIDDLE_ID,
        FIXTURE_EMAIL_THREAD_LATEST_ID,
      ],
      threadOldestSubject: THREAD_SUBJECT_OLDEST,
      threadMiddleSubject: THREAD_SUBJECT_MIDDLE,
      singletonEmailId: FIXTURE_SINGLETON_EMAIL_ID,
      singletonSubject: SINGLETON_SUBJECT,
      verificationEmailId: FIXTURE_VERIFICATION_EMAIL_ID,
      verificationSubject: VERIFICATION_SUBJECT,
      verificationCode: VERIFICATION_CODE,
    };
  } finally {
    await client.end();
  }
}
