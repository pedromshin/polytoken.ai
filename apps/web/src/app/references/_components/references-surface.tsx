"use client";

import { Bookmark, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import { SaveReferenceForm } from "./save-reference-form";

/**
 * references-surface.tsx — the /references surface (999.35): save form on
 * top, owner-scoped list below.
 *
 * Reads/writes the `references` tRPC router (scoped through ownership.ts
 * server-side — this client never sends a user id). Identity + taste:
 *
 *   - Serif titles (law 2): the saved title is the user's own material, so it
 *     renders `font-serif` with `data-evidence`, exactly like the documents
 *     list. The note — also the user's own words — is serif too. All chrome
 *     stays sans.
 *   - Provenance line: hostname · saved date, muted sans metadata under the
 *     title. Dates are tabular (law 2).
 *   - Tag chips: ink on `border-hair` — NO new hue (law 1); tags are chrome
 *     metadata, not tier.
 *   - Delete is hover/focus-revealed (taste item 5), fires WITHOUT a confirm
 *     and offers Undo in a toast (taste item 2 — deleting is reversible
 *     because Undo re-saves the captured row, so it wears ink, not madder).
 *     The list updates optimistically and rolls back on error (item 6).
 *   - The empty state TEACHES: the save form above is the only prominent
 *     control, and the copy points at it (item 8).
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function ReferencesSurface(): React.ReactElement {
  const utils = api.useUtils();
  const query = api.references.list.useQuery();

  const save = api.references.save.useMutation({
    onSuccess: () => void utils.references.list.invalidate(),
  });

  const remove = api.references.remove.useMutation({
    // Optimistic removal: the row leaves the list immediately; the server
    // reconciles on settle and the snapshot restores on error.
    onMutate: async (variables) => {
      await utils.references.list.cancel();
      const previous = utils.references.list.getData();
      utils.references.list.setData(undefined, (data) =>
        data
          ? {
              ...data,
              items: data.items.filter((item) => item.id !== variables.id),
            }
          : data,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        utils.references.list.setData(undefined, context.previous);
      }
      toast.error("Couldn't delete that reference.");
    },
    onSettled: () => void utils.references.list.invalidate(),
  });

  function handleDelete(item: {
    id: string;
    url: string;
    title: string;
    note: string | null;
    tags: string[];
  }): void {
    remove.mutate({ id: item.id });
    toast("Reference deleted.", {
      action: {
        label: "Undo",
        onClick: () =>
          save.mutate({
            url: item.url,
            title: item.title,
            note: item.note ?? undefined,
            tags: item.tags,
          }),
      },
      duration: 5000,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <SaveReferenceForm />

      {query.isPending ? (
        <ul className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-md border border-rule bg-bright px-4 py-3"
            >
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-40" />
            </li>
          ))}
        </ul>
      ) : query.isError ? (
        <div className="rounded-md border border-rule bg-bright p-panel text-sm text-ink">
          <p className="font-medium">Couldn’t load your references.</p>
          <p className="mt-1 text-muted-foreground">
            {query.error.message}. Try again in a moment.
          </p>
        </div>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <div className="rounded-md border border-hair bg-leaf p-panel text-center">
          <Bookmark
            className="mx-auto h-6 w-6 text-ink"
            aria-hidden
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm font-medium text-ink">
            No references yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a URL in the form above, give it a title, and it lands here —
            tagged, annotated, and yours. Your first saved reference is the
            shelf’s onboarding.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {(query.data?.items ?? []).map((item) => (
            <li
              key={item.id}
              className="group relative rounded-md border border-rule bg-bright px-4 py-3 transition-colors hover:border-ink"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-serif text-sm text-ink underline-offset-2 hover:underline"
                    data-evidence
                  >
                    {item.title}
                  </a>

                  {/* Provenance line — where it came from, when it was kept. */}
                  <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                    {hostnameOf(item.url)}
                    <span aria-hidden> · </span>
                    <time
                      className="tabular"
                      dateTime={
                        item.savedAt instanceof Date
                          ? item.savedAt.toISOString()
                          : String(item.savedAt)
                      }
                    >
                      Saved {formatDate(item.savedAt)}
                    </time>
                  </p>

                  {item.note ? (
                    <p
                      className="mt-1.5 font-serif text-xs text-faded"
                      data-evidence
                    >
                      {item.note}
                    </p>
                  ) : null}

                  {item.tags.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-sm border border-hair px-1.5 py-0.5 text-2xs text-faded"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {/* Hover/focus-revealed delete — reversible via the Undo
                    toast, so it wears ink, never madder (law 1). */}
                <button
                  type="button"
                  onClick={() => handleDelete(item)}
                  aria-label={`Delete reference “${item.title}”`}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-shade hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="h-4 w-4" aria-hidden strokeWidth={1.5} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
