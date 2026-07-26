import type { Metadata } from "next";
import * as React from "react";

import { BillingSurface } from "./_components/billing-surface";

export const metadata: Metadata = {
  title: "Billing — Polytoken",
  description: "Your polytoken subscription: your plan, upgrade, and manage billing.",
};

/**
 * /billing route — server-component shell (C1 billing).
 *
 * Shell SHAPE mirrors references/page.tsx (server component for metadata + the
 * frame, one "use client" surface below it) and its identity classes
 * (`text-ink`, `border-rule`, `bg-shelf`) — chrome is monochrome (law 1). A
 * pricing screen is CHROME, so it speaks sans throughout (law 2 — serif is for
 * the user's own material only); the amounts wear `tabular`. `api.billing.*` is
 * wired into root.ts, so the surface reads/writes it directly through the
 * app-wide tRPC provider.
 */
export default function BillingPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Billing</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <BillingSurface />
      </div>
    </main>
  );
}
