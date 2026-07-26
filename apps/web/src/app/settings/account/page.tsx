import type { Metadata } from "next";
import * as React from "react";

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
 * The only interactive thing here is the danger-zone delete control, isolated
 * in its own client surface so the shell stays a static server component.
 */
export default function AccountSettingsPage(): React.ReactElement {
  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Settings</h1>
      </div>

      <div className="min-h-0 flex-1 p-4">
        <DeleteAccount />
      </div>
    </main>
  );
}
