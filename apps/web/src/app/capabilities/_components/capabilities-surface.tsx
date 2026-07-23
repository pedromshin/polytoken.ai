"use client";

/**
 * capabilities-surface.tsx — the "what can my agent do" panel (v2.0 allowlist, E6-thinned).
 *
 * One client surface: fetches `api.capabilities.manifest` (the static builtin mirror — the
 * live-daemon fetch is a seam in `packages/api-client/src/router/capabilities/index.ts`),
 * groups by risk tier (highest consequence first), and wires each row's Switch to the
 * client-persisted allowlist (`_lib/allowlist.ts` — the server-persistence seam).
 *
 * Design law applied (58-IDENTITY + taste-references):
 *   - colour earned: the ONLY hue on this page is the per-tier swatch dot — risk is the one
 *     axis where tier colour is semantic here (see `_lib/capability-vocabulary.ts`).
 *   - toggle is the primary action: reachable in one click on every row, fires instantly
 *     (localStorage is synchronous — nothing to be optimistic ABOUT), no confirm modal —
 *     a toggle is its own undo.
 *   - an OFF row states itself in opacity (ink weight), never hue.
 *   - the empty state teaches; loading is skeleton rows in the final geometry (no spinner);
 *     the error frame is `border-rule` + `text-ink` with the glyph carrying the role — never
 *     madder on a state.
 */
import * as React from "react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import { Skeleton } from "@polytoken/ui/skeleton";
import { Switch } from "@polytoken/ui/switch";

import { api } from "~/trpc/react";

import { useCapabilityAllowlist } from "../_lib/allowlist";
import {
  COST_LABEL,
  IRREVERSIBLE_LABEL,
  ORIGIN_LABEL,
  RISK_ORDER,
  RISK_TIER,
  TRUST_BADGE,
  type ManifestEntry,
  type RiskTier,
} from "../_lib/capability-vocabulary";

export function CapabilitiesSurface(): React.ReactElement {
  const manifestQuery = api.capabilities.manifest.useQuery();
  const allowlist = useCapabilityAllowlist();

  if (manifestQuery.isPending) return <LoadingState />;
  if (manifestQuery.isError) {
    return <ErrorState onRetry={() => void manifestQuery.refetch()} />;
  }

  const entries = manifestQuery.data;
  if (entries.length === 0) return <EmptyState />;

  const byTier = new Map<RiskTier, ManifestEntry[]>();
  for (const entry of entries) {
    const group = byTier.get(entry.risk);
    if (group) {
      group.push(entry);
    } else {
      byTier.set(entry.risk, [entry]);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header>
        <p className="text-xs leading-relaxed text-faded">
          Everything the agent can do — anything not listed here does not exist for it. Switch a
          capability off and the agent loses it.
        </p>
        <p className="mt-1 text-2xs text-pencil">
          <span className="tabular">{entries.length}</span> capabilities
          {allowlist.hydrated && allowlist.deniedCount > 0 ? (
            <>
              {" · "}
              <span className="tabular">{allowlist.deniedCount}</span> switched off
            </>
          ) : (
            " · all allowed"
          )}
        </p>
      </header>

      {RISK_ORDER.map((tier) => {
        const group = byTier.get(tier);
        if (!group || group.length === 0) return null;
        return (
          <RiskGroup
            key={tier}
            tier={tier}
            entries={group}
            hydrated={allowlist.hydrated}
            isAllowed={allowlist.isAllowed}
            setAllowed={allowlist.setAllowed}
          />
        );
      })}
    </div>
  );
}

function RiskGroup(props: {
  tier: RiskTier;
  entries: readonly ManifestEntry[];
  hydrated: boolean;
  isAllowed: (id: string) => boolean;
  setAllowed: (id: string, allowed: boolean) => void;
}): React.ReactElement {
  const vocab = RISK_TIER[props.tier];
  const headingId = `risk-tier-${props.tier}`;

  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-baseline gap-2">
        {/* THE one earned hue on this surface: the tier's semantic swatch. */}
        <span aria-hidden className={cn("size-2 self-center rounded-full", vocab.swatch)} />
        <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-ink">
          {vocab.label}
        </h2>
        <span className="hidden text-2xs text-pencil sm:inline">{vocab.meaning}</span>
        <span className="ml-auto text-2xs tabular text-pencil">{props.entries.length}</span>
      </div>

      <ul className="mt-2 divide-y divide-hair rounded-md border border-rule bg-bright">
        {props.entries.map((entry) => (
          <CapabilityRow
            key={entry.id}
            entry={entry}
            hydrated={props.hydrated}
            allowed={props.isAllowed(entry.id)}
            onAllowedChange={(allowed) => props.setAllowed(entry.id, allowed)}
          />
        ))}
      </ul>
    </section>
  );
}

