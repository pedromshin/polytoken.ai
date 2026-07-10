import type { Metadata } from "next";
import { Suspense } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@polytoken/ui/card";

import { BrandMark } from "~/components/brand-mark";

import { GoogleSigninButton } from "./_components/google-signin-button";

export const metadata: Metadata = {
  title: "Sign in — Polytoken",
};

/**
 * apps/web/src/app/login/page.tsx — the minimal sign-in surface (Phase 43
 * Plan 02, AUTH-01). Intentionally spare per 43-CONTEXT.md: a v1.8 re-skin
 * placeholder, not a design statement. Public route — `resolveAuthRedirect`
 * treats `/login` as unguarded so signed-out visitors can always reach it.
 * `GoogleSigninButton` reads `useSearchParams`, which requires a Suspense
 * boundary in the App Router.
 */
export default function LoginPage(): React.ReactElement {
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandMark
            variant="glyph"
            size="size-8"
            className="mb-2 text-primary"
          />
          <CardTitle>Welcome back to your workspace</CardTitle>
          <CardDescription>
            Pick up right where you left off — sign in with Google.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <GoogleSigninButton />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
