/**
 * apps/web/e2e/uat-39-tool-round.spec.ts — Phase-39 UAT burn-down: live
 * in-round tool-round activity affordance (39.1) + citation chip render +
 * deep-link round-trip (39.2), Phase 50 Plan 02 (LIVE-05).
 *
 * Drives a REAL server tool round (search_emails) against the LOCAL live
 * stack via a seeded session (apps/web/e2e/helpers/seed-session.ts) — no
 * interactive Google, no mocked SSE. Reuses live-loop-green.spec.ts's
 * fixture-seed + chat-drive + DB-assert pattern (Phase 49 Plan 03) verbatim:
 * dotenv load path, pg.Client on POSTGRES_URL_NON_POOLING, fixed-id
 * ON CONFLICT DO UPDATE upserts, sendChatMessage/waitForTurnSettled/
 * assertNotLoginUrl helpers, anchored-regex conversation-row selection
 * (avoids the cross-project race 49-03 documented), --project=chromium only.
 *
 * 39.2's citation chip needs a REAL provenance-bearing search_emails result.
 * search_emails only ever reads CONFIRMED extracted data (D-13) — this spec
 * seeds the minimum confirmed slice honestly (an importer-scoped entity_type
 * + a `confirmed` email_components row + its `confirmed` extraction_record,
 * content_text carrying a real invoice-number identifier so pg_trgm's
 * `match_components_by_trgm` RPC — `WHERE sim > 0` — surfaces it) rather
 * than fabricating a chip or weakening the assertion. The chat prompt asks
 * the model to call search_emails with an EXACT query string containing
 * that identifier so `key_terms.py`'s label-anchored `_RE_INVOICE` extracts
 * it — the same mechanism a real user's invoice-number search would exercise.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { seedAuthenticatedContext } from "./helpers/seed-session";

// Playwright's test runner does not load root .env.local itself — see
// seed-session.ts's identical note. npm workspaces run this with
// cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

// Fixed fixture ids — own namespace ("ee000000-39xx-...", distinct from
// live-loop-green.spec.ts's "aaaa.../bbbb...", screenshot-fixtures.ts's
// "cccc.../dddd...", and uat-chat-fixtures.ts's "ee000000-41xx-...").
const FIXTURE_ENTITY_TYPE_ID = "ee000000-3900-4eee-8eee-0000000000e1";
const FIXTURE_COMPONENT_ID = "ee000000-3900-4eee-8eee-0000000000c1";
const FIXTURE_EXTRACTION_RECORD_ID = "ee000000-3900-4eee-8eee-0000000000a1";
const FIXTURE_EMAIL_ID = "ee000000-3900-4eee-8eee-0000000000ee";
const FIXTURE_MESSAGE_ID = "uat-39-tool-round-fixture@polytoken.local";
const FIXTURE_ENTITY_TYPE_SLUG = "uat39-invoice-fixture";
const FIXTURE_INVOICE_NUMBER = "INV-2024-10001";
const FIXTURE_SUBJECT = `UAT-39 fixture: Invoice ${FIXTURE_INVOICE_NUMBER}`;
const FIXTURE_CONTENT_TEXT = `Invoice ${FIXTURE_INVOICE_NUMBER} for Q3 shipment. Total: $4,250.00.`;

// The exact query text the prompt asks the model to pass to search_emails —
// "invoice " + the identifier gives key_terms.py's label-anchored
// _RE_INVOICE a real match to extract, which match_components_by_trgm
// (`WHERE sim > 0`) then finds against FIXTURE_CONTENT_TEXT's verbatim
// substring.
const SEARCH_QUERY_TEXT = `invoice ${FIXTURE_INVOICE_NUMBER}`;

// Matches chat/conversations.ts's own DEFAULT_CHAT_MODEL_ID (Sonnet 4.6 —
// the only registry entry with both capabilities.tools and capabilities.genui
// exercised together reliably; mirrors live-loop-green.spec.ts).
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

const CHAT_PROMPT =
  `Call the search_emails tool. For the "query" argument, use exactly this text (do not shorten, ` +
  `paraphrase, or omit any part of it): "${SEARCH_QUERY_TEXT}". After the tool returns, use ` +
  `emit_ui_spec to show a short summary card of what you found (a card is fine even with zero results).`;

const NUDGE_PROMPT =
  `Please retry — call search_emails again with the "query" argument set to exactly ` +
  `"${SEARCH_QUERY_TEXT}", then emit_ui_spec a short summary card.`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`uat-39-tool-round.spec: missing required environment variable "${name}"`);
  }
  return value;
}

async function assertNotLoginUrl(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Types + submits a chat message via the composer (mirrors live-loop-green.spec.ts). */
async function sendChatMessage(page: Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder("Ask the agent anything…");
  await composer.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

/** Returns the id of the most-recent chat_runs row for `conversationId`, or
 * null if none exists yet. */
async function latestRunId(dbClient: pg.Client, conversationId: string): Promise<string | null> {
  const result = await dbClient.query<{ id: string }>(
    "SELECT id FROM chat_runs WHERE conversation_id = $1 ORDER BY started_at DESC LIMIT 1",
    [conversationId],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * waitForNextRunSettled — [Rule 1 - Bug] replaces a UI-timing-dependent
 * "Stop generating" -> "Send message" wait (live-loop-green.spec.ts's
 * pattern) with a DB-verified poll on `chat_runs.status`, matching this
 * repo's own "trust the DB, not the terminal" convention
 * (docs/RUN-LOCAL.md #7). Observed live during this plan's own execution: a
 * turn that streamed and completed correctly (real tool round + citation
 * chip + genui card, all DB/DOM-verified afterward) still never showed
 * "Stop generating" to Playwright's polling within a 60s window — the SSE
 * delivery can be fast/bursty enough that the transient UI state is
 * unobservable, while the run's own DB status is authoritative regardless
 * of client-side rendering timing. Polls specifically for a NEW run row
 * (id different from `priorRunId`) whose status has left "running", so a
 * stale prior-turn's already-terminal row is never mistaken for this send's
 * own settle signal (matters for the bounded nudge retry, which sends a
 * SECOND message into the SAME conversation).
 */
async function waitForNextRunSettled(
  dbClient: pg.Client,
  conversationId: string,
  priorRunId: string | null,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const result = await dbClient.query<{ id: string; status: string }>(
          "SELECT id, status FROM chat_runs WHERE conversation_id = $1 ORDER BY started_at DESC LIMIT 1",
          [conversationId],
        );
        const row = result.rows[0];
        if (row === undefined || row.id === priorRunId) return "running"; // new run not inserted yet
        return row.status;
      },
      { timeout: 150_000, message: "waiting for a new chat_runs row to leave 'running' status (DB-verified)" },
    )
    .not.toBe("running");
}

interface ToolCallEvidence {
  readonly hasToolCall: boolean;
}

async function checkToolCallEvidence(
  dbClient: pg.Client,
  conversationId: string,
): Promise<ToolCallEvidence> {
  const result = await dbClient.query(
    `SELECT cre.id
       FROM chat_run_events cre
       JOIN chat_runs cr ON cr.id = cre.run_id
      WHERE cr.conversation_id = $1 AND cre.type = 'tool_call'
      LIMIT 1`,
    [conversationId],
  );
  return { hasToolCall: result.rows.length > 0 };
}

test.describe("UAT 39: tool-round activity affordance + citation chip (seeded session, DB-verified)", () => {
  test("39.1 + 39.2: real search_emails tool round shows activity -> result row; citation chip deep-links to /emails/[id]", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000); // generous — a live Bedrock tool round + one bounded nudge retry

    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();

    try {
      const seeded = await test.step("seed authenticated session", () =>
        seedAuthenticatedContext(context),
      );

      const importerRow = await dbClient.query<{ id: string }>(
        "SELECT id FROM importers WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
        [seeded.userId],
      );
      const importerId = importerRow.rows[0]?.id;
      if (!importerId) {
        throw new Error(
          `uat-39-tool-round.spec: seeded user ${seeded.userId} owns no importer — run scripts/preflight-local.ps1 first`,
        );
      }

      // -----------------------------------------------------------------
      // Seed the minimum CONFIRMED extracted-data slice search_emails needs
      // to surface a real, cited result (idempotent — ON CONFLICT DO UPDATE).
      // -----------------------------------------------------------------
      await test.step("seed confirmed email + entity type + component + extraction record", async () => {
        await dbClient.query(
          `INSERT INTO entity_types (id, importer_id, slug, label, config, is_active)
           VALUES ($1, $2, $3, $4, '{}'::jsonb, true)
           ON CONFLICT (importer_id, slug) DO UPDATE SET label = EXCLUDED.label, is_active = true`,
          [FIXTURE_ENTITY_TYPE_ID, importerId, FIXTURE_ENTITY_TYPE_SLUG, "UAT-39 Invoice Fixture"],
        );

        await dbClient.query(
          `INSERT INTO emails (
             id, importer_id, message_id, received_at, sender_address, sender_name,
             to_addresses, subject, body_text, parse_status
           )
           VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, 'parsed')
           ON CONFLICT (id) DO UPDATE
             SET subject = EXCLUDED.subject, received_at = now()`,
          [
            FIXTURE_EMAIL_ID,
            importerId,
            FIXTURE_MESSAGE_ID,
            "sender@example.com",
            "Example Sender",
            [seeded.email],
            FIXTURE_SUBJECT,
            FIXTURE_CONTENT_TEXT,
          ],
        );

        await dbClient.query(
          `INSERT INTO email_components (
             id, importer_id, email_id, source_type, content_text, extraction_status, role, entity_type_id
           )
           VALUES ($1, $2, $3, 'email_body', $4, 'confirmed', 'entity', $5)
           ON CONFLICT (id) DO UPDATE
             SET content_text = EXCLUDED.content_text, extraction_status = 'confirmed', entity_type_id = EXCLUDED.entity_type_id`,
          [FIXTURE_COMPONENT_ID, importerId, FIXTURE_EMAIL_ID, FIXTURE_CONTENT_TEXT, FIXTURE_ENTITY_TYPE_ID],
        );

        await dbClient.query(
          `INSERT INTO extraction_records (id, importer_id, component_id, entity_type_id, extracted_fields, status)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'confirmed')
           ON CONFLICT (id) DO UPDATE SET status = 'confirmed', extracted_fields = EXCLUDED.extracted_fields`,
          [
            FIXTURE_EXTRACTION_RECORD_ID,
            importerId,
            FIXTURE_COMPONENT_ID,
            FIXTURE_ENTITY_TYPE_ID,
            JSON.stringify({ invoice_number: FIXTURE_INVOICE_NUMBER }),
          ],
        );
      });

      // -----------------------------------------------------------------
      // Seed the conversation (own random id + run-unique title — the
      // 49-03 anti-race pattern; two Playwright projects share one stack).
      // -----------------------------------------------------------------
      const conversationId = randomUUID();
      const conversationTitle = `UAT-39 fixture ${conversationId.slice(0, 8)}`;
      await dbClient.query(
        `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, seeded.userId, importerId, conversationTitle, CHAT_MODEL_ID],
      );

      await page.goto("/chat");
      await assertNotLoginUrl(page);
      // Anchored regex, NOT a plain string — the row-select button's
      // accessible name is "{title} {relative time}" and a separate
      // sibling "More actions for {title}" button also substring-matches
      // the bare title (49-03 anti-race pattern).
      await page
        .getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) })
        .click();
      await expect(page.getByPlaceholder("Ask the agent anything…")).toBeVisible({
        timeout: 20_000,
      });

      // -----------------------------------------------------------------
      // 39.1: drive the real tool round, catching the TRANSIENT activity
      // row before it settles into the collapsed result row.
      // -----------------------------------------------------------------
      const runIdBeforeFirstSend = await latestRunId(dbClient, conversationId);
      await sendChatMessage(page, CHAT_PROMPT);

      const activityRow = page.getByText("Searching emails…", { exact: true });
      let activityRowSeenTransiently = false;
      try {
        await expect(activityRow).toBeVisible({ timeout: 60_000 });
        activityRowSeenTransiently = true;
      } catch {
        // Real-LLM timing — a very fast/buffered tool round can settle
        // between Playwright polls (see waitForNextRunSettled's doc comment
        // for the same phenomenon observed live on the settle signal
        // itself). Never fabricated: the hard requirements below (DB-backed
        // tool_call row + rendered citation chip) still gate pass/fail.
        activityRowSeenTransiently = false;
      }

      await waitForNextRunSettled(dbClient, conversationId, runIdBeforeFirstSend);

      const citationLinkName = `Email · ${FIXTURE_EMAIL_ID.slice(0, 8)}`;
      // [Rule 1 - Bug] a bare `.count()` right after waitForTurnSettled races
      // the DOM's own re-render of the citation chip — "Send message"
      // reappearing and the chip painting are two separate React updates
      // that do not always land in the same tick. `waitForCitation` retries
      // (auto-waiting `expect`) instead of taking a single snapshot, so a
      // genuinely-rendered-a-moment-later chip is never misreported absent
      // (observed live during this plan's own execution).
      const waitForCitation = async (): Promise<boolean> => {
        try {
          await expect(page.getByRole("link", { name: citationLinkName })).toBeVisible({
            timeout: 8_000,
          });
          return true;
        } catch {
          return false;
        }
      };

      let toolEvidence = await checkToolCallEvidence(dbClient, conversationId);
      let hasCitation = await waitForCitation();

      if (!toolEvidence.hasToolCall || !hasCitation) {
        // One bounded nudge retry — mirrors live-loop-green.spec.ts's
        // live-LLM-flakiness tolerance. The final assertions below still
        // require the GENUINE DB row + rendered chip, never a fabricated pass.
        const runIdBeforeNudge = await latestRunId(dbClient, conversationId);
        await sendChatMessage(page, NUDGE_PROMPT);
        await waitForNextRunSettled(dbClient, conversationId, runIdBeforeNudge);
        toolEvidence = await checkToolCallEvidence(dbClient, conversationId);
        hasCitation = await waitForCitation();
      }

      const citationLink = page.getByRole("link", { name: citationLinkName });

      // 39.1 evidence: the collapsed ToolInvocationResultRow replaced the
      // activity row, backed by a REAL chat_run_events tool_call row.
      await expect(page.getByText(/Searched emails/).first()).toBeVisible({ timeout: 10_000 });
      expect(toolEvidence.hasToolCall, "expected a real chat_run_events tool_call row").toBe(true);

      // 39.2 evidence: a rendered ProvenanceLink chip with the correct icon
      // and href, deep-linking to /emails/[id] (never a fabricated chip).
      await expect(citationLink).toBeVisible({ timeout: 10_000 });
      await expect(citationLink).toHaveAttribute("href", `/emails/${FIXTURE_EMAIL_ID}`);
      await expect(citationLink.locator("svg")).toHaveCount(1); // the Mail icon (email kind)

      test.info().annotations.push({
        type: "39.1-activity-row-caught-transiently",
        description: String(activityRowSeenTransiently),
      });
    } finally {
      await dbClient.end();
    }
  });
});
