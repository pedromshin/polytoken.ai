"use client";

/**
 * composer-attachments.tsx — the CH-01 attach affordance for the chat composer
 * (FEATURE-CATALOG CH-01 / DR-03 / DR-05). META-AUDIT: "composer has no attach
 * affordance." This adds one, in two flavours, both landing on the SAME durable
 * store:
 *
 *   - ATTACH BY UPLOAD — a hidden file input mints a signed upload URL through
 *     the vault's `files.requestUpload` (server-side keyed on ctx.user.id — the
 *     client never chooses where the blob lands, files/index.ts's whole tenancy
 *     argument), PUTs the bytes straight to storage, then records the file as
 *     chat context.
 *   - ATTACH FROM VAULT — lists the vault root (`files.list`) and lets the user
 *     pick an existing file to attach. (Folder navigation is intentionally out
 *     of scope here — the vault browser lives in /files, owned by b5-drive-ops;
 *     this is the composer's minimal reach into it.)
 *
 * Both flavours attach the file as a `vault_file` chat-context edge
 * (chat_context_edges, RCNV-04) via the shared AI-04 `useSendTo` seam — so the
 * NEXT turn injects the file as real context (DR-05's "AI reads the
 * attachment", once the listener resolver lands). The attached files render as
 * removable chips, read straight off `listContextEdges` so the rail is the
 * durable truth, never a second local list that could drift.
 *
 * TENANCY: every write is user-scoped server-side — `requestUpload` and
 * `createContextEdge`/`removeContextEdge` all resolve the acting user from the
 * session, never from an input field. This component passes only a
 * conversationId the caller already owns (the open conversation) and
 * tenant-relative vault segments.
 *
 * DESIGN: monochrome, hairline, ink focus (58-IDENTITY law 1 — chrome carries
 * no hue). A file name is chrome, so chips are SANS, never serif/data-evidence.
 */

import * as React from "react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { File as FileIcon, Paperclip, Upload, X } from "lucide-react";

import { cn } from "@polytoken/ui";
import { Button } from "@polytoken/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@polytoken/ui/dropdown-menu";

import { api } from "~/trpc/react";

import { useSendTo, type SendableObject } from "../../_components/use-send-to";

/** A `vault_file` sourceRef as it appears on a context-edge row (jsonb, so
 * `unknown` at the wire — narrowed defensively). */
interface VaultFileRef {
  readonly type: "vault_file";
  readonly path: readonly string[];
  readonly name: string;
}

/** Narrows an untrusted context-edge `sourceRef` to a vault_file ref, or null. */
export function asVaultFileRef(sourceRef: unknown): VaultFileRef | null {
  if (typeof sourceRef !== "object" || sourceRef === null) return null;
  const ref = sourceRef as Record<string, unknown>;
  if (ref.type !== "vault_file") return null;
  if (typeof ref.name !== "string" || ref.name.length === 0) return null;
  const path =
    Array.isArray(ref.path) && ref.path.every((s) => typeof s === "string")
      ? (ref.path as string[])
      : [];
  return { type: "vault_file", path, name: ref.name };
}

export interface ComposerAttachmentsProps {
  /** The open conversation the attachment becomes context for. Caller-owned. */
  readonly conversationId: string;
  /** Disabled while the active turn streams (mirrors the composer field). */
  readonly disabled?: boolean;
}

/**
 * ComposerAttachments — the attach button + attached-files chip rail. Rendered
 * by the Composer only when it has a conversationId to attach to.
 */
