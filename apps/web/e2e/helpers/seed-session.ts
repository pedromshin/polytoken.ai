/**
 * apps/web/e2e/helpers/seed-session.ts — programmatic authenticated-session
 * seeding for the LIVE-01 green-path spec (Phase 49 Plan 03, T-49-03-01).
 *
 * Mints a REAL Supabase session for the local seed user WITHOUT ever
 * clicking through interactive Google sign-in: GoTrue admin mints a
 * magic-link token (service_role only — never sent to a browser or logged),
 * `verifyOtp` exchanges the hashed token for an access/refresh token pair,
 * and the injected cookie is built with the EXACT `@supabase/ssr` encoding
 * primitives (`createChunks` / `stringToBase64URL` — the same functions
 * apps/web/src/lib/supabase/{server,client,middleware}.ts rely on under the
 * hood via `@supabase/ssr`'s `createServerClient`/`createBrowserClient`) so
 * the cookie(s) this helper writes are byte-for-byte what a real
 * `@supabase/ssr`-managed sign-in would have produced — never a hand-rolled
 * re-implementation that could silently drift from what the app reads.
 *
 * Cookie name derivation mirrors `@supabase/supabase-js`'s own default
 * auth `storageKey` (`sb-${new URL(url).hostname.split(".")[0]}-auth-token`):
 * for the local stack (http://127.0.0.1:54321) this resolves to
 * `sb-127-auth-token`, chunked into `.0`/`.1`/... suffixes past
 * `@supabase/ssr`'s `MAX_CHUNK_SIZE` (3180 chars) — never guessed, always
 * derived the same way the library itself derives it.
 *
 * Interactive Google sign-in remains LIVE-03's user-gated deployed-app UAT
 * (plan 49-06) — this local bypass never ships (T-49-03-02, accepted risk
 * per 49-03-PLAN.md's threat model).
 */

import path from "node:path";

import { createChunks, stringToBase64URL } from "@supabase/ssr";
import { createClient, type Session } from "@supabase/supabase-js";
import { config as loadDotenv } from "dotenv";

import type { BrowserContext } from "@playwright/test";

// Playwright's test runner (`npm run test:e2e` -> `playwright test`, no
// dotenv wrapper) does not itself load root .env.local the way the `dev`
// script does (docs/RUN-LOCAL.md #2's env-file-split footgun applies to test
// runs too) — load it explicitly here. `override: false` means a value
// already present in the process env (e.g. an operator-exported var) always
// wins over the file, matching dotenv's own documented precedence.
// npm workspaces run `npm run test:e2e -w @polytoken/web` with cwd set to
// this package (apps/web) — the same assumption playwright.config.ts's own
// webServer comment documents — so `.env.local` is two levels up.
loadDotenv({
  path: path.resolve(process.cwd(), "..", "..", ".env.local"),
  override: false,
});

const BASE64_COOKIE_PREFIX = "base64-";

/** The single local seed user docs/RUN-LOCAL.md section 6 and
 * scripts/preflight-local.ps1 both seed via the GoTrue admin API. */
const DEFAULT_SEED_EMAIL = "pedromaschio.shin@gmail.com";

/**
 * GoTrue invalidates a user's prior unconsumed magic-link token the moment a
 * NEW one is minted for the same email. Every e2e spec file seeds sessions
 * for the SAME DEFAULT_SEED_EMAIL, and Playwright's `fullyParallel: true`
 * runs many spec files/projects concurrently — file-level `test.describe
 * .configure({ mode: "serial" })` (uat-41/uat-43/uat-48) only prevents races
 * WITHIN a file, not ACROSS files. When two workers mint+verify concurrently,
 * the loser's verifyOtp fails with "Email link is invalid or has expired"
 * (found live, 51-07 regression burn-down — 3 of 7 failures shared this exact
 * stack trace). Bounded retry with a fresh mint + jittered backoff tolerates
 * this transient collision without masking a genuine auth failure (verifyOtp
 * still must succeed for real on some attempt).
 */
const MAX_MINT_ATTEMPTS = 5;
const MINT_RETRY_BASE_DELAY_MS = 250;

export interface SeedAuthenticatedContextOptions {
  /** Defaults to the documented single local seed user. */
  readonly email?: string;
}

export interface SeedAuthenticatedContextResult {
  readonly userId: string;
  readonly email: string;
}

