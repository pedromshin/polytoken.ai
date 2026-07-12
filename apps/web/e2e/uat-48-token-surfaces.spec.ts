/**
 * apps/web/e2e/uat-48-token-surfaces.spec.ts — Phase-48 UAT burn-down:
 * chip-pill + success/destructive surfaces (48.1, /chat + /emails/[id]) and
 * graph-palette + tier-edge surfaces (48.2, /knowledge), Phase 50 Plan 04
 * (LIVE-05, part C).
 *
 * All assertions run against the LOCAL live stack via a seeded session
 * (apps/web/e2e/helpers/seed-session.ts) — no interactive Google — and read
 * REAL resolved CSS (`getComputedStyle`), never a class-name string match, so
 * a token regression that keeps the class name but breaks the underlying
 * custom property would still be caught.
 *
 * 48.1's /chat slice — [Rule 3 - blocking, documented per plan's own
 * discretion clause]: the plan's default path is to drive a live Bedrock
 * tool round (uat-39-tool-round.spec.ts's pattern) to get a REAL rendered
 * ProvenanceLink chip. That mechanism (chip renders, correct href, correct
 * icon) was ALREADY proven live in 50-02 (39.2) — re-driving a ~$-costing,
 * 300s+ live LLM round here would only be re-proving tool-round plumbing
 * this spec doesn't care about, to check a CSS property. ProvenanceLink is
 * ONLY consumed in one place in this codebase
 * (tool-invocation-result-row.tsx) — there is no second "/emails/[id]
 * citation surface" or "knowledge deep-link chip" instance of the component
 * to fall back to per the plan's literal wording. Instead, this spec
 * DB-seeds a `chat_messages` row with a `tool_invocation_result` part in
 * the EXACT shape `chat.getHistory` replays verbatim (D-18, FOUND-1 — the
 * jsonb `parts` column is returned byte-for-byte, no transform) — so the
 * SAME real ProvenanceLink component renders from the SAME real data shape
 * a live turn would have produced, just without paying for a live model
 * call to get there. This is a deterministic-fixture design decision within
 * 50-CONTEXT.md's explicit "Claude's Discretion" grant ("how per-scenario
 * evidence is captured... as long as it is DB-verified where applicable"),
 * not a tracked-fix — the underlying chip mechanism has zero open issues.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

import { seedAuthenticatedContext } from "./helpers/seed-session";
import { resolveImporterId, seedKnowledgeGraphFixture } from "./helpers/uat-chat-fixtures";

// Playwright's test runner does not load root .env.local itself — see
// seed-session.ts's identical note. npm workspaces run this with
// cwd = apps/web, so .env.local is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const { Client } = pg;

// Fixed fixture ids — own namespace ("ee000000-4800-...", distinct from
// uat-39's "ee000000-3900-..." and uat-chat-fixtures.ts's "ee000000-4100-...").
const FIXTURE_ENTITY_TYPE_ID = "ee000000-4800-4eee-8eee-0000000000e1";
const FIXTURE_FIELD_ID = "ee000000-4800-4eee-8eee-0000000000f1";
const FIXTURE_EMAIL_ID = "ee000000-4800-4eee-8eee-0000000000ee";
const FIXTURE_ENTITY_COMPONENT_ID = "ee000000-4800-4eee-8eee-0000000000c1";
const FIXTURE_FIELD_COMPONENT_ID = "ee000000-4800-4eee-8eee-0000000000c2";
const FIXTURE_EXTRACTION_RECORD_ID = "ee000000-4800-4eee-8eee-0000000000a1";
const FIXTURE_MESSAGE_ID = "uat-48-token-surfaces-fixture@polytoken.local";
const FIXTURE_ENTITY_TYPE_SLUG = "uat48-fixture-type";
const FIXTURE_ENTITY_TYPE_LABEL = "UAT-48 Fixture Type";
const FIXTURE_FIELD_SLUG = "uat48_value";
const FIXTURE_SUBJECT = "UAT-48 fixture: token surfaces";
const FIXTURE_CANDIDATE_VALUE = "UAT-48 candidate value";

// Matches chat/conversations.ts's own DEFAULT_CHAT_MODEL_ID — never actually
// invoked here (the assistant row is DB-seeded, not live-streamed), just a
// valid registry id for the NOT NULL column.
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`uat-48-token-surfaces.spec: missing required environment variable "${name}"`);
  }
  return value;
}

async function assertNotLoginUrl(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * filterDotColor — reads the resolved `background-color` of a Filter Rail
 * node-type row's color dot (filter-rail.tsx's `span.rounded-full`), located
 * via its parent `<label>`'s visible text. The dot renders unconditionally
 * (checked or not), so this needs no entity/email fixture data — only the
 * six always-present filter rows.
 */
