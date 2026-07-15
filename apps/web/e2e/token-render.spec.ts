/**
 * apps/web/e2e/token-render.spec.ts — computed-style regression guard for
 * the Tailwind v4 + React 19 platform migration (Phase 55).
 *
 * Authored in Stage 1 (55-01-PLAN.md Task 2) while every token is still bare
 * HSL, resolved via the transient `@config` JS-theme bridge in globals.css
 * (55-01) — this spec MUST be green here, on the still-HSL stack, and MUST
 * start failing loudly the moment Stage 2 (55-02) introduces an
 * `hsl(oklch(...))` call site or a purged `@source` class. 55-RESEARCH.md's
 * Pitfalls 2 and 4 document exactly why this needs an EXECUTABLE guard, not
 * a screenshot: a browser drops an invalid color declaration, or drops a
 * class purged by a missing `@source` directive, SILENTLY — no console
 * error, no build failure, the element just falls back to
 * transparent/inherited/unstyled. `screenshot:review` (apps/web/e2e/
 * screenshot-review.spec.ts) only CAPTURES pixels for later human review; it
 * never asserts anything, so it cannot catch this class of regression on its
 * own. This spec is the executable half of that pair — it rides the base
 * `playwright.config.ts` (`npm run test:e2e`), never the screenshot capture
 * config, and FAILS the run the moment a guarded surface goes transparent.
 *
 * Auth (mirrors screenshot-review.spec.ts's `isLocalTarget` gate and
 * seed-session.ts's `seedAuthenticatedContext` EXACTLY, T-50-01): the seeded
 * session mints a REAL local GoTrue admin session (magiclink + verifyOtp,
 * never interactive Google) and MUST NEVER run against a hosted
 * Supabase/Vercel target. `isLocalTarget` is reimplemented locally here
 * (not imported from screenshot-review.spec.ts) so importing this file never
 * also registers that file's own capture `test.describe` against this
 * assertion-spec run.
 *
 * Assertion invariant (the "faked-proof" contract across the whole
 * migration, per 55-01-PLAN.md): every check asserts a RESOLVED
 * `getComputedStyle()` value is a real, non-transparent color FUNCTION —
 * never a class-name string match, and never an exact color value (HSL ->
 * oklch changes in Stage 2 by design, so pinning literals here would make
 * this guard itself block the very migration it exists to protect).
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

/** Desktop viewport per 55-01-PLAN.md Task 2 ("navigate at the desktop 1440
 * viewport") — matches screenshot-review.spec.ts's own desktop constant, and
 * ensures the persistent sidebar (`hidden md:block`) actually renders. */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;

// Matches chat/conversations.ts's own DEFAULT_CHAT_MODEL_ID — never actually
// invoked (the fixture conversation is never sent a live message; the D-02
// "one chat node always present" default renders unconditionally the moment
// a conversation is selected, no LLM round needed).
const CHAT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

/** Hosts allowed to receive the seeded (service_role-minted) session —
 * mirrors screenshot-review.spec.ts's `isLocalTarget` (T-50-01 safety gate).
 * Reimplemented locally (see file header) rather than imported. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalTarget(baseURL: string, supabaseUrl: string): boolean {
  try {
    const baseHost = new URL(baseURL).hostname;
    const supabaseHost = new URL(supabaseUrl).hostname;
    return LOCAL_HOSTS.has(baseHost) && LOCAL_HOSTS.has(supabaseHost);
  } catch {
    return false;
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`token-render.spec: missing required environment variable "${name}"`);
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
 * assertRealColor — the faked-proof invariant for this whole migration:
 * asserts a resolved `getComputedStyle()` value is a VALID, non-transparent,
 * non-empty color. Never asserts an exact value — only that the browser
 * successfully parsed SOME real color function, i.e. the declaration was
 * not silently dropped. `rgba(0, 0, 0, 0)` is the exact fallback a browser
 * produces when it drops an invalid `hsl(oklch(...))` declaration or a
 * purged `@source` class (55-RESEARCH.md Pitfalls 2/4) — rejecting it
 * (alongside the bare `transparent` keyword and an empty string) is the
 * core of this guard.
 */
