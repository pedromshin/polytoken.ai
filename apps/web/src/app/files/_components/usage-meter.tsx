"use client";

import * as React from "react";

import { cn } from "@polytoken/ui";

import { vaultApi } from "../_lib/vault-api";
import { formatBytes } from "../_lib/vault-format";

/**
 * usage-meter.tsx — the /files header storage meter (DR-04).
 *
 * Reads `files.usageSummary` (the SAME `folderSizeRollup` total the upload
 * soft-block enforces, so the bar and the block can never disagree) and shows
 * "X of Y used" over a thin fill.
 *
 * INK, NEVER MADDER — a full bar is a status, not an irreversible act (law 1,
 * D-66-05). Even at/over quota the fill stays ink: the soft-block already tells
 * the user in words at the moment they try to upload; a red bar sitting in the
 * header would be a state shouting with nothing to do about it. The track is
 * the well step (`--shade`), the fill is `--ink`.
 */
export function UsageMeter(): React.ReactElement | null {
  const usage = vaultApi.files.usageSummary.useQuery(undefined, {
    // The meter is ambient chrome — a failure to load it must never take the
    // page down, so it simply renders nothing until it has a number.
    retry: false,
  });

  if (!usage.data) return null;

  const { usedBytes, quotaBytes } = usage.data;
  const pct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  return (
    <div
      data-slot="vault-usage-meter"
      className="flex min-w-0 flex-col gap-1"
      aria-label={`${formatBytes(usedBytes)} of ${formatBytes(quotaBytes)} used`}
    >
      <span className="tabular text-xs text-pencil">
        {formatBytes(usedBytes)} of {formatBytes(quotaBytes)}
      </span>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={quotaBytes}
        aria-valuenow={usedBytes}
        className="h-1 w-32 overflow-hidden rounded-full bg-shade"
      >
        <div
          data-slot="vault-usage-fill"
          className={cn("h-full rounded-full bg-ink transition-[width]")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
