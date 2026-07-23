"use client";

/**
 * desktops-pane.tsx — the ST-03 desktop-management surface (E5 / RFC §5 / §6):
 * the signed-in user's cloud desktops, each with its LIVE accrued cost, status,
 * and the owner-driven lifecycle verbs (hibernate / destroy).
 *
 * DISCIPLINE:
 *   - OWNED-SCOPED (INV-8): rows come from the owner-scoped `desktop.list`
 *     query AND are filtered again by {@link selectOwnedDesktops} — a
 *     cross-user row can never render.
 *   - CONFIRM IS DATA (INV-4): `desktop.destroy` is `reversibility:
 *     "irreversible"`, so it goes behind an AlertDialog with data-loss
 *     language; `desktop.hibernate` is reversible and fires directly. The
 *     pane READS {@link verbRequiresConfirm}; it does not decide the gate.
 *   - COST VISIBILITY, provisioning still FAILS CLOSED: the list + cost are
 *     safe to show today; spawning a real VM stays gated on the Hetzner
 *     binding + budget go-ahead (provider.ts), which this pane does not touch.
 *   - SANS chrome, monochrome (law 1/2): status + cost are polytoken's own
 *     words. The only earned emphasis is the destructive CONTROL (the madder
 *     rule permits `variant="destructive"` on an irreversible action).
 */

import * as React from "react";
import { Loader2, Monitor } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@polytoken/ui/alert-dialog";
import { Button } from "@polytoken/ui/button";

import { DesktopCostTicker } from "~/app/chat/_canvas/desktop-cost-ticker";
import { api } from "~/trpc/react";

import {
  canHibernate,
  selectOwnedDesktops,
  verbRequiresConfirm,
  type DesktopSessionView,
} from "../_lib";

export interface DesktopsPaneProps {
  /** The signed-in user's id — the tenancy floor the row list is filtered to. */
  readonly currentUserId: string | undefined;
}

/** Short human status word — chrome, monochrome (no madder on a state, law 1). */
function statusWord(status: DesktopSessionView["status"]): string {
  return status;
}

export function DesktopsPane({
  currentUserId,
}: DesktopsPaneProps): React.ReactElement {
  const utils = api.useUtils();
  const list = api.desktop.list.useQuery();

  const hibernate = api.desktop.hibernate.useMutation({
    onSuccess: () => void utils.desktop.list.invalidate(),
  });
  const destroy = api.desktop.destroy.useMutation({
    onSuccess: () => void utils.desktop.list.invalidate(),
  });

  // The row currently pending an irreversible destroy confirm (null = closed).
  const [confirmTarget, setConfirmTarget] =
    React.useState<DesktopSessionView | null>(null);

  const sessions = selectOwnedDesktops(
    list.data as DesktopSessionView[] | undefined,
    currentUserId,
  );

  if (list.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-faded">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading your desktops…
      </p>
    );
  }

  if (sessions.length === 0) {
    // Empty states TEACH the next action (taste checklist) — and stay honest
    // that provisioning is not enabled yet (provider.ts fails closed).
    return (
      <div className="rounded-md border border-hair p-panel text-sm text-faded">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Monitor className="size-4" aria-hidden />
          No cloud desktops yet
        </p>
        <p className="mt-1 max-w-prose">
          A cloud desktop is a whole remote machine polytoken runs for you and
          streams into the canvas. Spawning one bills a VM by the hour — that
          path stays gated until a provider and budget are configured. When a
          desktop is live, it shows here with its running cost and lifecycle
          controls.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-hair rounded-md border border-hair">
        {sessions.map((session) => {
          const label = session.label ?? "Cloud desktop";
          const startedAtMs = new Date(session.createdAt).getTime();
          const busy =
            (hibernate.isPending &&
              hibernate.variables?.id === session.id) ||
            (destroy.isPending && destroy.variables?.id === session.id);

          return (
            <li
              key={session.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-row-x py-row-y"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Monitor className="size-4 shrink-0 text-faded" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">
                    {label}
                  </span>
                  <span className="block truncate text-2xs text-faded">
                    {statusWord(session.status)} · {session.region} ·{" "}
                    {session.shape}
                  </span>
                </span>
              </span>

              {/* Live cost — same ticker the canvas node wears (RFC §5.3). */}
              <DesktopCostTicker
                hourlyRateCents={session.hourlyRateCents}
                startedAtMs={startedAtMs}
                status={session.status}
                className="shrink-0 text-xs"
              />

              <span className="flex shrink-0 items-center gap-2">
                {canHibernate(session.status) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => hibernate.mutate({ id: session.id })}
                  >
                    Hibernate
                  </Button>
                )}
                {session.status !== "destroyed" && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      // INV-4: destroy is irreversible → route through the
                      // confirm modal. verbRequiresConfirm reads that from the
                      // capability descriptor; it is never a direct .mutate().
                      if (verbRequiresConfirm("destroy")) {
                        setConfirmTarget(session);
                      } else {
                        destroy.mutate({ id: session.id });
                      }
                    }}
                  >
                    Destroy
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {/* One confirm dialog, driven by the pending target. Irreversible verb ⇒
          data-loss language; the destroy mutation fires ONLY from the action. */}
      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Destroy “{confirmTarget?.label ?? "Cloud desktop"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the desktop and its disk permanently. Everything on
              the machine is lost — this cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmTarget) destroy.mutate({ id: confirmTarget.id });
                setConfirmTarget(null);
              }}
            >
              Destroy permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
