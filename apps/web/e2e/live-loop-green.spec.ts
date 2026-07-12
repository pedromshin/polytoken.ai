/**
 * apps/web/e2e/live-loop-green.spec.ts — LIVE-01 DB-verified green-path spec
 * (Phase 49 Plan 03, Task 2).
 *
 * Drives the full local loop — login(seeded) -> inbox -> thread -> email
 * detail -> chat (tool round + genui panel) -> /knowledge — against the LIVE
 * local stack (Supabase + the FastAPI listener + `npm run dev`), backing
 * every step with a direct `pg` query against 127.0.0.1:54322 (never trusting
 * a rendered pixel alone — "verified against the DB, not the terminal",
 * docs/RUN-LOCAL.md #7). Login is seeded via `seed-session.ts` (GoTrue admin
 * magiclink + verifyOtp) — interactive Google sign-in is LIVE-03's user-gated
 * deployed-app UAT (plan 49-06), never exercised here.
 *
 * PREREQUISITE (this spec does NOT start the stack itself): the operator has
 * run `scripts/preflight-local.ps1` (plan 49-01) so Supabase is up
 * (project_id=polytoken) and DB-verified green, then started the listener
 * (`cd apps/email-listener && uv run uvicorn app.main:app --host 127.0.0.1
 * --port 8000`, WITHOUT --reload) and the web app (`cd apps/web && npm run
 * dev`) per docs/RUN-LOCAL.md #3.
 *
 * Fixture note: `search_emails`/`lookup_entity`/`search_knowledge` all read
 * CONFIRMED extracted data (`find_similar_confirmed`, entity_instances,
 * knowledge_nodes) — a fresh local DB legitimately has none, so the tool
 * round this spec drives returns zero results. That is still a REAL,
 * DB-verified tool round (a real chat_run_events row, a real DB read
 * attempt) — the assertions below never weaken to a no-op; they require the
 * genuine chat_run_events/chat_messages rows to exist, not a fabricated
 * result count.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { seedAuthenticatedContext } from "./helpers/seed-session";

// Playwright's test runner does not load root .env.local itself (no dotenv
// wrapper on `playwright test` — see seed-session.ts's identical note).
// npm workspaces run this with cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

const ARTIFACT_PATH = path.resolve(
  process.cwd(),
  "..",
  "..",
  ".planning",
  "phases",
  "49-live-loop-gate-deploy-oauth-real-email",
  "artifacts",
  "local-green-db-verification.md",
);

// Fixed fixture ids (idempotent re-runs: ON CONFLICT(id) DO UPDATE, never a
// growing pile of duplicate rows per spec run).
const FIXTURE_THREAD_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const FIXTURE_EMAIL_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
const FIXTURE_MESSAGE_ID = "live-loop-green-fixture@polytoken.local";
const FIXTURE_SUBJECT = "LIVE-01 fixture: Invoice for Q3 shipment";

const CHAT_PROMPT =
  "Call the search_emails tool to search my emails for the word 'invoice'. " +
  "Then use emit_ui_spec to show me a short summary card of what you found " +
  "(a card is fine even if there are zero results — just show the count).";

// Matches chat/conversations.ts's own DEFAULT_CHAT_MODEL_ID (Sonnet 4.6 —
// the only registry entry with BOTH capabilities.tools and capabilities.genui
// exercised together reliably).
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`live-loop-green.spec: missing required environment variable "${name}"`);
  }
  return value;
}

async function assertNotLoginUrl(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Types + submits a chat message via the composer (placeholder text is the
 * one stable selector across empty/non-empty conversation states). */
async function sendChatMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder("Ask the agent anything…");
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Waits for the in-flight turn to settle: the Send/Stop button morphs in
 * the SAME slot (composer.tsx), so "Send message" reappearing is the
 * canonical "turn finished streaming" signal. */
async function waitForTurnSettled(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 150_000,
  });
}

interface ChatEvidence {
  readonly hasToolCall: boolean;
  readonly hasGenuiSpec: boolean;
}

async function checkChatEvidence(
  dbClient: pg.Client,
  conversationId: string,
): Promise<ChatEvidence> {
  const toolCallResult = await dbClient.query(
    `SELECT cre.id
       FROM chat_run_events cre
       JOIN chat_runs cr ON cr.id = cre.run_id
      WHERE cr.conversation_id = $1 AND cre.type = 'tool_call'
      LIMIT 1`,
    [conversationId],
  );
  const genuiResult = await dbClient.query(
    `SELECT cm.id
       FROM chat_messages cm
      WHERE cm.conversation_id = $1
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(cm.parts) elem
           WHERE elem->>'type' = 'genui_spec'
        )
      LIMIT 1`,
    [conversationId],
  );
  return {
    hasToolCall: toolCallResult.rows.length > 0,
    hasGenuiSpec: genuiResult.rows.length > 0,
  };
}