export function ComposerAttachments({
  conversationId,
  disabled = false,
}: ComposerAttachmentsProps): React.ReactElement {
  const utils = api.useUtils();
  const { sendToChat, isSending } = useSendTo();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);

  const edgesQuery = api.chat.listContextEdges.useQuery({ conversationId });
  const requestUpload = api.files.requestUpload.useMutation();
  const removeEdge = api.chat.removeContextEdge.useMutation({
    onSettled: () => {
      void utils.chat.listContextEdges.invalidate({ conversationId });
    },
  });

  // Root-folder listing, fetched only when the vault menu is opened.
  const vaultListQuery = api.files.list.useQuery(
    { path: [], cursor: null },
    { enabled: vaultOpen },
  );

  const attachedFiles = (edgesQuery.data ?? [])
    .map((edge) => ({ edgeId: edge.id, ref: asVaultFileRef(edge.sourceRef) }))
    .filter((x): x is { edgeId: string; ref: VaultFileRef } => x.ref !== null);

  const attachVaultFile = useCallback(
    (path: readonly string[], name: string): void => {
      const object: SendableObject = {
        kind: "vault_file",
        path: [...path],
        name,
        label: name,
      };
      // The shared AI-04 seam creates the vault_file context edge (optimistic,
      // toasted, invalidates listContextEdges on settle — so the chip appears).
      sendToChat(object, conversationId);
    },
    [conversationId, sendToChat],
  );

  const onUploadChosen = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.target.files?.[0];
      // Reset the input so choosing the same file twice still fires onChange.
      event.target.value = "";
      if (!file) return;

      setIsUploading(true);
      try {
        // Server mints the key from ctx.user.id + these segments — the client
        // never names a key/bucket/prefix (files/index.ts's input rule).
        const { url } = await requestUpload.mutateAsync({
          path: [],
          name: file.name,
          size: file.size,
          ...(file.type ? { contentType: file.type } : {}),
        });

        const res = await fetch(url, {
          method: "PUT",
          body: file,
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-upsert": "true",
          },
        });
        if (!res.ok) {
          throw new Error(`upload failed (${res.status})`);
        }

        attachVaultFile([], file.name);
      } catch {
        toast.error("Couldn't upload that file — nothing was attached.", {
          duration: 6000,
        });
      } finally {
        setIsUploading(false);
      }
    },
    [attachVaultFile, requestUpload],
  );

  const busy = disabled || isUploading || isSending;

  return (
    <div className="flex flex-col gap-2">
      {attachedFiles.length > 0 ? (
        <ul
          aria-label="Attached files"
          className="flex flex-wrap gap-1.5"
        >
          {attachedFiles.map(({ edgeId, ref }) => (
            <li
              key={edgeId}
              className="flex items-center gap-1.5 rounded-sm border border-hair bg-leaf px-2 py-1 text-2xs text-ink"
            >
              <FileIcon className="size-3 shrink-0 text-faded" aria-hidden />
              <span className="max-w-[12rem] truncate">{ref.name}</span>
              <button
                type="button"
                aria-label={`Remove attachment ${ref.name}`}
                disabled={disabled}
                className="flex size-4 shrink-0 items-center justify-center rounded-sm text-pencil transition-colors hover:bg-ink-08 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 disabled:opacity-50"
                onClick={() => removeEdge.mutate({ edgeId })}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => void onUploadChosen(event)}
      />

      <DropdownMenu open={vaultOpen} onOpenChange={setVaultOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label="Attach a file"
            className={cn(
              "size-9 shrink-0 self-start text-pencil shadow-none hover:bg-ink-08 hover:text-ink",
              "focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1",
            )}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Attach a file</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="size-4" aria-hidden />
            Upload from device
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-2xs font-normal text-faded">
            From your vault
          </DropdownMenuLabel>
          {vaultListQuery.isPending ? (
            <DropdownMenuItem disabled>Loading vault…</DropdownMenuItem>
          ) : vaultListQuery.isError ? (
            <DropdownMenuItem disabled>Couldn&apos;t reach your vault</DropdownMenuItem>
          ) : (
            (() => {
              const files = (vaultListQuery.data?.entries ?? []).filter(
                (entry) => !entry.isFolder,
              );
              if (files.length === 0) {
                return <DropdownMenuItem disabled>No files at the vault root</DropdownMenuItem>;
              }
              return files.slice(0, 20).map((entry) => (
                <DropdownMenuItem
                  key={entry.name}
                  disabled={busy}
                  onSelect={() => attachVaultFile([], entry.name)}
                >
                  <FileIcon className="size-4 shrink-0 text-faded" aria-hidden />
                  <span className="truncate">{entry.name}</span>
                </DropdownMenuItem>
              ));
            })()
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
