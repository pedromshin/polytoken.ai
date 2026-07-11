"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@polytoken/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@polytoken/ui/card";

import type { GalleryItem } from "./entities-table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EntitiesMosaicProps {
  readonly items: ReadonlyArray<GalleryItem>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(date: Date | null): string {
  if (date === null) return "—";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function formatKeyIdentifiers(identifiers: Record<string, unknown>): string {
  return Object.values(identifiers)
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join(", ");
}

// ---------------------------------------------------------------------------
// Status badge — inline (small variant for mosaic cards)
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
}: {
  readonly status: "confirmed" | "candidate";
}): React.ReactElement {
  if (status === "confirmed") {
    return (
      <Badge className="bg-primary/10 text-primary border-primary/20 text-xs px-2 py-0.5">
        Confirmed
      </Badge>
    );
  }
  return (
    <Badge className="bg-tier-inferred text-tier-inferred-foreground border-tier-inferred text-xs px-2 py-0.5">
      Candidate
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Single mosaic card
// ---------------------------------------------------------------------------

function MosaicCard({ item }: { readonly item: GalleryItem }): React.ReactElement {
  const router = useRouter();
  const isCandidate = item.status === "candidate";
  const identifierText = formatKeyIdentifiers(item.keyIdentifiers);

  return (
    <Card
      role="article"
      aria-label={`${item.displayName} entity`}
      onClick={() => router.push(`/entities/${item.id}`)}
      className={`cursor-pointer backdrop-blur-sm border-border/50 hover:border-primary/30 transition-colors ${
        isCandidate ? "bg-tier-inferred/10 border-tier-inferred/30" : "bg-card/80"
      }`}
    >
      <CardHeader className="pb-2">
        {/* Row 1: entity-type badge + status badge */}
        <div className="flex items-center gap-2 flex-wrap">
          {item.entityTypeLabel !== null && (
            <Badge className="bg-graph-entity/10 text-graph-entity border-graph-entity/30 text-xs px-2 py-0.5">
              {item.entityTypeLabel}
            </Badge>
          )}
          <StatusBadge status={item.status} />
        </div>

        {/* Row 2: display name */}
        <CardTitle className="text-sm font-semibold leading-tight mt-1 line-clamp-2">
          {item.displayName}
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-0 space-y-1">
        {/* Key identifiers */}
        {identifierText.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">{identifierText}</p>
        )}

        {/* Occurrences + last seen */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{item.occurrenceCount} emails</span>
          <span aria-hidden>·</span>
          <span>{formatRelativeDate(item.lastSeen)}</span>
        </div>

        {/* Duplicates indicator (conditional) */}
        {item.pendingDuplicatesCount > 0 && (
          <Badge className="bg-destructive/10 text-destructive border-destructive/30 text-xs mt-1">
            {item.pendingDuplicatesCount} possible duplicates
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mosaic grid
// ---------------------------------------------------------------------------

export function EntitiesMosaic({ items }: EntitiesMosaicProps): React.ReactElement {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6">
      {items.map((item) => (
        <MosaicCard key={item.id} item={item} />
      ))}
    </div>
  );
}
