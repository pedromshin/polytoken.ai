"use client";

/**
 * apps/web/src/components/sign-out-button.tsx — sidebar-footer sign-out
 * affordance (Phase 43 Plan 02, AUTH-02). Posts a plain form to the
 * server-side `/auth/signout` route handler so the session cookie clears
 * server-side (T-43-P2-05) — no client-side `signOut()` call is made here,
 * since that alone would leave the httpOnly server cookies intact. Sizing
 * and placement mirror `ThemeToggle` in `app-sidebar.tsx`.
 */

import { LogOut } from "lucide-react";

import { Button } from "@polytoken/ui/button";

export function SignOutButton(): React.ReactElement {
  return (
    <form action="/auth/signout" method="post">
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        className="h-11 w-full justify-start gap-2 text-muted-foreground hover:bg-muted"
      >
        <LogOut className="size-4" aria-hidden />
        <span className="text-sm">Sign out</span>
      </Button>
    </form>
  );
}
