"use client";

/**
 * forwarding-address-card.tsx — minimal surfacing of the caller's personal
 * forwarding address (THRD-04, web half, Plan 45-06). Intentionally spare
 * per 45-CONTEXT.md: seam scope is "minimal surfacing of the user's
 * address", NOT a full onboarding UX (that's FORWARDING-RUNBOOK.md's job,
 * linked below) — mirrors the deliberately-minimal login page precedent
 * (Phase 43 Plan 02).
 *
 * Security: the address is a semi-secret (T-45-06-02, threat register) —
 * this component never logs it. `api.forwarding.getOrCreateMyAddress`
 * errors are shown as a friendly message; the raw error is only surfaced to
 * the browser devtools console (never a server-side detail leak, and never
 * the address itself, which the query never puts in an error message).
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@polytoken/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@polytoken/ui/card";
import { Input } from "@polytoken/ui/input";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

const COPIED_RESET_MS = 1500;

/**
 * ForwardingAddressCard — fetches (get-or-create) and displays the caller's
 * `u-{token}@{domain}` forwarding address with a copy-to-clipboard
 * affordance and a link to the setup runbook.
 */
export function ForwardingAddressCard(): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const { data, isLoading, isError, error } =
    api.forwarding.getOrCreateMyAddress.useQuery();

  const handleCopy = useCallback(() => {
    if (!data?.address) return;
    void navigator.clipboard.writeText(data.address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  }, [data?.address]);

  useEffect(() => {
    if (isError && error) {
      console.error("[ForwardingAddressCard] tRPC error:", error);
    }
  }, [isError, error]);

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Your forwarding address</CardTitle>
        <CardDescription>
          Forward mail here to ingest it into polytoken.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Skeleton className="h-9 w-full rounded-md" />}

        {isError && !isLoading && (
          <p className="text-sm text-destructive">
            Unable to load your forwarding address. Please try refreshing the
            page.
          </p>
        )}

        {data && !isLoading && (
          <>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={data.address}
                aria-label="Your forwarding address"
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy forwarding address"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Set this as a forwarding address in your email provider to send
              mail into your inbox here.{" "}
              <a
                href="https://github.com/pedromshin/nauta.services.email-listener/blob/main/.planning/phases/45-email-threads-forwarding-seam/FORWARDING-RUNBOOK.md"
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Setup guide (incl. Gmail verification) →
              </a>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