test.describe("LIVE-01 green path (seeded session, DB-verified)", () => {
  test("login(seeded) -> inbox -> thread -> email detail -> chat -> knowledge", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000); // generous — two live Bedrock tool+genui turns can take a while

    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();
    const evidence: string[] = [
      `# LIVE-01 local green-path DB-verification evidence`,
      ``,
      `Captured: ${new Date().toISOString()}`,
      ``,
    ];

    try {
      // -----------------------------------------------------------------
      // Seed an authenticated session (Task 1 helper) — no interactive Google.
      // -----------------------------------------------------------------
      const seeded = await test.step("seed authenticated session", () =>
        seedAuthenticatedContext(context),
      );

      // -----------------------------------------------------------------
      // Seed the minimum email/thread fixture the fresh local DB lacks
      // (idempotent — ON CONFLICT(id) DO UPDATE, never a no-op assertion).
      // -----------------------------------------------------------------
      const importerRow = await dbClient.query<{ id: string }>(
        "SELECT id FROM importers WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
        [seeded.userId],
      );
      const importerId = importerRow.rows[0]?.id;
      if (!importerId) {
        throw new Error(
          `live-loop-green.spec: seeded user ${seeded.userId} owns no importer — run scripts/preflight-local.ps1 first`,
        );
      }

      await dbClient.query(
        `INSERT INTO threads (id, importer_id, subject)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, updated_at = now()`,
        [FIXTURE_THREAD_ID, importerId, FIXTURE_SUBJECT],
      );
      await dbClient.query(
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
          "sender@example.com",
          "Example Sender",
          [seeded.email],
          FIXTURE_SUBJECT,
          "Please find attached the invoice for the Q3 shipment. Total: $4,250.00.",
          FIXTURE_THREAD_ID,
        ],
      );

      // -----------------------------------------------------------------
      // Step 1: inbox — seeded session loads `/` without a /login redirect.
      // -----------------------------------------------------------------
      await test.step("inbox: seeded session loads / without redirect", async () => {
        await page.goto("/");
        await assertNotLoginUrl(page);
        await expect(page.getByText(FIXTURE_SUBJECT).first()).toBeVisible({ timeout: 20_000 });

        const dbCheck = await dbClient.query(
          "SELECT id FROM threads WHERE id = $1 AND importer_id = $2",
          [FIXTURE_THREAD_ID, importerId],
        );
        evidence.push(
          "## Inbox",
          "Query: `SELECT id FROM threads WHERE id = $1 AND importer_id = $2`",
          `Result: ${JSON.stringify(dbCheck.rows)}`,
          "",
        );
        expect(dbCheck.rows.length).toBe(1);
      });

      // -----------------------------------------------------------------
      // Step 2: thread -> email detail renders.
      // -----------------------------------------------------------------
      await test.step("thread -> email detail renders", async () => {
        // Explicitly select this test's own seeded thread before opening the
        // editor. InboxThreePane's default-select effect auto-picks "the
        // latest member of the first visible thread" purely from page-load-
        // time query data — under concurrent Playwright workers (this run's
        // sibling spec files insert THEIR OWN received_at=now() fixture
        // emails into the SAME shared local DB), a sibling worker's fresher
        // insert can win the "most recent" slot between this test's own
        // insert and its own inbox page load, causing the global
        // "Open editor" link to point at the WRONG email (found live, 51-07
        // regression burn-down — firefox landed on uat-45-threads.spec.ts's
        // own fixture email instead of this test's). Selecting by this
        // fixture's own subject text first (the SAME pattern
        // uat-45-threads.spec.ts's singleton-row scenarios already
        // establish) is deterministic regardless of sibling-worker writes.
        await page
          .getByRole("button", { name: new RegExp(escapeRegExp(FIXTURE_SUBJECT)) })
          .click();
        await page.getByRole("link", { name: /Open editor/ }).click();
        // Generous timeout: Next.js dev-mode on-demand route compilation for
        // /emails/[id] (first visit this dev-server session) can exceed the
        // default 5s assert timeout, especially under concurrent
        // chromium+firefox project load against the SAME dev server.
        await expect(page).toHaveURL(new RegExp(`/emails/${FIXTURE_EMAIL_ID}`), {
          timeout: 20_000,
        });
        await assertNotLoginUrl(page);
        await expect(page.getByRole("heading", { name: FIXTURE_SUBJECT })).toBeVisible({
          timeout: 20_000,
        });

        const dbCheck = await dbClient.query(
          `SELECT e.id
             FROM emails e
             JOIN importers i ON i.id = e.importer_id
            WHERE e.id = $1 AND i.user_id = $2`,
          [FIXTURE_EMAIL_ID, seeded.userId],
        );
        evidence.push(
          "## Email detail",
          "Query: `SELECT e.id FROM emails e JOIN importers i ON i.id = e.importer_id WHERE e.id = $1 AND i.user_id = $2`",
          `Result: ${JSON.stringify(dbCheck.rows)}`,
          "",
        );
        expect(dbCheck.rows.length).toBe(1);
      });

      // -----------------------------------------------------------------
      // Step 3: /chat — a tool round + a genui panel, DB-verified.
      // -----------------------------------------------------------------
      await test.step("chat: tool round + genui panel", async () => {
        // Insert the conversation row directly (own random id + a
        // run-unique title) instead of clicking "New chat" + inferring the
        // id by "most recent for this user" — the latter races against the
        // OTHER Playwright project (chromium/firefox run concurrently
        // against the SAME shared local stack) and can select the wrong
        // browser's conversation. Selecting by this run's own unique title
        // in the rail is deterministic regardless of concurrency.
        const conversationId = randomUUID();
        const conversationTitle = `LIVE-01 fixture ${conversationId.slice(0, 8)}`;
        await dbClient.query(
          `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [conversationId, seeded.userId, importerId, conversationTitle, CHAT_MODEL_ID],
        );

        await page.goto("/chat");
        await assertNotLoginUrl(page);
        // Anchored regex, NOT a plain string: the row-select button's
        // accessible name is "{title} {relative time}" and a SEPARATE
        // sibling "More actions for {title}" button also substring-matches
        // the bare title string — only the row-select button's name STARTS
        // WITH the title.
        await page
          .getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) })
          .click();
        await expect(page.getByPlaceholder("Ask the agent anything…")).toBeVisible({
          timeout: 20_000,
        });

        await sendChatMessage(page, CHAT_PROMPT);
        await waitForTurnSettled(page);

        let evidenceCheck = await checkChatEvidence(dbClient, conversationId);
        if (!evidenceCheck.hasToolCall || !evidenceCheck.hasGenuiSpec) {
          // One bounded nudge retry — live-LLM flakiness is not "weakening
          // the assertion": the final check below still requires the
          // genuine DB rows, never a fabricated pass.
          await sendChatMessage(
            page,
            "Please call search_emails and then emit_ui_spec for a summary card, as requested above.",
          );
          await waitForTurnSettled(page);
          evidenceCheck = await checkChatEvidence(dbClient, conversationId);
        }

        await expect(
          page.getByText(/Searched emails|Searched knowledge|Looked up an entity|Ran a lookup/).first(),
        ).toBeVisible({ timeout: 10_000 });
        await expect(page.locator(".rounded-lg.border.border-border.p-4").first()).toBeVisible({
          timeout: 10_000,
        });

        evidence.push(
          "## Chat (conversation)",
          `Conversation id: ${conversationId}`,
          "Query: `SELECT cre.id FROM chat_run_events cre JOIN chat_runs cr ON cr.id = cre.run_id WHERE cr.conversation_id = $1 AND cre.type = 'tool_call'`",
          `Result: hasToolCall=${evidenceCheck.hasToolCall}`,
          "Query: `SELECT cm.id FROM chat_messages cm WHERE cm.conversation_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(cm.parts) elem WHERE elem->>'type' = 'genui_spec')`",
          `Result: hasGenuiSpec=${evidenceCheck.hasGenuiSpec}`,
          "",
        );
        expect(evidenceCheck.hasToolCall, "expected a chat_run_events tool_call row").toBe(true);
        expect(evidenceCheck.hasGenuiSpec, "expected a chat_messages genui_spec part").toBe(true);
      });

      // -----------------------------------------------------------------
      // Step 4: /knowledge — tiered canvas renders nodes; permission gate holds.
      // -----------------------------------------------------------------
      await test.step("/knowledge: tiered canvas renders nodes", async () => {
        await page.goto("/knowledge");
        await assertNotLoginUrl(page);
        await expect(page.getByRole("button", { name: "Entity Type: Invoice" })).toBeVisible({
          timeout: 20_000,
        });

        const privCheck = await dbClient.query<{ has_priv: boolean }>(
          "SELECT has_table_privilege('service_role', 'public.knowledge_nodes', 'SELECT') AS has_priv",
        );
        evidence.push(
          "## Knowledge (has_table_privilege)",
          "Query: `SELECT has_table_privilege('service_role', 'public.knowledge_nodes', 'SELECT') AS has_priv`",
          `Result: ${JSON.stringify(privCheck.rows)}`,
          "",
        );
        expect(privCheck.rows[0]?.has_priv).toBe(true);
      });
    } finally {
      const fs = await import("node:fs/promises");
      await fs.mkdir(path.dirname(ARTIFACT_PATH), { recursive: true });
      await fs.writeFile(ARTIFACT_PATH, evidence.join("\n") + "\n", "utf8");
      await dbClient.end();
    }
  });
});
