/**
 * Browser capabilities (v2.0, CDP-first browser control) — six registry entries, ONE session.
 *
 * Everything here follows the Phase 65/68 spine:
 * - INV-2: each browser tool is a `defineCapability` registry entry resolved by id — no switch in
 *   handler.ts grew, no protocol MsgType was added (they ride `tool.request`).
 * - INV-4: risk is DATA on the descriptor — `exec` for open/close (they start/stop a real
 *   process), `write` for navigate/click/type (they mutate live page state), `read` for
 *   screenshot. The broker reads the field; nothing here prompts.
 * - Broker integration: `scope()` returns the BROWSER PROFILE DIRECTORY. `browser.open` scopes to
 *   the profileDir it is given (which must live inside the configured roots — the broker's
 *   outside-roots check applies to it like any other path); every other browser tool scopes to
 *   the OPEN session's profileDir, so a remembered allow/deny rule covers the whole session.
 *
 * playwright-core is a RUNTIME-ONLY dependency, loaded lazily inside `browser.open` via a
 * non-literal dynamic import. The daemon typechecks and its vitest suite runs WITHOUT the package
 * installed — tests inject a fake `Pw` through `createBrowserCapabilities({ loadPw })`. The
 * chromium executable defaults to /opt/pw-browsers/chromium and is overridable with the
 * POLYTOKEN_CHROMIUM_PATH environment variable.
 */
import { z } from "zod";

import { canonicalizePath } from "../permissions/paths.js";
import { defineCapability, type CapabilityDescriptor, type CapabilityScope } from "./registry.js";

// ── Minimal structural playwright surface ──────────────────────────────────────────────────────
// Deliberately NOT `import type ... from "playwright-core"`: the package is absent at typecheck
// time by design. These are the only members the capabilities touch; the real module satisfies
// them structurally, and tests satisfy them with plain objects.

