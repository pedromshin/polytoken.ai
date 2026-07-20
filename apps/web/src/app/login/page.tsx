import type { Metadata } from "next";
import { Suspense } from "react";

import { BrandMark } from "~/components/brand-mark";

import { GoogleSigninButton } from "./_components/google-signin-button";

export const metadata: Metadata = {
  title: "Sign in — Polytoken",
};

/**
 * apps/web/src/app/login/page.tsx — the sign-in surface, on the LOCKED
 * identity (Phase 62 / SURF-05, AUTH-01).
 *
 * The first draft was the default-shadcn login: a lone shadowed card
 * centered in dead space — anti-generic tell #1, called out by name in the
 * taste doc's /login prescription. This is now the paper itself: a quiet
 * left-aligned column on the page ground — brand glyph in ink, one heading,
 * ONE action (taste §3: "/login: one action"), a hairline rule, and a
 * single line of product truth underneath. No card, no shadow, no
 * divider-split stack of dead auth options.
 *
 * Public route — `resolveAuthRedirect` treats `/login` as unguarded.
 * `GoogleSigninButton` reads `useSearchParams`, which requires a Suspense
 * boundary in the App Router; the fallback is a same-size skeleton so the
 * page never reflows when the button hydrates (SURF-06).
 */
export default function LoginPage(): React.ReactElement {
  return (
    <div className="flex min-h-[100vh] items-center justify-center p-6">
      <div className="w-full max-w-xs">
        {/* The mark — ink, like every piece of chrome (law 1) */}
        <BrandMark variant="glyph" size="size-8" className="text-ink" />

        <h1 className="mt-5 text-xl font-semibold text-ink">
          Welcome back to your workspace
        </h1>
        <p className="mt-1.5 text-sm text-faded">
          Pick up right where you left off — sign in with Google.
        </p>

        <div className="mt-6">
          <Suspense
            fallback={
              <div
                aria-hidden
                className="h-9 w-full animate-pulse rounded-md bg-shade motion-reduce:animate-none"
              />
            }
          >
            <GoogleSigninButton />
          </Suspense>
        </div>

        {/* One line of product truth under a hairline — not a manifesto */}
        <p className="mt-8 border-t border-hair pt-4 text-xs leading-relaxed text-pencil">
          polytoken reads the mail you forward and keeps every extracted fact
          tied to the exact place it came from.
        </p>
      </div>
    </div>
  );
}