function CapabilityRow(props: {
  entry: ManifestEntry;
  hydrated: boolean;
  allowed: boolean;
  onAllowedChange: (allowed: boolean) => void;
}): React.ReactElement {
  const { entry } = props;
  const trust = TRUST_BADGE[entry.trust];
  const cost = COST_LABEL[entry.cost];

  return (
    <li className="flex items-center gap-3 px-row-x py-row-y">
      {/* An OFF capability states itself in ink weight (opacity), never hue. */}
      <div className={cn("min-w-0 flex-1", !props.allowed && "opacity-50")}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-ink">{entry.id}</span>
          {/* Trust badge — CHROME stating a tier-like fact: `.badge` grammar (sans, ink),
              never `pmark` (that would put serif on chrome). Solid vs dashed border is the
              same accountable-vs-not geometry the provenance mark already taught. */}
          <span
            className={cn(
              "rounded-sm border border-rule px-chip-x py-px text-2xs text-faded",
              trust.borderStyle,
            )}
          >
            {trust.label}
          </span>
          {/* §5.2 card-face closeout (AI-02): reversibility is DECLARED data — the manifest
              carries it, so the card states it. Same badge grammar as trust (ink, solid border
              = accountable fact); absent ⇒ reversible ⇒ silence, never a "reversible" chip. */}
          {entry.reversibility === "irreversible" && (
            <span className="rounded-sm border border-solid border-rule px-chip-x py-px text-2xs font-medium text-faded">
              {IRREVERSIBLE_LABEL}
            </span>
          )}
          <span className="text-2xs text-pencil">
            {ORIGIN_LABEL[entry.origin]}
            {cost !== null && (
              <>
                {" · "}
                <span className="font-medium text-faded">{cost}</span>
              </>
            )}
          </span>
        </div>
        <p className="mt-0.5 max-w-[65ch] text-xs leading-relaxed text-faded">{entry.describe}</p>
      </div>

      {/* The wrapper (not the 20px pill itself) takes the 44px WCAG floor on a coarse
          pointer — stretching the Switch root would distort the control. */}
      <span className="flex shrink-0 items-center justify-center pointer-coarse:touch-target">
        <Switch
          checked={props.hydrated ? props.allowed : true}
          disabled={!props.hydrated}
          onCheckedChange={props.onAllowedChange}
          aria-label={`Allow ${entry.id}`}
        />
      </span>
    </li>
  );
}

/** Skeleton rows in the final geometry — no spinner, no layout shift on resolve. */
function LoadingState(): React.ReactElement {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <Skeleton className="h-4 w-3/4 max-w-md" />
        <Skeleton className="mt-2 h-3 w-32" />
      </div>
      {[3, 4, 3].map((rows, groupIndex) => (
        <div key={groupIndex}>
          <Skeleton className="h-3.5 w-28" />
          <div className="mt-2 divide-y divide-hair rounded-md border border-rule bg-bright">
            {Array.from({ length: rows }, (_, rowIndex) => (
              <div key={rowIndex} className="flex items-center gap-3 px-row-x py-row-y">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-1.5 h-3 w-full max-w-lg" />
                </div>
                <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Error is a state: `border-rule` + ink, the glyph carries the role — no madder (law 1). */
function ErrorState(props: { onRetry: () => void }): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div role="alert" className="rounded-md border border-rule bg-bright p-panel">
        <p className="text-sm font-medium text-ink">
          <span aria-hidden className="mr-1.5">
            !
          </span>
          Couldn&rsquo;t load the capability manifest.
        </p>
        <p className="mt-1 text-xs text-faded">
          The list of what your agent can do is unavailable right now — nothing about your
          allowlist has changed.
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

/** The empty state teaches what this surface IS — there is no user action to offer yet. */
function EmptyState(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-md border border-rule bg-bright p-panel">
        <p className="text-sm font-medium text-ink">No capabilities registered yet.</p>
        <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-faded">
          The agent can only act through capabilities declared in its registry — each one states
          what it does, how risky it is, and where it runs. As soon as the first one registers,
          it appears here with an allow switch.
        </p>
      </div>
    </div>
  );
}
