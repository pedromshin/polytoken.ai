"use client";

// Explicit React import — Next's SWC automatic JSX runtime tolerates its
// absence, but vitest's classic-runtime esbuild transform needs `React` in
// scope for any suite that mounts this file directly (documented gotcha:
// genui-panel-node.tsx / 53-03 / 53-04's identical fix).
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@polytoken/ui/breadcrumb";
import { Button } from "@polytoken/ui/button";

import type { VaultEntry } from "../../../../../../packages/api-client/src/router/files/vault-types";
import { parseVaultPath } from "../../../../../../packages/api-client/src/router/files/vault-keys";
import { useVaultDrop } from "../_lib/use-vault-drop";
import { useVaultUpload } from "../_lib/use-vault-upload";
import { vaultApi } from "../_lib/vault-api";
import { DeleteDialog } from "./delete-dialog";
import { NewFolderRow } from "./new-folder-row";
import { UploadTray } from "./upload-tray";
import { VaultDropLayer } from "./vault-drop-layer";
import { VaultEmpty, VaultError, VaultLoading, VaultLoadMore } from "./vault-states";
import { VaultListing } from "./vault-listing";

/**
 * VaultSurface — the /files client surface (Phase 66 Plans 03 + 04).
 *
 * ONE PANE. There is no tree, no metadata rail, and no permanent toolbar
 * (D-66-08 + anti-generic tell #5). The vault HAS a folder tree — the user
 * authors it — and it is navigated by drilling into folder rows, with the
 * breadcrumb as the way back and `?path=` as its address. A tree PANE's unique
 * value is drag-a-file-into-a-folder and cross-branch jumping; move/copy is
 * OUT tonight, so it would earn a third permanent pane and nothing else.
 *
 * The page scrolls. No Radix ScrollArea (D-66-05) — its Viewport shrink-wraps
 * via `display:table` (D-61-06). Sidestepped by construction.
 *
 * THE WHOLE PANE IS THE DROP TARGET (D-66-11) — not a card inside it, not a
 * button. That is why the empty state's copy says "anywhere".
 */
