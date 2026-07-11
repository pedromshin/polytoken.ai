"use client";

import { useEffect, useRef } from "react";

import { ChevronLeft, Loader2, Unlink } from "lucide-react";
import Link from "next/link";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@polytoken/ui/card";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import {
  EntityFields,
  EntityFieldsSkeleton,
} from "./entity-fields";
import {
  EntityKnowledge,
  EntityKnowledgeSkeleton,
} from "./entity-knowledge";
import {
  EntityMergeSuggestions,
  EntityMergeSuggestionsSkeleton,
} from "./entity-merge-suggestions";
import {
  EntityOccurrences,
  EntityOccurrencesSkeleton,
} from "./entity-occurrences";
import { UnmergeDialog } from "./unmerge-dialog";
import { useEntityCuration } from "./use-entity-curation";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface EntityDetailProps {
  readonly entityId: string;
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

function EntityDetailLoading() {
  return (
    <div
      className="flex flex-col gap-4 p-4"
      aria-busy="true"
      aria-label="Loading entity…"
    >
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
}: {
  readonly status: "confirmed" | "candidate";
}) {
  if (status === "confirmed") {
    return (
      <Badge className="border border-tier-extracted bg-tier-extracted font-medium text-tier-extracted-foreground">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-tier-extracted-foreground" />
        Confirmed
      </Badge>
    );
  }
  return (
    <Badge className="border border-tier-inferred bg-tier-inferred font-medium text-tier-inferred-foreground">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-tier-inferred-foreground" />
      Candidate
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EntityDetail({ entityId }: EntityDetailProps) {
  const h1Ref = useRef<HTMLHeadingElement>(null);

  const { data, isLoading, isError } = api.entities.byId.useQuery({
    id: entityId,
  });

  const curation = useEntityCuration(entityId);

  useEffect(() => {
    if (!isLoading && !isError && data !== undefined) {
      h1Ref.current?.focus();
    }
  }, [isLoading, isError, data]);

  // Loading
  if (isLoading) {
    return <EntityDetailLoading />;
  }

  // Error
  if (isError) {
    return (
      <div className="p-4">
        <Card className="border-destructive" role="alert">
          <CardHeader>
            <CardTitle className="text-destructive">
              Failed to load entity
            </CardTitle>
            <CardDescription>
              Unable to load this entity. Please try refreshing the page.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Not found
  if (data === null || data === undefined) {
    return (
      <div className="p-4">
        <Card>
          <CardHeader>
            <CardTitle>Entity not found</CardTitle>
            <CardDescription>
              This entity may have been merged into another or the link is
              invalid.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const { entity, occurrences, fields, knowledgeNodes, pendingSuggestions, wasMerged } =
    data;

  const status: "confirmed" | "candidate" = entity.isActive
    ? "confirmed"
    : "candidate";

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-4 border-b px-4 py-3 shrink-0">
        <Link
          href="/entities"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All entities
        </Link>

        <h1
          ref={h1Ref}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight outline-none"
        >
          {entity.displayName}
        </h1>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={status} />
          <Badge variant="outline" className="text-xs">
            {entity.entityTypeLabel ?? entity.entityTypeId}
          </Badge>

          {/* Unmerge affordance (D-20) — only when wasMerged=true */}
          {wasMerged && (
            <UnmergeDialog
              onConfirm={curation.unmerge}
              disabled={curation.isUnmerging}
            >
              {curation.isUnmerging ? (
                <Loader2
                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Unlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              Unmerge
            </UnmergeDialog>
          )}
        </div>
      </header>

      {/* Body regions */}
      <div className="flex flex-col gap-4 px-4 pb-6">
        <EntityOccurrences occurrences={occurrences} />
        <EntityFields fields={fields} />
        <EntityKnowledge knowledgeNodes={knowledgeNodes} />
        <EntityMergeSuggestions
          suggestions={pendingSuggestions}
          onConfirm={curation.confirmMerge}
          onReject={curation.rejectMerge}
          confirmingIds={curation.confirmingIds}
          rejectingIds={curation.rejectingIds}
        />
      </div>
    </div>
  );
}
