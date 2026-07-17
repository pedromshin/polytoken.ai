"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { VAULT_MAX_UPLOAD_BYTES } from "../../../../../../packages/api-client/src/router/files/storage-adapter";
import { VaultNameSchema } from "../../../../../../packages/api-client/src/router/files/vault-keys";
import { vaultApi } from "./vault-api";
import { formatBytes } from "./vault-format";

/**
 * use-vault-upload.ts — the upload queue (Phase 66 Plan 04, FVLT-02).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE TRANSPORT, VERIFIED AGAINST THE INSTALLED PACKAGE — NOT FROM MEMORY
 * ────────────────────────────────────────────────────────────────────────────
 * `@supabase/storage-js`'s own `uploadToSignedUrl` (StorageFileApi.ts:275)
 * does exactly this:
 *
 *   PUT  {signedUrl}                       ← token is ALREADY in its query string
 *   body  FormData: cacheControl="3600", "" -> the File   (the Blob branch)
 *   hdr   x-upsert: "false"
 *
 * We issue that same request over XHR instead of `fetch` for ONE reason:
 * `xhr.upload.onprogress` and `xhr.abort()`. FVLT-02 requires per-file progress
 * and cancel, and `uploadToSignedUrl` exposes neither — it awaits a fetch and
 * hands back a result. The fallback the plan allowed (call the SDK, render an
 * indeterminate state) was not needed: path (a) works and gives real bytes.
 *
 * No Authorization header: the signed URL carries its own token. That is what
 * makes a direct browser->storage PUT possible without shipping a credential.
 *
 * THE BROWSER NEVER CHOOSES A KEY. It sends `{ path, name, size }` and receives
 * a URL. If you find yourself passing a key from here, stop — that is T-66-02,
 * and Plan 02 exists to prevent it.
 */

export type VaultUploadStatus = "pending" | "uploading" | "done" | "error";

export type VaultUpload = {
  readonly id: string;
  readonly name: string;
  readonly progress: number;
  readonly status: VaultUploadStatus;
  readonly error?: string;
};

/** A 50-file drop must not open 50 sockets. */
const MAX_CONCURRENT = 3;

/** Done rows clear themselves; error rows never do (see below). */
const DONE_ROW_TTL_MS = 4000;

/** supabase-js's own default — mirrored so our PUT is byte-identical to its. */
const CACHE_CONTROL = "3600";

let uploadSeq = 0;
const nextId = () => `upload-${++uploadSeq}`;

export function useVaultUpload({ path }: { path: readonly string[] }) {
  const [uploads, setUploads] = useState<readonly VaultUpload[]>([]);
  const xhrs = useRef(new Map<string, XMLHttpRequest>());

  const requestUpload = vaultApi.files.requestUpload.useMutation();
  const utils = vaultApi.useUtils();

  const patch = useCallback((id: string, next: Partial<VaultUpload>) => {
    setUploads((current) =>
      current.map((upload) => (upload.id === id ? { ...upload, ...next } : upload)),
    );
  }, []);

  const dismiss = useCallback((id: string) => {
    setUploads((current) => current.filter((upload) => upload.id !== id));
    xhrs.current.delete(id);
  }, []);

  const cancel = useCallback(
    (id: string) => {
      xhrs.current.get(id)?.abort();
      dismiss(id);
    },
    [dismiss],
  );

  /** One file, start to finish. Resolves either way — never rejects. */
  const uploadOne = useCallback(
    async (id: string, file: File, targetPath: readonly string[]) => {
      patch(id, { status: "uploading", progress: 0 });

      try {
        const { url } = await requestUpload.mutateAsync({
          path: [...targetPath],
          name: file.name,
          size: file.size,
          contentType: file.type || undefined,
        });

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrs.current.set(id, xhr);

          xhr.open("PUT", url);
          xhr.setRequestHeader("x-upsert", "false");

          xhr.upload.onprogress = (event) => {
            // `lengthComputable` guards the case where the browser cannot know
            // the total: reporting a percentage there would be inventing one.
            if (!event.lengthComputable) return;
            patch(id, { progress: Math.round((event.loaded / event.total) * 100) });
          };

          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`Upload failed (${xhr.status})`));
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.onabort = () => reject(new Error("Cancelled"));

          const body = new FormData();
          body.append("cacheControl", CACHE_CONTROL);
          body.append("", file);
          xhr.send(body);
        });

        patch(id, { status: "done", progress: 100 });
        window.setTimeout(() => dismiss(id), DONE_ROW_TTL_MS);
      } catch (err) {
        if (err instanceof Error && err.message === "Cancelled") return;
        patch(id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      } finally {
        xhrs.current.delete(id);
      }
    },
    [patch, dismiss, requestUpload],
  );

  const start = useCallback(
    (files: readonly File[]) => {
      // CAPTURE THE PATH NOW. A user who navigates mid-upload must not have
      // their file land in whatever folder they ended up in.
      const targetPath = [...path];

      const accepted: { id: string; file: File }[] = [];
      const queued: VaultUpload[] = [];

      for (const file of files) {
        // A dropped DIRECTORY arrives as an entry with no real body (size 0,
        // no type). Without this branch, dropping a folder does nothing at all
        // and the vault simply looks broken.
        const looksLikeDirectory = file.size === 0 && file.type === "";
        if (looksLikeDirectory) {
          toast("Folders can't be uploaded yet — drop files instead.");
          continue;
        }

        const id = nextId();

        // Client pre-checks. A COURTESY, NOT THE CONTROL: the server enforces
        // both regardless (`requestUpload`'s zod schema), and the bucket's own
        // fileSizeLimit is the layer the client cannot lie past at all. The
        // point of doing it here is that the user is told BEFORE a 100MB
        // transfer rather than after one.
        if (file.size > VAULT_MAX_UPLOAD_BYTES) {
          queued.push({
            id,
            name: file.name,
            progress: 0,
            status: "error",
            error: `That file is over the ${formatBytes(VAULT_MAX_UPLOAD_BYTES)} limit.`,
          });
          continue;
        }

        // The SAME schema the server runs, so the client cannot teach the user
        // a name the server will reject.
        const named = VaultNameSchema.safeParse(file.name);
        if (!named.success) {
          queued.push({
            id,
            name: file.name,
            progress: 0,
            status: "error",
            error: named.error.issues[0]?.message ?? "That name isn't allowed.",
          });
          continue;
        }

        queued.push({ id, name: file.name, progress: 0, status: "pending" });
        accepted.push({ id, file });
      }

      if (queued.length === 0) return;
      setUploads((current) => [...current, ...queued]);

      // Bounded concurrency, then ONE invalidate for the whole batch:
      // invalidating per file re-renders the list N times and makes a 50-file
      // drop feel like a stutter.
      void (async () => {
        for (let i = 0; i < accepted.length; i += MAX_CONCURRENT) {
          await Promise.all(
            accepted
              .slice(i, i + MAX_CONCURRENT)
              .map(({ id, file }) => uploadOne(id, file, targetPath)),
          );
        }
        await utils.files.list.invalidate({ path: [...targetPath] });
      })();
    },
    [path, uploadOne, utils],
  );

  const retry = useCallback(
    (id: string, file: File) => void uploadOne(id, file, path),
    [uploadOne, path],
  );

  return { uploads, start, cancel, dismiss, retry };
}
