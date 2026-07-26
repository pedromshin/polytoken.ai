"use client";

/**
 * forwarding-setup.tsx — the /onboarding client surface (guided mail-forwarding
 * setup). Mail-forwarding setup is the #1 new-user drop-off, so this makes it
 * trivial: it shows the caller their PERSONAL forwarding address in a copyable
 * field (the primary action — Copy — is one click from arrival), then a numbered
 * step list to wire it up in their provider.
 *
 * Seam: `api.forwarding.getOrCreateMyAddress` (get-or-create query, idempotent —
 * `packages/api-client/src/router/forwarding/index.ts`). Same hook the minimal
 * `forwarding-address-card.tsx` uses; this is the guided sibling.
 *
 * Design law:
 *   - Chrome is monochrome (law 1): the Copy action wears ink (Button default),
 *     focus rings are ink, NO decorative hue. An errored/empty load carries no
 *     madder — it is reversible, so it stays ink.
 *   - Sans everywhere (law 2): this whole surface is chrome. The one exception
 *     is the forwarding ADDRESS, the user's own identifier — shown `font-mono
 *     tabular` so the token reads as a fixed-width credential, via existing
 *     tokens (never raw palette classes).
 *   - Flat framed cards (`bg-bright` + `border-rule`, zero shadow) — never the
 *     centered-card-with-shadow generic. Density via `p-panel`.
 *
 * Security: the address is a semi-secret (T-45-06-02) — this component never
 * logs it. tRPC errors surface a friendly message; the raw error goes only to
 * the browser devtools console (never the address).
 */

import { Check, Copy, MailPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as React from "react";

import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

const COPIED_RESET_MS = 1500;

/** The wire-it-up steps. Kept as data so the numbered markers stay consistent. */
const SETUP_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "Open your email provider's settings",
    detail:
      "In Gmail, Outlook, Fastmail, or wherever your mail lives, find Forwarding (sometimes under Filters or Rules).",
  },
  {
    title: "Add a forwarding address or filter",
    detail:
      "Paste the address above as a new forwarding destination. Most providers send a one-time verification email to confirm it.",
  },
  {
    title: "Point your mail at this address",
    detail:
      "Forward everything, or set a filter to forward only the senders you want ingested into polytoken.",
  },
  {
    title: "Send yourself a test email",
    detail:
      "Email yourself, let the forward fire, and watch it land in your polytoken inbox — that confirms the whole loop works.",
  },
];

export function ForwardingSetup(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const { data, isPending, isError, error } =
    api.forwarding.getOrCreateMyAddress.useQuery();

  // Cheap progress signal: how many emails have arrived so far, so the "send a
  // test email" step gets a satisfying confirmation. limit 5 keeps it light.
  const received = api.emails.list.useQuery({ limit: 5, offset: 0 });

  const handleCopy = useCallback(() => {
    if (!data?.address) return;
    navigator.clipboard
      .writeText(data.address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_RESET_MS);
      })
      .catch(() => {
        // Insecure context / permission denied: no "Copied" confirmation, and the
        // <code> stays select-all-able. Caught so it's not an unhandled rejection.
      });
  }, [data?.address]);

  useEffect(() => {
    if (isError && error) {
      // Never the address — the query never puts it in an error message.
      console.error("[ForwardingSetup] tRPC error:", error);
    }
  }, [isError, error]);

  const receivedCount = received.data?.items.length ?? 0;
  const receivedLabel = received.data?.hasMore
    ? `${receivedCount}+`
    : String(receivedCount);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      {/* Intro — teaches WHY, in chrome sans. */}
      <div className="flex items-start gap-3">
        <MailPlus
          className="mt-0.5 h-5 w-5 shrink-0 text-ink"
          aria-hidden
          strokeWidth={1.5}
        />
        <div>
          <h2 className="text-base font-semibold text-ink">
            Route your email into polytoken
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every message you forward to your personal address below is ingested,
            parsed, and turned into knowledge you can search and chat with. Set it
            up once.
          </p>
        </div>
      </div>

      {/* The address — the user's own identifier, in a flat framed card. */}
      <section
        aria-labelledby="forwarding-address-heading"
        className="rounded-md border border-rule bg-bright p-panel"
      >
        <h3
          id="forwarding-address-heading"
          className="text-sm font-medium text-ink"
        >
          Your forwarding address
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          This is yours and semi-secret — anyone with it can send mail into your
          inbox, so don't share it.
        </p>

        <div className="mt-3">
          {isPending ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : isError ? (
            // Not irreversible → no madder (law 1). Ink, like every other
            // failed load.
            <p className="text-sm text-ink">
              Unable to load your forwarding address. Please try refreshing the
              page.
            </p>
          ) : data ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code
                aria-label="Your forwarding address"
                onClick={(e) => {
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
                className="min-w-0 flex-1 truncate rounded-md border border-hair bg-shelf px-3 py-2 font-mono tabular text-sm text-ink"
              >
                {data.address}
              </code>
              <Button
                type="button"
                onClick={handleCopy}
                aria-label="Copy forwarding address"
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="size-4" aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="size-4" aria-hidden />
                    Copy
                  </>
                )}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {/* The steps — numbered, monochrome markers. */}
      <section
        aria-labelledby="setup-steps-heading"
        className="rounded-md border border-rule bg-bright p-panel"
      >
        <h3
          id="setup-steps-heading"
          className="text-sm font-medium text-ink"
        >
          Set up forwarding
        </h3>
        <ol className="mt-3 flex flex-col gap-3">
          {SETUP_STEPS.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-rule text-xs font-medium tabular text-ink"
              >
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Progress confirmation — cheap count, only once we know it. */}
      {!received.isPending && !received.isError ? (
        <div className="rounded-md border border-hair bg-shelf px-4 py-3">
          {receivedCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              No forwarded mail has arrived yet. Once your test email lands, it
              shows up in your inbox.
            </p>
          ) : (
            <p className="text-sm text-ink">
              <span className="tabular font-medium">{receivedLabel}</span>{" "}
              {receivedCount === 1 ? "email has" : "emails have"} arrived so far —
              forwarding is working.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
