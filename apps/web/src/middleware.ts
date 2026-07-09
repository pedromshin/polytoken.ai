/**
 * apps/web/src/middleware.ts — session refresh + route guard (Phase 43
 * Plan 02, AUTH-02). Runs on every non-excluded request: refreshes the
 * Supabase session cookies via `updateSession` (Plan 01), then decides
 * whether to redirect a signed-out visitor to `/login` via the pure
 * `resolveAuthRedirect` (T-43-P2-04). Authorization always derives from
 * `updateSession`'s server-verified `getUser()` result — the unverified
 * cookie-only session read is never used here (T-43-P2-03).
 *
 * Placement note (deviation from the plan's stated `apps/web/middleware.ts`):
 * this app uses a `src/` directory (`src/app`), and Next.js resolves the
 * middleware file relative to `path.join(pagesDir || appDir, '..')` — i.e.
 * `src/`, not the package root. A file at the package root is silently never
 * loaded. Verified directly against `next/dist/build/index.js` and
 * `next/dist/server/lib/router-utils/setup-dev-bundler.js` in this repo's
 * installed Next 15.3.3.
 */

import { NextResponse, type NextRequest } from "next/server";

import { resolveAuthRedirect } from "~/lib/auth/redirect";
import { updateSession } from "~/lib/supabase/middleware";

export default async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const redirect = resolveAuthRedirect({
    pathname: request.nextUrl.pathname,
    hasUser: Boolean(user),
  });

  if (!redirect) {
    return response;
  }

  const redirectResponse = NextResponse.redirect(
    new URL(redirect.redirectTo, request.url),
  );

  // Carry forward any refreshed session cookies from updateSession's
  // response onto the redirect response — otherwise a just-refreshed
  // access token would be dropped on the very request that redirects.
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  return redirectResponse;
}

export const config = {
  // Runs on every app surface EXCEPT: Next static assets/image optimizer,
  // favicon, common static file extensions, and /api (API routes
  // self-authorize per-request — see 43-CONTEXT.md interfaces).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
