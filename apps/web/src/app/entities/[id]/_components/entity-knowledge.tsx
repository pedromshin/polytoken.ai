"use client";

import { format } from "date-fns";

import { Badge } from "@polytoken/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@polytoken/ui/card";
import { Skeleton } from "@polytoken/ui/skeleton";

import { SendToMenu } from "~/app/_components/send-to-menu";

// ---------------------------------------------------------------------------
// Types (matched to entities.byId knowledgeNodes shape)
// ---------------------------------------------------------------------------

export interface KnowledgeNode {
  readonly id: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly source: string | null;
  readonly confidence: number | null;
  readonly createdAt: Date | null;
}

interface EntityKnowledgeProps {
  readonly knowledgeNodes: ReadonlyArray<KnowledgeNode>;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function EntityKnowledgeSkeleton() {
  return <Skeleton className="h-24 w-full" aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EntityKnowledge({ knowledgeNodes }: EntityKnowledgeProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Knowledge</CardTitle>
      </CardHeader>
      <CardContent>
        {knowledgeNodes.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-4">
            No knowledge nodes attached to this entity yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {knowledgeNodes.map((node) => (
              <li
                key={node.id}
                className="rounded border px-3 py-2 text-sm space-y-1"
              >
                {/* AI-04: send this knowledge node to a conversation. The
                    entity instance itself has no rail; the knowledge nodes it
                    surfaces do (real knowledge_node ids). */}
                <div className="flex items-start justify-between gap-2">
                  {node.title !== null ? (
                    <p className="font-medium">{node.title}</p>
                  ) : (
                    <span />
                  )}
                  <SendToMenu
                    object={{
                      kind: "knowledge_node",
                      nodeId: node.id,
                      label: node.title ?? undefined,
                    }}
                    objectName={node.title ?? "knowledge node"}
                  />
                </div>
                {node.content !== null && (
                  <p className="text-muted-foreground text-xs line-clamp-3">
                    {node.content}
                  </p>
                )}
                <div className="flex items-center gap-2 pt-0.5">
                  {node.source !== null && (
                    <Badge variant="secondary" className="text-xs">
                      {node.source}
                    </Badge>
                  )}
                  {node.confidence !== null && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(node.confidence * 100)}% confidence
                    </span>
                  )}
                  {node.createdAt !== null && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format(new Date(node.createdAt), "PP")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