async function filterDotColor(page: Page, label: string): Promise<string> {
  const row = page.locator("label", { hasText: label });
  const dot = row.locator("span.rounded-full");
  return dot.evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe("UAT 48: token-surface burn-down (seeded session, DOM/CSS-verified)", () => {
  // Serial mode — same GoTrue magic-link race + Next dev-mode compile race
  // documented by uat-41-knowledge-preview.spec.ts's identical guard.
  test.describe.configure({ mode: "serial" });

  // -------------------------------------------------------------------
  // 48.1 — ProvenanceLink chip pill radius (/chat) + confirm/deny success
  // vs destructive tokens (/emails/[id]).
  // -------------------------------------------------------------------
  test("48.1: citation chip resolves the fully-rounded pill radius; confirm/deny controls render distinct success/destructive colors", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();

    try {
      const seeded = await seedAuthenticatedContext(context);
      const importerId = await resolveImporterId(dbClient, seeded.userId);

      // ---- Seed the confirmed-slice needed for a real FIELD candidate ----
      await dbClient.query(
        `INSERT INTO entity_types (id, importer_id, slug, label, config, is_active)
         VALUES ($1, $2, $3, $4, '{}'::jsonb, true)
         ON CONFLICT (importer_id, slug) DO UPDATE SET label = EXCLUDED.label, is_active = true`,
        [FIXTURE_ENTITY_TYPE_ID, importerId, FIXTURE_ENTITY_TYPE_SLUG, FIXTURE_ENTITY_TYPE_LABEL],
      );

      await dbClient.query(
        `INSERT INTO entity_type_fields (id, entity_type_id, importer_id, slug, label, field_type)
         VALUES ($1, $2, $3, $4, 'Value', 'string')
         ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, slug = EXCLUDED.slug`,
        [FIXTURE_FIELD_ID, FIXTURE_ENTITY_TYPE_ID, importerId, FIXTURE_FIELD_SLUG],
      );

      await dbClient.query(
        `INSERT INTO emails (
           id, importer_id, message_id, received_at, sender_address, sender_name,
           to_addresses, subject, body_text, parse_status
         )
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, 'parsed')
         ON CONFLICT (id) DO UPDATE SET subject = EXCLUDED.subject, received_at = now()`,
        [
          FIXTURE_EMAIL_ID,
          importerId,
          FIXTURE_MESSAGE_ID,
          "sender@example.com",
          "Example Sender",
          [seeded.email],
          FIXTURE_SUBJECT,
          "UAT-48 fixture body.",
        ],
      );

      await dbClient.query(
        `INSERT INTO email_components (
           id, importer_id, email_id, source_type, role, entity_type_id, extraction_status, location, content_text
         )
         VALUES ($1, $2, $3, 'region', 'entity', $4, 'confirmed', $5::jsonb, $6)
         ON CONFLICT (id) DO UPDATE
           SET role = 'entity', entity_type_id = EXCLUDED.entity_type_id, extraction_status = 'confirmed'`,
        [
          FIXTURE_ENTITY_COMPONENT_ID,
          importerId,
          FIXTURE_EMAIL_ID,
          FIXTURE_ENTITY_TYPE_ID,
          JSON.stringify({ page_index: 0 }),
          "UAT-48 fixture entity region.",
        ],
      );

      await dbClient.query(
        `INSERT INTO email_components (
           id, importer_id, email_id, parent_component_id, source_type, role, entity_type_field_id, extraction_status, location, content_text
         )
         VALUES ($1, $2, $3, $4, 'region', 'field', $5, 'candidate', $6::jsonb, $7)
         ON CONFLICT (id) DO UPDATE
           SET role = 'field',
               parent_component_id = EXCLUDED.parent_component_id,
               entity_type_field_id = EXCLUDED.entity_type_field_id,
               extraction_status = 'candidate'`,
        [
          FIXTURE_FIELD_COMPONENT_ID,
          importerId,
          FIXTURE_EMAIL_ID,
          FIXTURE_ENTITY_COMPONENT_ID,
          FIXTURE_FIELD_ID,
          JSON.stringify({ page_index: 0 }),
          "UAT-48 fixture field region.",
        ],
      );

      await dbClient.query(
        `INSERT INTO extraction_records (id, importer_id, component_id, entity_type_id, extracted_fields, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'candidate')
         ON CONFLICT (id) DO UPDATE SET status = 'candidate', extracted_fields = EXCLUDED.extracted_fields`,
        [
          FIXTURE_EXTRACTION_RECORD_ID,
          importerId,
          FIXTURE_FIELD_COMPONENT_ID,
          FIXTURE_ENTITY_TYPE_ID,
          JSON.stringify({ [FIXTURE_FIELD_SLUG]: FIXTURE_CANDIDATE_VALUE }),
        ],
      );

      // ---- Seed a settled turn carrying a real tool_invocation_result part
      //      with a citation — chat.getHistory replays chat_messages.parts
      //      verbatim (D-18), so ToolInvocationResultRow renders the SAME
      //      real ProvenanceLink chip a live turn would have produced. ----
      const conversationId = randomUUID();
      const conversationTitle = `UAT-48 fixture ${conversationId.slice(0, 8)}`;
      await dbClient.query(
        `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, seeded.userId, importerId, conversationTitle, CHAT_MODEL_ID],
      );

      const userParts = [{ type: "text", text: "Find the UAT-48 fixture email." }];
      const assistantParts = [
        {
          type: "tool_invocation_result",
          toolUseId: "uat48-fixture-tool-use",
          toolName: "search_emails",
          content: JSON.stringify({
            results: [{ id: FIXTURE_EMAIL_ID, subject: FIXTURE_SUBJECT }],
            citations: [{ kind: "email", id: FIXTURE_EMAIL_ID, route: "" }],
          }),
          isError: false,
        },
      ];

      await dbClient.query(
        `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
         VALUES ($1, 'user', $2::jsonb, 0, 'completed')`,
        [conversationId, JSON.stringify(userParts)],
      );
      await dbClient.query(
        `INSERT INTO chat_messages (conversation_id, role, parts, turn_index, status)
         VALUES ($1, 'assistant', $2::jsonb, 0, 'completed')`,
        [conversationId, JSON.stringify(assistantParts)],
      );

      // ---- 48.1a: chip pill radius on /chat ----
      await page.goto("/chat");
      await assertNotLoginUrl(page);
      await page
        .getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) })
        .click();
      await expect(page.getByPlaceholder("Ask the agent anything…")).toBeVisible({ timeout: 20_000 });

      const citationLinkName = `Email · ${FIXTURE_EMAIL_ID.slice(0, 8)}`;
      const citationLink = page.getByRole("link", { name: citationLinkName });
      await expect(citationLink).toBeVisible({ timeout: 10_000 });
      await expect(citationLink).toHaveAttribute("href", `/emails/${FIXTURE_EMAIL_ID}`);

      const chipBorderRadius = await citationLink.evaluate((el) => getComputedStyle(el).borderRadius);
      const chipRadiusPx = Number.parseFloat(chipBorderRadius);
      expect(
        chipRadiusPx,
        `expected the resolved pill token (9999px), got computed border-radius "${chipBorderRadius}"`,
      ).toBe(9999);

      // ---- 48.1b: confirm (success) vs deny (destructive) on /emails/[id] ----
      await page.goto(`/emails/${FIXTURE_EMAIL_ID}`);
      await assertNotLoginUrl(page);

      const entityRow = page.locator('[role="treeitem"]').filter({ hasText: FIXTURE_ENTITY_TYPE_LABEL });
      await expect(entityRow).toBeVisible({ timeout: 15_000 });
      // Clicking the ENTITY row arms it as the active parent (D-10), which
      // auto-expands its field children (layers-panel.tsx isExpanded logic)
      // — no separate chevron click needed.
      await entityRow.click();

      const confirmBtn = page.getByRole("button", { name: "Confirm field value" });
      const denyBtn = page.getByRole("button", { name: "Deny field value" });
      await expect(confirmBtn).toBeVisible({ timeout: 10_000 });
      await expect(denyBtn).toBeVisible();

      const confirmBg = await confirmBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      const denyBg = await denyBtn.evaluate((el) => getComputedStyle(el).backgroundColor);

      expect(confirmBg, "expected the success token, not transparent/unstyled").not.toBe("rgba(0, 0, 0, 0)");
      expect(denyBg, "expected the destructive token, not transparent/unstyled").not.toBe("rgba(0, 0, 0, 0)");
      expect(confirmBg, "expected success-green to differ from destructive-red").not.toBe(denyBg);

      test.info().annotations.push({
        type: "48.1-chat-chip-seeding-strategy",
        description:
          "DB-seeded chat_messages.parts (replayed verbatim via chat.getHistory), not a live Bedrock tool round — " +
          "the tool-round mechanism itself was already proven live in 50-02 (39.2); this spec only needed the " +
          "REAL ProvenanceLink chip's resolved CSS, not a re-proof of tool-call plumbing. Not a tracked-fix.",
      });
    } finally {
      await dbClient.end();
    }
  });

  // -------------------------------------------------------------------
  // 48.2 — /knowledge closed graph palette (filter-rail dots) + EXTRACTED
  // vs INFERRED tier edge strokes.
  // -------------------------------------------------------------------
  test("48.2: filter-rail dots use the closed graph palette; EXTRACTED vs INFERRED tier edges render visibly distinct strokes", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();

    try {
      const seeded = await seedAuthenticatedContext(context);
      // Reuses the SAME tier-diverse fixture uat-41-knowledge-preview.spec.ts
      // seeds (focus + EXTRACTED/INFERRED/AMBIGUOUS neighbours) — idempotent,
      // no collision, no new fixture surface needed.
      const fixture = await seedKnowledgeGraphFixture(dbClient, seeded.userId);

      const extractedEdgeRow = await dbClient.query<{ id: string }>(
        `SELECT id FROM knowledge_node_edges
          WHERE source_node_id = $1 AND target_ref_id = $2 AND tier = 'EXTRACTED' AND is_active = true
          LIMIT 1`,
        [fixture.focusNodeId, fixture.oneHopExtractedId],
      );
      const inferredEdgeRow = await dbClient.query<{ id: string }>(
        `SELECT id FROM knowledge_node_edges
          WHERE source_node_id = $1 AND target_ref_id = $2 AND tier = 'INFERRED' AND is_active = true
          LIMIT 1`,
        [fixture.focusNodeId, fixture.oneHopInferredId],
      );
      const extractedEdgeId = extractedEdgeRow.rows[0]?.id;
      const inferredEdgeId = inferredEdgeRow.rows[0]?.id;
      if (extractedEdgeId === undefined || inferredEdgeId === undefined) {
        throw new Error(
          "uat-48-token-surfaces.spec: seedKnowledgeGraphFixture did not produce the expected EXTRACTED/INFERRED edges",
        );
      }

      await page.goto("/knowledge");
      await assertNotLoginUrl(page);

      // knowledge_node is NOT in DEFAULT_VISIBLE_TYPES (entity_type +
      // entity_type_field only) — checking "Knowledge Rules" both reveals
      // the fixture's nodes AND flips includeInstances=true so its kne-
      // edges are fetched (knowledge-graph.tsx's includeInstances derivation).
      await page.locator("label", { hasText: "Knowledge Rules" }).click();

      await expect(page.locator(`.react-flow__node[data-id="${fixture.focusNodeId}"]`)).toBeVisible({
        timeout: 20_000,
      });

      const extractedPath = page.locator(
        `[data-testid="rf__edge-kne-${extractedEdgeId}"] path.react-flow__edge-path`,
      );
      const inferredPath = page.locator(
        `[data-testid="rf__edge-kne-${inferredEdgeId}"] path.react-flow__edge-path`,
      );
      await expect(extractedPath).toBeVisible({ timeout: 15_000 });
      await expect(inferredPath).toBeVisible({ timeout: 15_000 });

      const extractedStyle = await extractedPath.evaluate((el) => ({
        stroke: getComputedStyle(el).stroke,
        dash: getComputedStyle(el).strokeDasharray,
      }));
      const inferredStyle = await inferredPath.evaluate((el) => ({
        stroke: getComputedStyle(el).stroke,
        dash: getComputedStyle(el).strokeDasharray,
      }));

      // Distinct tier-ladder tokens (D-48-04): EXTRACTED resolves
      // --tier-extracted (solid, no dasharray override); INFERRED resolves
      // --tier-inferred plus a "5 3" dasharray — both the resolved stroke
      // color AND the dash pattern differ, never a class-name-only check.
      expect(extractedStyle.stroke, "expected distinct resolved tier stroke colors").not.toBe(
        inferredStyle.stroke,
      );
      expect(extractedStyle.dash, "expected EXTRACTED (solid) to differ from INFERRED (dashed)").not.toBe(
        inferredStyle.dash,
      );

      // Closed graph-palette custom properties (D-48-05) — "Instances"
      // (graph-entity) / "Emails" (graph-email) / "Components"
      // (graph-email-component) dots always render, checked or not.
      const instancesDot = await filterDotColor(page, "Instances");
      const emailsDot = await filterDotColor(page, "Emails");
      const componentsDot = await filterDotColor(page, "Components");
      const dotColors = new Set([instancesDot, emailsDot, componentsDot]);
      expect(dotColors.size, "expected 3 visually distinct graph-palette dot colors").toBe(3);
    } finally {
      await dbClient.end();
    }
  });
});
