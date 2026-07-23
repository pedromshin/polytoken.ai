"use client";

import Link from "next/link";
import { Mail, GitMerge, FileText, Sunrise } from "lucide-react";
import * as React from "react";

import type { MorningBrief } from "../_lib/morning-brief";

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/**
 * morning-brief-panel.tsx — HM-02: the morning-brief genui panel.
 *
 * A THIN render over the pure `MorningBrief` shape (see _lib/morning-brief.ts,
 * which folds emails.listThreads + entities.reviewQueue + documents.list). It
 * owns no data fetching — the board hands it the already-shaped brief so the
 * fold stays unit-testable and this component stays presentational.
 *
 * Three sections: new-email digest, proposed merges awaiting review (EN-02,
 * each row deep-links to /entities where the merge is confirmed/rejected), and
 * documents generated recently. An all-empty brief shows a calm "nothing new"
 * state rather than three empty lists.
 */
export function MorningBriefPanel({
  brief,
  isPending,
}: {
  readonly brief: MorningBrief | null;
  readonly isPending: boolean;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="morning-brief-heading"
      className="flex flex-col rounded-md border border-rule bg-bright"
    >
      <header className="flex items-center gap-2 border-b border-rule px-panel py-3">
        <Sunrise className="size-4 text-ink" aria-hidden strokeWidth={1.5} />
        <h2 id="morning-brief-heading" className="text-sm font-semibold text-ink">
          Morning brief
        </h2>
        {brief && !isPending ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {timeFmt.format(brief.generatedAt)}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 p-panel">
        {isPending || !brief ? (
          <p className="text-sm text-muted-foreground" aria-busy>
            Assembling your brief…
          </p>
        ) : brief.isEmpty ? (
          <p className="text-sm text-muted-foreground">
            Nothing new since yesterday. You’re all caught up.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <BriefSection
              icon={<Mail className="size-3.5" aria-hidden strokeWidth={1.5} />}
              title="New email"
              count={brief.counts.newEmails}
            >
              {brief.newEmails.map((e) => (
                <li key={e.key} className="truncate text-sm text-ink">
                  {e.subject}
                  {e.messageCount > 1 ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {e.messageCount}
                    </span>
                  ) : null}
                </li>
              ))}
            </BriefSection>

            <BriefSection
              icon={
                <GitMerge className="size-3.5" aria-hidden strokeWidth={1.5} />
              }
              title="Merges to review"
              count={brief.counts.pendingMerges}
            >
              {brief.pendingMerges.map((m) => (
                <li key={m.pairKey} className="truncate text-sm">
                  <Link
                    href="/entities"
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {m.subjectName}
                    <span className="text-muted-foreground"> ↔ </span>
                    {m.candidateName}
                  </Link>
                </li>
              ))}
            </BriefSection>

            <BriefSection
              icon={
                <FileText className="size-3.5" aria-hidden strokeWidth={1.5} />
              }
              title="New documents"
              count={brief.counts.recentDocuments}
            >
              {brief.recentDocuments.map((d) => (
                <li key={d.id} className="truncate text-sm">
                  <Link
                    href={`/documents/${d.id}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {d.title}
                  </Link>
                </li>
              ))}
            </BriefSection>
          </div>
        )}
      </div>
    </section>
  );
}

function BriefSection({
  icon,
  title,
  count,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
}): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        <span>{title}</span>
        <span className="text-muted-foreground">({count})</span>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">{children}</ul>
    </div>
  );
}
