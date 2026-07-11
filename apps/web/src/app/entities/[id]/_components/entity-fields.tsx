"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@polytoken/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@polytoken/ui/card";
import { Skeleton } from "@polytoken/ui/skeleton";

// ---------------------------------------------------------------------------
// Types (matched to entities.byId AggregatedField shape — D-18/D-19)
// ---------------------------------------------------------------------------

export interface FieldValueProvenance {
  readonly value: string;
  readonly emailId: string;
  readonly emailSubject: string | null;
  readonly receivedAt: Date | null;
  readonly extractionStatus: string;
}

export interface AggregatedField {
  readonly fieldSlug: string;
  readonly fieldLabel: string | null;
  readonly conflicting: boolean;
  readonly values: ReadonlyArray<FieldValueProvenance>;
}

interface EntityFieldsProps {
  readonly fields: ReadonlyArray<AggregatedField>;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function EntityFieldsSkeleton() {
  return <Skeleton className="h-56 w-full" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EntityFields({ fields }: EntityFieldsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Extracted Fields</CardTitle>
      </CardHeader>
      <CardContent>
        {fields.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No fields extracted for this entity.
          </p>
        ) : (
          <dl className="space-y-3">
            {fields.map((field) => (
              <div key={field.fieldSlug}>
                <dt className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {field.fieldLabel ?? field.fieldSlug}
                  {field.conflicting && (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      conflict
                    </span>
                  )}
                </dt>
                <dd>
                  {field.values.map((prov, idx) => (
                    <div
                      key={`${prov.value}-${prov.emailId}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-sm mb-1 last:mb-0"
                    >
                      <span className="font-medium">{prov.value}</span>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {prov.extractionStatus}
                      </Badge>
                    </div>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
