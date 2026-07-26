"use client";

import * as React from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@polytoken/ui/alert-dialog";
import { Button, buttonVariants } from "@polytoken/ui/button";
import { cn } from "@polytoken/ui";

import { createClient } from "~/lib/supabase/client";

/**
 * DeleteAccount — the client "Danger zone" surface of /settings/account.
 *
 * Chrome is monochrome + sans (laws 1 + 2): the frame, copy, and the removal
 * list all wear ink on a flat framed card (`bg-bright` + `border-rule`, zero
 * shadow — not the centered-card-with-shadow generic). The ONE thing that
 * wears the destructive variant is the irreversible CONTROL itself (the madder
 * rule allows destructive on a control, never on a state) — both the trigger
 * and the final confirm action.
 *
 * The gate is a Radix AlertDialog (available in @polytoken/ui): the trigger
 * only opens the dialog; the actual POST fires only from the dialog's explicit
 * confirm action, so a single stray click can never delete the account.
 *
 * On success we sign the browser session out and hard-navigate home — the
 * account (and its auth user) no longer exists, so any client-side router push
 * would just bounce off a dead session; `window.location` guarantees a clean
 * reload into the signed-out world.
 */

const REMOVED: readonly string[] = [
  "All your mail — every ingested message, attachment, and raw copy",
  "All your files — the vault, including prior versions and trash",
  "Your knowledge graph — entities, edges, and everything extracted",
  "Your subscription and billing history",
];

export function DeleteAccount(): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function handleDelete(): Promise<void> {
    setPending(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        throw new Error(`Delete failed with status ${res.status}`);
      }
      // Account (and its auth user) is gone — tear down the browser session
      // and hard-reload into the signed-out world.
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (error) {
      console.error("[settings/account] delete failed:", error);
      toast.error("Couldn't delete your account. Please try again.");
      setPending(false);
      setOpen(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-md border border-rule bg-bright p-panel">
        <div className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-muted-foreground">
            Danger zone
          </span>
          <h2 className="text-base font-semibold text-ink">Delete account</h2>
        </div>

        <p className="text-sm text-muted-foreground">
          Deleting your account is{" "}
          <span className="font-semibold text-ink">permanent</span>. There is no
          undo and nothing is recoverable afterwards. This removes:
        </p>

        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {REMOVED.map((item) => (
            <li key={item} className="flex gap-2">
              <span aria-hidden className="select-none text-ink">
                &middot;
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-1">
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Delete account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently erases your mail, files, knowledge graph, and
                  subscription. It cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  className={cn(buttonVariants({ variant: "destructive" }))}
                  onClick={(event) => {
                    // Keep the dialog mounted through the async work; drive the
                    // POST ourselves rather than letting Radix auto-close.
                    event.preventDefault();
                    void handleDelete();
                  }}
                >
                  {pending ? "Deleting…" : "Delete permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}
