"use client";

/**
 * email-circle-pack-view.tsx — the email circle-pack "landscape" view
 * (FEATURE-CATALOG TM-02): a fourth inbox view beside the three-pane. It renders
 * the shared `CirclePack` primitive (TM-01) over `emails.circlePackLandscape`
 * (TM-02 aggregate, owned-scoped): entity/sender → thread → email, leaf size =
 * message count, leaf tint = recency. Clicking a leaf deep-links `/emails/[id]`.
 *
 * "See your email as a landscape" — the pack fills the pane; it measures itself
 * so the circles use the real available box (jsdom does no layout, so the fixed
 * fallback keeps SSR/tests sane).
 *
 * DESIGN LAW: chrome monochrome (the primitive commits to ink washes only); the
 * hover card's subject is the mail's own words → serif + data-evidence (the
 * pair, law 2); the sender/summary line stays sans.
 */

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDashed } from "lucide-react";

import { CirclePack, type CircleDatum } from "@polytoken/ui/circle-pack";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";
import { hrefFor } from "~/components/provenance-link";

interface LandscapeLeaf {
  readonly emailId: string;
  readonly subject: string | null;
  readonly senderAddress: string;
  readonly receivedAt: string;
}

/** Measure the container so the pack fills the pane (falls back for SSR/tests). */
function useMeasuredSize(): {
  ref: React.RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 720, height: 560 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        setSize({ width: Math.floor(box.width), height: Math.floor(box.height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width: size.width, height: size.height };
}

export function EmailCirclePackView(): React.ReactElement {
  const router = useRouter();
  const { ref, width, height } = useMeasuredSize();
  const query = api.emails.circlePackLandscape.useQuery({});

  const tree = query.data as CircleDatum<LandscapeLeaf> | undefined;
  const hasContent = tree !== undefined && (tree.children?.length ?? 0) > 0;

  return (
    <div
      ref={ref}
      data-pane="landscape"
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-leaf p-panel"
    >
      {query.isPending ? (
        <div role="status" aria-label="Loading landscape">
          <Skeleton className="size-[min(60vh,60vw)] rounded-full" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <CircleDashed className="size-6 text-ink" aria-hidden />
          <p className="text-sm text-faded">Couldn&apos;t load your email landscape.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-sm px-2 py-1 text-sm text-faded transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            Retry
          </button>
        </div>
      ) : hasContent && tree ? (
        <CirclePack<LandscapeLeaf>
          data={tree}
          width={width}
          height={height}
          ariaLabel="Email landscape — senders, threads and messages as packed circles"
          className="bg-transparent"
          onLeafActivate={(circle) => {
            const leaf = circle.datum.leaf;
            if (leaf) router.push(hrefFor("email", leaf.emailId));
          }}
          renderHoverCard={(circle) => (
            <span className="flex flex-col gap-0.5">
              {/* the mail's own subject — serif + data-evidence (the pair) */}
              <span className="truncate font-serif text-ink" data-evidence>
                {circle.datum.name}
              </span>
              <span className="tabular text-2xs text-faded">
                {circle.isLeaf
                  ? (circle.datum.leaf?.senderAddress ?? "")
                  : `${circle.value.toLocaleString()} messages`}
              </span>
            </span>
          )}
        />
      ) : (
        <div className="flex max-w-sm flex-col items-center gap-2 text-center">
          <CircleDashed className="size-6 text-faded" aria-hidden />
          <p className="text-sm font-semibold text-ink">No mail to map yet</p>
          <p className="text-sm text-faded">
            Forward mail to your polytoken address and your inbox will appear here
            as a landscape of senders, threads and messages.
          </p>
        </div>
      )}
    </div>
  );
}