/** Reads a required env var, throwing a clear (secret-free) error if absent
 * — never a downstream "cannot read property of undefined" surprise. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `seed-session: missing required environment variable "${name}". ` +
        "Ensure the local Supabase stack is running (scripts/preflight-local.ps1) " +
        "and root .env.local is populated per docs/RUN-LOCAL.md.",
    );
  }
  return value;
}

/** Mirrors @supabase/supabase-js's own default auth storageKey derivation
 * so the injected cookie name matches EXACTLY what
 * apps/web/src/lib/supabase/{server,client,middleware}.ts read. Never a
 * separately-guessed scheme. */
function deriveStorageKey(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

/** True when a GoTrue admin createUser error indicates the user already
 * exists — the exact idempotency check scripts/preflight-local.ps1 already
 * uses, kept consistent across the two seeding entry points. */
function isAlreadyExistsError(message: string): boolean {
  return /already.*registered|already exists|email_exists/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * mintSession — mints a magiclink + verifyOtp session, retrying on the
 * transient cross-worker invalidation race documented above. Each attempt
 * mints a FRESH link (a stale token_hash from a prior attempt is never
 * reused) and backs off with jitter so concurrently-retrying workers
 * desynchronize rather than re-colliding on the next attempt.
 */
async function mintSession(
  admin: ReturnType<typeof createClient>,
  anonClient: ReturnType<typeof createClient>,
  email: string,
): Promise<Session> {
  let lastError = "no session returned";
  for (let attempt = 1; attempt <= MAX_MINT_ATTEMPTS; attempt++) {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error !== null) {
      lastError = `generateLink failed: ${link.error.message}`;
    } else {
      const tokenHash = link.data.properties.hashed_token;
      const verified = await anonClient.auth.verifyOtp({
        token_hash: tokenHash,
        type: "email",
      });
      if (verified.error === null && verified.data.session !== null) {
        return verified.data.session;
      }
      lastError = verified.error?.message ?? "no session returned";
    }
    if (attempt < MAX_MINT_ATTEMPTS) {
      await sleep(MINT_RETRY_BASE_DELAY_MS * attempt + Math.random() * 150);
    }
  }
  throw new Error(
    `seed-session: verifyOtp failed to mint a session after ${MAX_MINT_ATTEMPTS} attempts: ${lastError}`,
  );
}

/**
 * seedAuthenticatedContext — ensures the seed user exists, mints a session
 * via GoTrue admin (magiclink + verifyOtp — never interactive Google), and
 * injects the resulting @supabase/ssr-format `sb-*-auth-token` cookie(s)
 * into the given Playwright BrowserContext so a subsequent `page.goto` on a
 * protected route lands there WITHOUT a `/login` redirect.
 *
 * Never logs the service_role key, access token, or refresh token.
 */
export async function seedAuthenticatedContext(
  context: BrowserContext,
  options: SeedAuthenticatedContextOptions = {},
): Promise<SeedAuthenticatedContextResult> {
  const email = options.email ?? DEFAULT_SEED_EMAIL;
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Idempotently ensure the seed user exists — plan 49-01's preflight
  //    script normally already seeded it; never create a second user.
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.error !== null && !isAlreadyExistsError(created.error.message)) {
    throw new Error(
      `seed-session: failed to ensure seed user exists: ${created.error.message}`,
    );
  }

  // 2. Mint a session WITHOUT interactive Google: admin generateLink
  //    (magiclink) -> verifyOtp exchanges the hashed token for a real
  //    access/refresh token pair (never a password, never a browser).
  //    Retries on the documented cross-worker magic-link invalidation race
  //    (see MAX_MINT_ATTEMPTS's doc comment above).
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const session: Session = await mintSession(admin, anonClient, email);

  // 3. Build the EXACT @supabase/ssr cookie encoding (base64url,
  //    `base64-`-prefixed, chunked past MAX_CHUNK_SIZE) using the library's
  //    OWN exported primitives.
  const storageKey = deriveStorageKey(supabaseUrl);
  const encoded = BASE64_COOKIE_PREFIX + stringToBase64URL(JSON.stringify(session));
  const chunks = createChunks(storageKey, encoded);

  const oneYearFromNowSeconds = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  await context.addCookies(
    chunks.map(({ name, value }) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
      expires: oneYearFromNowSeconds,
    })),
  );

  return { userId: session.user.id, email };
}
