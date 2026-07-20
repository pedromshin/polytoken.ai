"use client";

/**
 * apps/web/src/app/login/_components/google-signin-button.tsx — the single
 * sign-in affordance on /login (AUTH-01), on the LOCKED identity (Phase 62 /
 * SURF-05/06). Google-only per the locked CONTEXT decision: no
 * email/password, no magic link input.
 *
 * States (SURF-06 — production-grade, not a fire-and-forget button):
 *   idle       → ink-filled primary button (law 1: the action colour is ink)
 *   redirecting→ disabled + spinner + honest label while the OAuth redirect
 *                is in flight (the browser is about to navigate away)
 *   error      → if the OAuth call itself rejects (network, misconfig), the
 *                failure is stated in ink under the button — never madder
 *                (an error is a state, law 1) — and the button re-arms.
 *
 * Reads the inbound `redirectTo` query param (set by the middleware's
 * route-guard redirect) and forwards it as the callback's `next` param —
 * both hops validated through `safeNextPath` (T-43-P2-01).
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@polytoken/ui/button";

import { safeNextPath } from "~/lib/auth/redirect";
import { createClient } from "~/lib/supabase/client";

export function GoogleSigninButton(): React.ReactElement {
  const searchParams = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("redirectTo"));

  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSignIn = async (): Promise<void> => {
    setFailed(false);
    setPending(true);
    try {
      const supabase = createClient();
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("next", nextPath);

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      if (error) {
        setFailed(true);
        setPending(false);
      }
      // On success the browser navigates away — keep the pending state so
      // the button never flashes back to idle mid-redirect.
    } catch {
      setFailed(true);
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={() => void handleSignIn()}
        disabled={pending}
        aria-busy={pending}
        className="w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {pending ? (
          <>
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            Redirecting to Google…
          </>
        ) : (
          "Sign in with Google"
        )}
      </Button>

      {failed && (
        <p role="alert" className="text-xs font-semibold text-ink">
          Couldn&rsquo;t reach Google to sign you in. Check your connection and
          try again.
        </p>
      )}
    </div>
  );
}
