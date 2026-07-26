import type { Metadata } from "next";
import * as React from "react";

import { SignOutButton } from "~/components/sign-out-button";

import { DeleteAccount } from "./_components/delete-account";

export const metadata: Metadata = {
  title: "Account settings — Polytoken",
  description:
    "Manage your Polytoken account, including permanently deleting it and everything in it.",
};

/**
 * /settings/account route — server-component shell.
 *
 * Shell SHAPE + identity classes mirrored from `references/page.tsx` (server
 * component owning metadata + the monochrome frame — law 1 — with one
 * "use client" surface below it; `bg-shelf`, `border-rule`, `text-ink`). NO
 * HERO: settings is a registry of controls, not a landing surface, so a banner
 * would be noise (same precedent as the vault/registry pages).
 *
 * The interactive controls (the Session sign-out and the danger-zone delete)
 * are isolated in their own client surfaces so the shell stays a static server
 * component. Sign-out sits above the danger zone: signing out is the common,
 * safe account action; deleting is the rare, irreversible one.
 */
export default function AccountSettingsPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Settings</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
        <section className="flex flex-col gap-3 rounded-md border border-rule bg-bright p-panel">
          <div className="flex flex-col gap-1">
            <span className="text-2xs uppercase tracking-wide text-muted-foreground">
              Session
            </span>
            <h2 className="text-base font-semibold text-ink">Sign out</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            End this session on this device. Your data is untouched — you can
            sign back in any time.
          </p>
          <div className="max-w-xs">
            <SignOutButton />
          </div>
        </section>

        <DeleteAccount />
      </div>
    </main>
  );
}
