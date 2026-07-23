"use client";

import Link from "next/link";
import {
  Inbox,
  Boxes,
  FileText,
  ArrowRight,
  Pin,
  Check,
} from "lucide-react";
import * as React from "react";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { shapeMorningBrief } from "../_lib/morning-brief";
import { MorningBriefPanel } from "./morning-brief-panel";

const PANEL_LIMIT = 6;

/** The home layout's sharedState key for the pinned panel arrangement — the
 * `home.*` namespace mirrors the canvas store's `panels.*`/`shared.*`
 * convention, so the home snapshot never smuggles in a canvas NODE TYPE (the
 * arrangement lives in sharedState, nodes stay empty). Consumed by the agentic
 * rearrange half (CH-03) once it lands. */
const HOME_PANELS_KEY = "home.panels";
const HOME_REGISTRY_VERSION = "home-v1";

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function fmtDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

/**
 * home-board.tsx — HM-01 board surface + HM-02 morning brief.
 *
 * Reads EXISTING owner-scoped routers only (no new backend): emails.listThreads
 * (inbox summary), entities.list (today's entities), documents.list (recent
 * documents), and — for the brief — entities.reviewQueue (EN-02). The pinned
 * layout is loaded/saved through the REUSED canvas persistence, home-scoped
 * (chat.getHomeCanvasLayout / chat.saveHomeCanvasLayout, migration 0046).
 *
 * The cost-meter panel HM-01 lists is intentionally omitted here: the only cost
 * query today (chat.sessionCost) is per-conversation, and inventing a
 * user-level cost aggregate is out of scope for this batch (do-not-invent-
 * backends) — see the handoff.
 */
export function HomeBoard(): React.ReactElement {
  const homeLayout = api.chat.getHomeCanvasLayout.useQuery();
  const threads = api.emails.listThreads.useQuery({ limit: PANEL_LIMIT });
  const entities = api.entities.list.useQuery({ limit: PANEL_LIMIT });
  const documents = api.documents.list.useQuery({ limit: PANEL_LIMIT });
  const reviews = api.entities.reviewQueue.useQuery({ limit: PANEL_LIMIT });

  const saveLayout = api.chat.saveHomeCanvasLayout.useMutation();

  const brief = React.useMemo(
    () =>
      shapeMorningBrief({
        threads: threads.data,
        reviews: reviews.data,
        documents: documents.data,
      }),
    [threads.data, reviews.data, documents.data],
  );

  const briefPending =
    threads.isPending || reviews.isPending || documents.isPending;

  // Reuse the home persistence (both directions): persist the current panel
  // arrangement into the home-scoped layout row's sharedState. nodes/edges stay
  // empty — a home board pins panels, not canvas nodes (no new node type).
  const onPinBoard = React.useCallback(() => {
    saveLayout.mutate({
      snapshot: {
        nodes: [],
        edges: [],
        sharedState: {
          [HOME_PANELS_KEY]: [
            "inbox-summary",
            "todays-entities",
            "recent-documents",
            "morning-brief",
          ],
        },
        nodeRegistryVersion: HOME_REGISTRY_VERSION,
      },
    });
  }, [saveLayout]);

  return (
    <main className="flex min-h-[calc(100vh-3.5rem)] w-full flex-col bg-shelf">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-rule px-4">
        <h1 className="text-sm font-semibold text-ink">Home</h1>
        {homeLayout.isFetched ? (
          <button
            type="button"
            onClick={onPinBoard}
            disabled={saveLayout.isPending}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faded transition-colors hover:bg-shade hover:text-ink disabled:opacity-50"
          >
            {saveLayout.isSuccess ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Pin className="size-3.5" aria-hidden />
            )}
            {saveLayout.isSuccess ? "Pinned" : "Pin board"}
          </button>
        ) : null}
        <Link
          href="/"
          className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-faded transition-colors hover:bg-shade hover:text-ink"
        >
          <Inbox className="size-3.5" aria-hidden />
          Open inbox
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <BoardPanel
            title="Inbox"
            icon={<Inbox className="size-4 text-ink" aria-hidden strokeWidth={1.5} />}
            href="/"
            isPending={threads.isPending}
            isError={threads.isError}
            count={threads.data?.items.length ?? 0}
          >
            {(threads.data?.items ?? []).map((t) => (
              <li key={t.key} className="flex items-center gap-2 truncate text-sm text-ink">
                <span className="truncate">{t.subject ?? "(no subject)"}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {fmtDate(t.latestReceivedAt)}
                </span>
              </li>
            ))}
          </BoardPanel>

          <BoardPanel
            title="Today’s entities"
            icon={<Boxes className="size-4 text-ink" aria-hidden strokeWidth={1.5} />}
            href="/entities"
            isPending={entities.isPending}
            isError={entities.isError}
            count={entities.data?.items.length ?? 0}
          >
            {(entities.data?.items ?? []).map((e) => (
              <li key={e.id} className="flex items-center gap-2 truncate text-sm">
                <Link href={`/entities/${e.id}`} className="truncate text-ink underline-offset-2 hover:underline">
                  {e.displayName}
                </Link>
                {e.entityTypeLabel ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {e.entityTypeLabel}
                  </span>
                ) : null}
              </li>
            ))}
          </BoardPanel>

          <BoardPanel
            title="Recent documents"
            icon={<FileText className="size-4 text-ink" aria-hidden strokeWidth={1.5} />}
            href="/documents"
            isPending={documents.isPending}
            isError={documents.isError}
            count={documents.data?.items.length ?? 0}
          >
            {(documents.data?.items ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 truncate text-sm">
                <Link href={`/documents/${d.id}`} className="truncate text-ink underline-offset-2 hover:underline">
                  {d.title}
                </Link>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {fmtDate(d.createdAt)}
                </span>
              </li>
            ))}
          </BoardPanel>

          <MorningBriefPanel brief={brief} isPending={briefPending} />
        </div>
      </div>
    </main>
  );
}

function BoardPanel({
  title,
  icon,
  href,
  isPending,
  isError,
  count,
  children,
}: {
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly href: string;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly count: number;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      aria-label={title}
      className="flex flex-col rounded-md border border-rule bg-bright"
    >
      <header className="flex items-center gap-2 border-b border-rule px-panel py-3">
        {icon}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Link
          href={href}
          className="ml-auto text-xs text-faded transition-colors hover:text-ink"
        >
          View all
        </Link>
      </header>
      <div className="min-h-0 flex-1 p-panel">
        {isPending ? (
          <div className="flex flex-col gap-2" aria-busy>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Couldn’t load {title.toLowerCase()}. Try again in a moment.
          </p>
        ) : count === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">{children}</ul>
        )}
      </div>
    </section>
  );
}
