"use client";

// Explicit React import — Next's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild transform needs `React` in
// scope for any suite that mounts this file directly (documented gotcha:
// genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@polytoken/ui/breadcrumb";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import { parseVaultPath } from "../../../../../../packages/api-client/src/router/files/vault-keys";
import { vaultApi } from "../_lib/vault-api";
import { VaultEmpty, VaultError, VaultLoading } from "./vault-states";
import { VaultListing } from "./vault-listing";

/**
 * VaultSurface — the /files client surface (Phase 66 Plan 03 Task 2).
 *
 * Owns exactly three things: the path (in the URL), the listing query, and the
 * state branch. Everything else is a child's job.
 *
 * ONE PANE. There is no tree, no metadata rail, and no permanent toolbar
 * (D-66-08 + anti-generic tell #5: "tree + toolbar + breadcrumb + list +
 * preview + metadata rail all permanently visible"). The vault HAS a folder
 * tree — the user authors it — and it is navigated by drilling into folder
 * rows, with the breadcrumb as the way back and `?path=` as its address. A
 * tree PANE's unique value is drag-a-file-into-a-folder and cross-branch
 * jumping; move/copy is OUT tonight, so it would earn a third permanent pane
 * and nothing else.
 *
 * The page scrolls. There is NO Radix ScrollArea here (D-66-05) — its Viewport
 * shrink-wraps via `display:table` (D-61-06), and this surface sidesteps that
 * trap by construction rather than managing it.
 */
export function VaultSurface(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * THE PATH LIVES IN THE URL (taste checklist item 7 — view state is
   * addressable, never trapped in `useState`).
   *
   * `parseVaultPath` is Plan 01's — reused, not re-split. It already rejects
   * traversal and collapses junk to the vault root, so a hand-edited URL shows
   * the user their own vault rather than an error page. It is UX; the server
   * re-validates every segment regardless (T-66-12).
   */
  const rawPath = searchParams.get("path");
  const path = useMemo(() => parseVaultPath(rawPath), [rawPath]);

  const listing = vaultApi.files.list.useQuery({ path });

  const navigateTo = useCallback(
    (segments: readonly string[]) => {
      const query = segments.map(encodeURIComponent).join("/");
      // `push`, not `replace`: the browser's Back button then walks OUT of a
      // folder. That is free navigation the user already knows, at zero
      // interface cost — and it is why there is no "up" button in the chrome.
      router.push(segments.length === 0 ? "/files" : `/files?path=${query}`);
    },
    [router],
  );

  const openFolder = useCallback(
    (name: string) => navigateTo([...path, name]),
    [navigateTo, path],
  );

  const downloadMutation = vaultApi.files.requestDownload.useMutation();

  const download = useCallback(
    (entry: VaultEntry) => {
      downloadMutation.mutate(
        { path, name: entry.name },
        {
          onSuccess: ({ url }) => {
            // The URL is minted with attachment disposition for every content
            // type (Plan 01), so navigating to it SAVES the file rather than
            // rendering it. Nothing uploaded is ever interpreted on our origin.
            window.location.href = url;
          },
        },
      );
    },
    [downloadMutation, path],
  );

  /**
   * ── PLAN 04 MOUNTS HERE ──────────────────────────────────────────────────
   * These two are deliberately inert in Plan 03 and are wired by Plan 04, so
   * that 04 is an INSERTION rather than a restructure:
   *   - `onUpload`  -> opens the hidden <input type="file"> (04 Task 1)
   *   - `onDelete`  -> opens the one confirm dialog (04 Task 2)
   * The drop layer wraps the <section> below, and the upload tray docks at its
   * foot.
   *
   * Stated plainly because it matters at review: until 04 lands, the empty
   * state's "Upload files" button and the rows' delete triggers RENDER but DO
   * NOTHING. That is a real (if short-lived) stub, and it is the honest
   * account of what Plan 03 alone ships.
   */
  const onUpload = useCallback(() => undefined, []);
  const onDelete = useCallback(() => undefined, []);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <VaultBreadcrumb path={path} onNavigate={navigateTo} />

      {/* The pane: one sheet, on the page's ground. Plan 04 mounts the drop
          layer HERE — the whole pane is the drop target, never a card inside
          it. Elevation is the ground ladder (leaf -> bright); there is no
          shadow on this surface and there is not going to be one. */}
      <section
        aria-label="Your files"
        className="rounded-card border border-rule bg-leaf"
      >
        {/* THE STATE BRANCH, IN A FIXED ORDER THAT IS ITSELF A BUG FIX.
            loading -> error -> empty -> listing. Branching on `isPending`
            FIRST is what stops a populated folder flashing "empty" on every
            navigation: react-query returns `data: undefined` while a new query
            key is in flight, and an empty-check that ran first would read that
            as "no files" for one frame — on every single folder walk. */}
        {listing.isPending ? (
          <VaultLoading />
        ) : listing.error ? (
          <VaultError onRetry={() => void listing.refetch()} />
        ) : (listing.data ?? []).length === 0 ? (
          <VaultEmpty atRoot={path.length === 0} onUpload={onUpload} />
        ) : (
          <VaultListing
            entries={listing.data ?? []}
            onOpenFolder={openFolder}
            onDownload={download}
            onDelete={onDelete}
          />
        )}
      </section>
    </div>
  );
}

/**
 * The breadcrumb IS the navigation now that there is no tree (D-66-08), so it
 * is never decorative and it is never dropped on mobile. Long trails truncate
 * the MIDDLE crumbs — never the last one, which is where you are.
 */
function VaultBreadcrumb({
  path,
  onNavigate,
}: {
  readonly path: readonly string[];
  readonly onNavigate: (segments: readonly string[]) => void;
}): React.ReactElement {
  return (
    <Breadcrumb>
      <BreadcrumbList className="text-pencil">
        <BreadcrumbItem>
          {path.length === 0 ? (
            <BreadcrumbPage className="text-ink">Files</BreadcrumbPage>
          ) : (
            <BreadcrumbLink
              asChild
              className="text-pencil transition-colors hover:text-ink"
            >
              <button type="button" onClick={() => onNavigate([])}>
                Files
              </button>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>

        {path.map((segment, index) => {
          const isLast = index === path.length - 1;
          const prefix = path.slice(0, index + 1);

          return (
            <React.Fragment key={`${segment}-${index}`}>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  // `aria-current="page"` is BreadcrumbPage's own doing. Not a
                  // link, and not truncated: this is where you are.
                  <BreadcrumbPage className="text-ink">{segment}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    asChild
                    className="min-w-0 text-pencil transition-colors hover:text-ink"
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(prefix)}
                      className="max-w-[12ch] truncate sm:max-w-[20ch]"
                    >
                      {segment}
                    </button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