function assertRealColor(value: string, label: string): void {
  expect(value, `${label}: computed style was empty (declaration missing/dropped)`).not.toBe("");
  expect(
    value,
    `${label}: computed style resolved to the "transparent" keyword`,
  ).not.toBe("transparent");
  expect(
    value,
    `${label}: computed style resolved to the fully-transparent rgba(0, 0, 0, 0) fallback — this ` +
      "is the exact silent-failure signature of an invalid hsl(oklch(...)) declaration or a purged " +
      "@source class (55-RESEARCH.md Pitfalls 2/4)",
  ).not.toBe("rgba(0, 0, 0, 0)");
  expect(
    value,
    `${label}: expected a real rgb()/rgba()/hsl()/oklch()/color() function, got "${value}"`,
  ).toMatch(/^(rgb|rgba|hsl|hsla|oklch|color)\(/);
}

test.describe("token-render computed-style regression guard (Tailwind v4 migration, 55-01)", () => {
  // Serial mode — the SAME GoTrue magic-link cross-test race documented by
  // uat-41/uat-43/uat-48's identical guard (seed-session.ts's own doc
  // comment: minting for the SAME seed email concurrently within one file
  // invalidates the loser's token).
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ baseURL }) => {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const resolvedBaseURL = baseURL ?? "http://localhost:3000";
    test.skip(
      !isLocalTarget(resolvedBaseURL, supabaseUrl),
      "token-render guard requires the local Supabase/dev stack (T-50-01 safety gate) — " +
        "seedAuthenticatedContext must never mint a service_role session against a non-local target",
    );
  });

  test("/ (inbox): bg-background main surface, body text-foreground, and the sidebar family resolve", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await seedAuthenticatedContext(context);

    await page.goto("/");
    await assertNotLoginUrl(page);

    // <main> (SidebarInset, packages/ui/src/sidebar.tsx) — bg-background,
    // always rendered by the root layout on every route.
    const mainBg = await page
      .locator("main")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assertRealColor(mainBg, "/ main (bg-background)");

    // body { @apply bg-background text-foreground; } (globals.css @layer
    // base) — the base-layer text-foreground call site itself.
    const bodyColor = await page.evaluate(() => getComputedStyle(document.body).color);
    assertRealColor(bodyColor, "/ body (text-foreground)");

    // [data-sidebar="sidebar"] (packages/ui/src/sidebar.tsx) — bg-sidebar,
    // the sidebar color family registered through the JS-config @config
    // bridge. (sidebar.tsx:541's narrower
    // shadow-[0_0_0_1px_hsl(var(--sidebar-border))] outline-variant call
    // site has no live consumer anywhere in this app today — verified via
    // `grep -rn 'variant="outline"'` returning no SidebarMenuButton hits —
    // so this asserts the reachable, always-rendered sidebar family surface
    // instead of an unreachable one.)
    const sidebarBg = await page
      .locator('[data-sidebar="sidebar"]')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assertRealColor(sidebarBg, "/ [data-sidebar=sidebar] (bg-sidebar)");
  });

  test("/knowledge: minimap container, a graph node, and the React Flow Controls icon fill all resolve", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();

    try {
      const seeded = await seedAuthenticatedContext(context);
      // Same idempotent tier-diverse fixture uat-41/uat-48.2 seed — a fresh
      // knowledge_node with real EXTRACTED/INFERRED/AMBIGUOUS neighbours.
      const fixture = await seedKnowledgeGraphFixture(dbClient, seeded.userId);

      await page.goto("/knowledge");
      await assertNotLoginUrl(page);

      // knowledge_node is NOT in DEFAULT_VISIBLE_TYPES (entity_type +
      // entity_type_field only) — mirrors uat-48-token-surfaces.spec.ts's
      // 48.2 exact interaction to reveal it.
      await page.locator("label", { hasText: "Knowledge Rules" }).click();

      const focusNode = page.locator(`.react-flow__node[data-id="${fixture.focusNodeId}"]`);
      await expect(focusNode).toBeVisible({ timeout: 20_000 });

      // graph-nodes.tsx's KnowledgeNodeNode root div — bg-primary/15
      // border-primary/60 (+ shadow-[0_0_8px_hsl(var(--primary)/0.25)]).
      const nodeBg = await focusNode
        .locator("div")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      assertRealColor(nodeBg, "/knowledge KnowledgeNodeNode (bg-primary/15)");

      // .react-flow__minimap { @apply ... bg-card; } (globals.css @layer
      // components, FIX-01) — the unconditional <MiniMap /> on this route.
      const minimapBg = await page
        .locator(".react-flow__minimap")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      assertRealColor(minimapBg, "/knowledge .react-flow__minimap (bg-card)");

      // REQUIRED (55-01-PLAN.md Task 2): the globals.css-INTERNAL token
      // consumer — `.react-flow__controls-button svg { fill: hsl(var(--foreground)); }`
      // — becomes `hsl(oklch(...))` and silently vanishes after Stage 2 if
      // that one call site isn't converted too. Guards a static,
      // always-rendered element (the unconditional <Controls /> on this
      // route) so this check never depends on seeded data.
      const controlsFill = await page
        .locator(".react-flow__controls-button svg")
        .first()
        .evaluate((el) => getComputedStyle(el).fill);
      assertRealColor(controlsFill, "/knowledge .react-flow__controls-button svg (fill)");
    } finally {
      await dbClient.end();
    }
  });

  test("/chat: the canvas view's React Flow attribution chrome resolves (chat-canvas.tsx)", async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    const dbClient = new Client({ connectionString: requireEnv("POSTGRES_URL_NON_POOLING") });
    await dbClient.connect();

    try {
      const seeded = await seedAuthenticatedContext(context);
      const importerId = await resolveImporterId(dbClient, seeded.userId);

      // Own random id + run-unique title (49-03/live-loop-green.spec.ts's
      // anti-race pattern) — never a live LLM call; the D-02 default chat
      // node renders unconditionally the moment the conversation is selected.
      const conversationId = randomUUID();
      const conversationTitle = `token-render fixture ${conversationId.slice(0, 8)}`;
      await dbClient.query(
        `INSERT INTO chat_conversations (id, user_id, importer_id, title, model_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [conversationId, seeded.userId, importerId, conversationTitle, CHAT_MODEL_ID],
      );

      await page.goto("/chat");
      await assertNotLoginUrl(page);
      await page
        .getByRole("button", { name: new RegExp(`^${escapeRegExp(conversationTitle)}`) })
        .click();

      // ConversationView defaults to "chat" mode (D-02) — chat-canvas.tsx
      // (this Task's guarded surface) only mounts in "canvas" mode
      // (chat-canvas-view-toggle.tsx's aria-label="Canvas view" tab).
      await page.getByRole("tab", { name: "Canvas view" }).click();

      // .react-flow__attribution { @apply bg-background/70 ... text-muted-foreground; }
      // (globals.css @layer components, FIX-01) — React Flow's own default
      // attribution badge, shown here (chat-canvas.tsx sets
      // proOptions={{ hideAttribution: false }}) whenever the canvas mounts
      // with any node — the D-02 "one chat node always present" default
      // keeps this reachable without depending on chat history/streaming.
      const attribution = page.locator(".react-flow__attribution").first();
      await expect(attribution).toBeVisible({ timeout: 20_000 });
      const attributionBg = await attribution.evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      );
      assertRealColor(attributionBg, "/chat .react-flow__attribution (bg-background/70)");
    } finally {
      await dbClient.end();
    }
  });
});
