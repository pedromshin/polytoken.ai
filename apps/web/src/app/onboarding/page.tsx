import type { Metadata } from "next";
import * as React from "react";

import { ForwardingSetup } from "./_components/forwarding-setup";

export const metadata: Metadata = {
  title: "Get started — Polytoken",
  description:
    "Set up mail forwarding: your personal forwarding address plus copy-paste steps to route your email into polytoken.",
};

/**
 * /onboarding route — server-component shell (forwarding onboarding).
 *
 * Shell SHAPE mirrored from `references/page.tsx` (server component for
 * metadata + the frame, one "use client" surface below it) and its identity
 * classes (`text-ink`, `border-rule`, `bg-shelf`) — chrome is monochrome
 * (law 1). NO HERO: the characteristic thing on the page is the forwarding
 * address + the setup steps, so a banner would be noise.
 *
 * Why this page exists: mail-forwarding setup is the #1 place new users drop
 * off. `forwarding-address-card.tsx` was the deliberately-minimal seam; this
 * is the guided version — same `api.forwarding.getOrCreateMyAddress` hook,
 * more hand-holding.
 */
export default function OnboardingPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Get started</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <ForwardingSetup />
      </div>
    </main>
  );
}
