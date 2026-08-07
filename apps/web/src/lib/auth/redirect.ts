/**
 * apps/web/src/lib/auth/redirect.ts — pure, unit-tested route-guard and
 * open-redirect decision logic (Phase 43 Plan 02, T-43-P2-01, T-43-P2-04).
 *
 * Both functions are intentionally free of any Next.js / Supabase
 * dependency so they can be exhaustively unit-tested without a request
 * object, a cookie jar, or a running server. `middleware.ts` and
 * `app/auth/callback/route.ts` are the only callers.
 */

/**
 * Validates a "return to this path after sign-in" value coming from an
 * attacker-influenceable source (a query param). Only a same-origin,
 * single-leading-slash relative path is allowed through — anything else
 * (missing, protocol-relative `//host`, an absolute URL, or a
 * backslash-disguised authority `/\host` that some browsers normalize to
 * `//host` for special schemes) falls back to the app home. This is the
 * sole mitigation for T-43-P2-01 (open redirect via `redirectTo`/`next`).
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/** Route-guard decision input: the current request path and verified auth state. */
export interface ResolveAuthRedirectInput {
  readonly pathname: string;
  readonly hasUser: boolean;
}

/** Route-guard decision output: redirect target, or null to pass through. */
export interface ResolveAuthRedirectResult {
  readonly redirectTo: string;
}

/**
 * Path prefixes reachable WITHOUT a session.
 *
 * `/login` + `/auth` are the auth surfaces themselves (T-43-P2-04).
 *
 * `/legal` was added 2026-08-08, when billing went live: the terms, the refund
 * policy and the privacy notice were being served behind the guard, so
 * `GET /legal/terms` returned the sign-in page. That is wrong three ways — a
 * prospective customer cannot read the terms *before* subscribing (which is when
 * they matter), Stripe requires a reachable terms/refund URL on a live account,
 * and consumer law expects the terms to be presented at the point of sale, not
 * after it. Legal documents are public by nature; nothing under /legal reads
 * user data.
 */
const PUBLIC_PATH_PREFIXES = ["/login", "/auth", "/legal"] as const;

/**
 * Decides whether a request should be redirected to `/login`. Authenticated
 * visitors and requests targeting a public surface always pass through
 * unredirected (T-43-P2-04 — matcher gap safety net enumerated by the unit
 * tests below).
 */
export function resolveAuthRedirect(
  input: ResolveAuthRedirectInput,
): ResolveAuthRedirectResult | null {
  const { pathname, hasUser } = input;

  if (hasUser) return null;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }

  return { redirectTo: `/login?redirectTo=${encodeURIComponent(pathname)}` };
}
