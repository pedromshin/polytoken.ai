"use client";

/**
 * apps/web/src/lib/supabase/client.ts — browser Supabase client (Phase 43
 * Plan 01, T-43-P1-03).
 *
 * Used client-side for `supabase.auth.signInWithOAuth({ provider: "google" })`
 * (the sign-in button, Plan 02) and any other browser-initiated auth calls.
 * Reads only the public, validated env vars — never a secret.
 */

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "~/lib/env.public";

export function createClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