export function VaultSurface(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * THE PATH LIVES IN THE URL (taste item 7 — view state is addressable, never
   * trapped in `useState`). `parseVaultPath` is Plan 01's — reused, not
   * re-split. It rejects traversal and collapses junk to the root, so a
   * hand-edited URL shows the user their own vault rather than an error page.
   * UX only: the server re-validates every segment regardless (T-66-12).
   */
  const rawPath = searchParams.get("path");
  const path = useMemo(() => parseVaultPath(rawPath), [rawPath]);

  /**
   * PAGED, not truncated (v2.1 hardening). Phase 66 fetched one 500-entry
   * page and silently dropped the rest; the cursor makes every entry
   * reachable. `getNextPageParam` echoes the server's `nextCursor` — the
   * client never invents an offset.
   */
  const listing = vaultApi.files.list.useInfiniteQuery(
    { path },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const utils = vaultApi.useUtils();

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderError, setFolderError] = useState<string | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<VaultEntry | null>(null);

  // ── Ingest: ONE funnel, two doors (drop and picker) ──────────────────────
  const { uploads, start, cancel, dismiss, retry } = useVaultUpload({ path });
  const { isDragging, dropProps } = useVaultDrop(start);

  const openPicker = useCallback(() => fileInputRef.current?.click(), []);

  // ── Navigation ───────────────────────────────────────────────────────────
  const navigateTo = useCallback(
    (segments: readonly string[]) => {
      const query = segments.map(encodeURIComponent).join("/");
      // `push`, not `replace`: Back then walks OUT of a folder — free
      // navigation the user already knows, which is why there is no "up"
      // button in the chrome.
      router.push(segments.length === 0 ? "/files" : `/files?path=${query}`);
    },
    [router],
  );

  const openFolder = useCallback(
    (name: string) => navigateTo([...path, name]),
    [navigateTo, path],
  );

  // ── Download ─────────────────────────────────────────────────────────────
  const downloadMutation = vaultApi.files.requestDownload.useMutation();

  const download = useCallback(
    (entry: VaultEntry) => {
      downloadMutation.mutate(
        { path, name: entry.name },
        {
          onSuccess: ({ url }) => {
            // Minted with attachment disposition for every content type
            // (Plan 01), so this SAVES the file rather than rendering it.
            // Nothing uploaded is ever interpreted on our origin.
            window.location.href = url;
          },
          onError: () => toast("Couldn't start that download."),
        },
      );
    },
    [downloadMutation, path],
  );

  // ── New folder — inline, optimistic ──────────────────────────────────────
  const createFolder = vaultApi.files.createFolder.useMutation({
    onSuccess: () => {
      setCreatingFolder(false);
      setFolderError(undefined);
      void utils.files.list.invalidate({ path });
    },
    onError: (error) => {
      // Surface it INLINE and keep the input open with the text intact.
      // Wiping the user's typing on an error is its own small betrayal.
      setFolderError(
        error.data?.code === "CONFLICT"
          ? "A folder with that name already exists."
          : "Couldn't create that folder.",
      );
    },
  });

  // ── Delete — the one confirm ─────────────────────────────────────────────
  const remove = vaultApi.files.remove.useMutation({
    onSuccess: (_data, variables) => {
      // A statement, not an offer: there is nothing to undo (no trash).
      toast(`Deleted ${variables.name}`);
      void utils.files.list.invalidate({ path });
    },
    onError: () => {
      toast("Couldn't delete that.");
      void utils.files.list.invalidate({ path });
    },
  });

  const entries = useMemo(
    () => listing.data?.pages.flatMap((page) => page.entries) ?? [],
    [listing.data],
  );
  const folderName = path.length === 0 ? "Files" : (path[path.length - 1] ?? "Files");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <VaultBreadcrumb path={path} onNavigate={navigateTo} />

        {/* Both are plain ink Buttons WITH WORDS ON THEM. No icon-only chrome
            (anti-generic tell #4: chrome that tests the user's memory instead
            of teaching). */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFolderError(undefined);
              setCreatingFolder(true);
            }}
            className="border-rule bg-leaf text-ink shadow-none hover:bg-shade pointer-coarse:touch-target"
          >
            New folder
          </Button>
          <Button
            type="button"
            onClick={openPicker}
            className="shadow-none pointer-coarse:touch-target"
          >
            Upload files
          </Button>
        </div>
      </div>

      {/* The picker. Its onChange shares the EXACT same `start(files)` path as
          the drop handler — one ingest funnel, two doors. No intermediate
          modal, no card: the budget for the picker is ONE click. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        data-slot="vault-file-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) start(files);
          // Reset, so re-picking the same file fires onChange again.
          event.target.value = "";
        }}
      />

      <VaultDropLayer
        isDragging={isDragging}
        folderName={folderName}
        dropProps={dropProps}
      >
        <section aria-label="Your files">
          {/* THE STATE BRANCH, IN A FIXED ORDER THAT IS ITSELF A BUG FIX.
              loading -> error -> empty -> listing. Branching on `isPending`
              FIRST is what stops a populated folder flashing "empty" on every
              navigation: react-query returns `data: undefined` while a new
              query key is in flight, and an empty-check running first would
              read that as "no files" for one frame, on every folder walk.

              THE ERROR BRANCH IS GATED ON "NO ROWS" (v2.1): with paging, a
              failed SECOND page also sets `listing.error` — replacing 500
              loaded rows with a full-pane error because page two hiccuped
              would punish the user for scrolling. Rows on screen stay on
              screen; the failure reports at the foot (VaultLoadMore). */}
          {listing.isPending ? (
            <VaultLoading />
          ) : listing.error && entries.length === 0 ? (
            <VaultError onRetry={() => void listing.refetch()} />
          ) : entries.length === 0 && !creatingFolder ? (
            <VaultEmpty atRoot={path.length === 0} onUpload={openPicker} />
          ) : (
            <>
              <VaultListing
                entries={entries}
                onOpenFolder={openFolder}
                onDownload={download}
                onDelete={setPendingDelete}
                leadingRow={
                  creatingFolder ? (
                    <NewFolderRow
                      error={folderError}
                      onCancel={() => {
                        setCreatingFolder(false);
                        setFolderError(undefined);
                      }}
                      onCommit={(name) => createFolder.mutate({ path, name })}
                    />
                  ) : null
                }
              />
              <VaultLoadMore
                hasMore={listing.hasNextPage ?? false}
                isLoadingMore={listing.isFetchingNextPage}
                failed={Boolean(listing.error)}
                onMore={() => void listing.fetchNextPage()}
                onRetry={() => void listing.refetch()}
              />
            </>
          )}

          <UploadTray
            uploads={uploads}
            onCancel={cancel}
            onDismiss={dismiss}
            onRetry={retry}
          />
        </section>
      </VaultDropLayer>

      <DeleteDialog
        entry={pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onConfirm={(entry) => {
          remove.mutate({ path, name: entry.name, isFolder: entry.isFolder });
          setPendingDelete(null);
        }}
      />
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
                  // link, and never truncated: this is where you are.
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