export type PwPage = {
  goto(url: string, opts?: { timeout?: number }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  click(selector: string, opts?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<void>;
  screenshot(opts?: { fullPage?: boolean; type?: "png" }): Promise<Uint8Array>;
};

export type PwContext = {
  pages(): PwPage[];
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
};

export type PwBrowser = {
  contexts(): PwContext[];
  close(): Promise<void>;
};

export type PwChromium = {
  launchPersistentContext(
    profileDir: string,
    opts: { headless: boolean; executablePath: string },
  ): Promise<PwContext>;
  connectOverCDP(endpointUrl: string): Promise<PwBrowser>;
};

export type Pw = { chromium: PwChromium };

/** Default lazy loader. Never reached in tests — they inject a fake through the factory. */
const loadPlaywrightCore = async (): Promise<Pw> => {
  // Non-literal specifier on purpose: playwright-core is runtime-only, so a literal import would
  // fail `tsc --noEmit` in environments where it is not installed (CI, tests).
  const specifier = "playwright-core";
  const mod = (await import(specifier)) as { chromium: PwChromium };
  return { chromium: mod.chromium };
};

// ── Executable resolution ──────────────────────────────────────────────────────────────────────

export const DEFAULT_CHROMIUM_EXECUTABLE = "/opt/pw-browsers/chromium";

/** POLYTOKEN_CHROMIUM_PATH overrides the default install location. Pure over its env argument. */
export const chromiumExecutablePath = (env: NodeJS.ProcessEnv = process.env): string => {
  const override = env.POLYTOKEN_CHROMIUM_PATH;
  return override !== undefined && override.length > 0 ? override : DEFAULT_CHROMIUM_EXECUTABLE;
};

// ── The one browser session ────────────────────────────────────────────────────────────────────

/**
 * Mutable session state shared by the six capabilities. ONE browser per daemon: `browser.open`
 * fills it, `browser.close` clears it, everything else requires it. The profileDir recorded here
 * is what every non-open capability's `scope()` returns to the broker.
 */
export type BrowserSession = {
  profileDir: string | null;
  context: PwContext | null;
  /** Set only on the CDP-attach path — the daemon does not own an attached browser's lifetime. */
  browser: PwBrowser | null;
  page: PwPage | null;
};

export const createBrowserSession = (): BrowserSession => ({
  profileDir: null,
  context: null,
  browser: null,
  page: null,
});

/** Resolve a path for execution. The broker already proved it is inside roots. */
const mustCanonicalize = (raw: string): string => {
  const result = canonicalizePath(raw);
  if (!result.ok) throw new Error(`invalid path: ${result.reason}`);
  return result.path;
};

// ── Input schemas (mirrors of @polytoken/daemon-protocol's browser module, T-65-01 strict) ─────

const openInput = z
  .object({
    profileDir: z.string().min(1).max(4_096),
    headless: z.boolean().optional(),
    cdpUrl: z.string().min(1).max(4_096).optional(),
  })
  .strict();

const navigateInput = z
  .object({
    url: z
      .string()
      .min(1)
      .max(4_096)
      // file:// (or chrome://) would be a filesystem read wearing a browser costume — the roots
      // boundary must not be escapable through a URL bar.
      .refine((u) => /^https?:\/\//i.test(u), {
        message: "only http:// and https:// URLs are permitted",
      }),
  })
  .strict();

const screenshotInput = z.object({ fullPage: z.boolean().optional() }).strict();
const clickInput = z.object({ selector: z.string().min(1).max(1_024) }).strict();
const typeInput = z
  .object({ selector: z.string().min(1).max(1_024), text: z.string().max(10_000) })
  .strict();
const closeInput = z.object({}).strict();

// ── The capability set factory ─────────────────────────────────────────────────────────────────

export type BrowserCapabilitySet = {
  readonly session: BrowserSession;
  readonly capabilities: readonly CapabilityDescriptor<never, never>[];
};

/**
 * Build the six browser capabilities around one session. The default arguments are production
 * (module-level session + real playwright-core loader); tests pass a fresh session and a fake pw.
 */
export const createBrowserCapabilities = (opts?: {
  session?: BrowserSession;
  loadPw?: () => Promise<Pw>;
  env?: NodeJS.ProcessEnv;
}): BrowserCapabilitySet => {
  const session = opts?.session ?? createBrowserSession();
  const loadPw = opts?.loadPw ?? loadPlaywrightCore;
  const env = opts?.env ?? process.env;

  /** Every non-open capability is scoped to the OPEN session's profile dir. */
  const sessionScope = (): CapabilityScope => {
    if (session.profileDir === null) {
      throw new Error("no browser session is open — call browser.open first");
    }
    return { scope: session.profileDir, pathsToCheck: [session.profileDir] };
  };

  const requirePage = (): PwPage => {
    if (session.page === null) {
      throw new Error("no browser session is open — call browser.open first");
    }
    return session.page;
  };

  const open = defineCapability({
    id: "browser.open",
    input: openInput,
    output: z
      .object({
        kind: z.literal("browser.open"),
        profileDir: z.string(),
        attached: z.boolean(),
      })
      .strict(),
    risk: "exec",
    cost: "expensive",
    describe:
      "Open the daemon's single browser session: launch a chromium (playwright-core) with a " +
      "persistent profile directory inside a configured root, or attach to an already-running " +
      "chromium over CDP via cdpUrl. The profile directory is the permission scope for every " +
      "subsequent browser tool.",
    source: "builtin",
    trust: "first-party",
    scope: (input) => ({ scope: input.profileDir, pathsToCheck: [input.profileDir] }),
    execute: async (input) => {
      if (session.profileDir !== null) {
        throw new Error("a browser session is already open — call browser.close first");
      }
      const profileDir = mustCanonicalize(input.profileDir);
      const pw = await loadPw();

      const attached = input.cdpUrl !== undefined;
      let context: PwContext;
      let browser: PwBrowser | null = null;

      if (input.cdpUrl !== undefined) {
        browser = await pw.chromium.connectOverCDP(input.cdpUrl);
        const first = browser.contexts()[0];
        if (first === undefined) {
          await browser.close();
          throw new Error("the CDP endpoint exposed no browser context to attach to");
        }
        context = first;
      } else {
        context = await pw.chromium.launchPersistentContext(profileDir, {
          headless: input.headless ?? true,
          executablePath: chromiumExecutablePath(env),
        });
      }

      const page = context.pages()[0] ?? (await context.newPage());

      session.profileDir = profileDir;
      session.context = context;
      session.browser = browser;
      session.page = page;

      return { kind: "browser.open" as const, profileDir, attached };
    },
  });

  const navigate = defineCapability({
    id: "browser.navigate",
    input: navigateInput,
    output: z
      .object({ kind: z.literal("browser.navigate"), url: z.string(), title: z.string() })
      .strict(),
    risk: "write",
    cost: "moderate",
    describe:
      "Navigate the open browser session's page to an http(s) URL and report the resolved URL " +
      "and page title. file:// and other non-web schemes are rejected at the schema.",
    source: "builtin",
    trust: "first-party",
    scope: sessionScope,
    execute: async (input, ctx) => {
      const page = requirePage();
      await page.goto(input.url, { timeout: ctx.defaultTimeoutMs });
      return { kind: "browser.navigate" as const, url: page.url(), title: await page.title() };
    },
  });

  const screenshot = defineCapability({
    id: "browser.screenshot",
    input: screenshotInput,
    output: z
      .object({
        kind: z.literal("browser.screenshot"),
        base64: z.string(),
        bytes: z.number().int().min(0),
        truncated: z.boolean(),
      })
      .strict(),
    risk: "read",
    cost: "moderate",
    describe:
      "Capture a PNG screenshot of the open browser session's page and return it base64-encoded. " +
      "Raw bytes are capped at the daemon's configured output limit before encoding; `bytes` " +
      "reports the uncapped size and `truncated` says whether the cap bit.",
    source: "builtin",
    trust: "first-party",
    scope: sessionScope,
    execute: async (input, ctx) => {
      const page = requirePage();
      const raw = await page.screenshot({ fullPage: input.fullPage ?? false, type: "png" });
      const truncated = raw.byteLength > ctx.maxOutputBytes;
      const slice = truncated ? raw.subarray(0, ctx.maxOutputBytes) : raw;
      return {
        kind: "browser.screenshot" as const,
        base64: Buffer.from(slice).toString("base64"),
        bytes: raw.byteLength,
        truncated,
      };
    },
  });

  const click = defineCapability({
    id: "browser.click",
    input: clickInput,
    output: z.object({ kind: z.literal("browser.click"), selector: z.string() }).strict(),
    risk: "write",
    cost: "cheap",
    describe:
      "Click the element matching a CSS selector in the open browser session's page. Bounded by " +
      "the daemon's default timeout.",
    source: "builtin",
    trust: "first-party",
    scope: sessionScope,
    execute: async (input, ctx) => {
      await requirePage().click(input.selector, { timeout: ctx.defaultTimeoutMs });
      return { kind: "browser.click" as const, selector: input.selector };
    },
  });

  const type = defineCapability({
    id: "browser.type",
    input: typeInput,
    output: z
      .object({
        kind: z.literal("browser.type"),
        selector: z.string(),
        chars: z.number().int().min(0),
      })
      .strict(),
    risk: "write",
    cost: "cheap",
    describe:
      "Type text into the element matching a CSS selector in the open browser session's page, " +
      "replacing its current value. Bounded by the daemon's default timeout.",
    source: "builtin",
    trust: "first-party",
    scope: sessionScope,
    execute: async (input, ctx) => {
      await requirePage().fill(input.selector, input.text, { timeout: ctx.defaultTimeoutMs });
      return { kind: "browser.type" as const, selector: input.selector, chars: input.text.length };
    },
  });

  const close = defineCapability({
    id: "browser.close",
    input: closeInput,
    output: z.object({ kind: z.literal("browser.close"), closed: z.boolean() }).strict(),
    risk: "exec",
    cost: "cheap",
    describe:
      "Close the daemon's open browser session: a launched chromium is shut down; an attached " +
      "(CDP) browser is disconnected from. The session slot is freed for a new browser.open.",
    source: "builtin",
    trust: "first-party",
    scope: sessionScope,
    execute: async () => {
      const { context, browser } = session;
      // Clear FIRST: even if the close below throws, the slot must not wedge shut.
      session.profileDir = null;
      session.context = null;
      session.browser = null;
      session.page = null;

      if (browser !== null) {
        await browser.close(); // CDP attach: disconnect (playwright closes the connection)
      } else if (context !== null) {
        await context.close();
      }
      return { kind: "browser.close" as const, closed: true };
    },
  });

  return {
    session,
    capabilities: [open, navigate, screenshot, click, type, close] as unknown as readonly CapabilityDescriptor<
      never,
      never
    >[],
  };
};

/** The production set: module-level singleton session + real playwright-core loader. */
const productionSet = createBrowserCapabilities();

/** What handler.ts folds into the builtin registry. */
export const BROWSER_CAPABILITIES: readonly CapabilityDescriptor<never, never>[] =
  productionSet.capabilities;
