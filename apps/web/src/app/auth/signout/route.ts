/**
 * apps/web/src/app/auth/signout/route.ts — server-side sign-out (Phase 43
 * Plan 02, AUTH-02, T-43-P2-05). Clears the httpOnly Supabase session
 * cookies server-side via `supabase.auth.signOut()` — a browser-only
 * sign-out would leave the server-set httpOnly cookies intact — then
 * 303-redirects to `/login` so the follow-up GET re-runs the middleware
 * guard against the now-cleared session.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "~/lib/supabase/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
}
