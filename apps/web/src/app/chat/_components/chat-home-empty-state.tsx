"use client";

import { MessageSquarePlus, Plus } from "lucide-react";

import { EmptyState } from "~/components/empty-state";

interface ChatHomeEmptyStateProps {
  readonly onNewChat: () => void;
  readonly creating?: boolean;
}

/**
 * ChatHomeEmptyState (D-13) — the /chat landing surface shown in the main
 * column when no conversation is selected. Mirrors entities-gallery.tsx's
 * EmptyState shape (icon + heading + body) but larger — this is a primary
 * landing surface, not a sparse-list state — per 22-UI-SPEC.md Layout §1 +
 * Copywriting Contract. The button here is the same "New chat" CTA as the
 * rail's, surfaced larger for the case the rail is collapsed.
 *
 * Thin wrapper (FIX-11, 26-UI-SPEC.md § "FIX-11") around the shared
 * EmptyState primitive — centered/muted/spacious + a "New chat" action —
 * kept as its own named export so ./page.tsx's call site stays stable.
 */
export function ChatHomeEmptyState({
  onNewChat,
  creating = false,
}: ChatHomeEmptyStateProps): React.ReactElement {
  return (
    <EmptyState
      icon={MessageSquarePlus}
      heading="Ask me anything"
      body="I'll stream the answer back — sometimes with interactive widgets built right in."
      layout="centered"
      tone="muted"
      size="spacious"
      action={{
        label: "New chat",
        icon: Plus,
        onClick: onNewChat,
        disabled: creating,
      }}
    />
  );
}
