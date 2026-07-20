"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Label } from "@polytoken/ui/label";

import { api } from "~/trpc/react";

/**
 * save-reference-form.tsx — the /references save form (999.35).
 *
 * The PRIMARY action of the surface (taste checklist item 1): saving a
 * reference is one paste + one Enter from arrival — the form sits at the top,
 * URL field first, and submitting from any field works (it's a real <form>).
 * Title is required alongside URL; note and tags are progressive extras on
 * the same card, not a second surface (item 9's spirit at form scale).
 *
 * Identity: chrome is monochrome (law 1) — the submit button is the standard
 * ink-weight Button, no hue. Tags are entered comma-separated and rendered as
 * ink/rule chips by the list; no new hue anywhere.
 *
 * The owner is NEVER sent from this client — `references.save` stamps
 * ctx.user.id server-side (TENA-03).
 */

/** Parse the comma-separated tags field: trimmed, non-empty, deduped. */
export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  ];
}

export function SaveReferenceForm(): React.ReactElement {
  const utils = api.useUtils();

  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [tags, setTags] = React.useState("");

  const save = api.references.save.useMutation({
    onSuccess: () => {
      setUrl("");
      setTitle("");
      setNote("");
      setTags("");
      void utils.references.list.invalidate();
    },
    onError: (error) => {
      toast.error("Couldn't save that reference.", {
        description: error.message,
      });
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmedUrl = url.trim();
    const trimmedTitle = title.trim();
    if (trimmedUrl.length === 0 || trimmedTitle.length === 0) return;

    save.mutate({
      url: trimmedUrl,
      title: trimmedTitle,
      note: note.trim().length > 0 ? note.trim() : undefined,
      tags: parseTags(tags),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-rule bg-bright p-panel"
      aria-label="Save a reference"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="reference-url" className="text-2xs text-faded">
            URL
          </Label>
          <Input
            id="reference-url"
            type="url"
            required
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reference-title" className="text-2xs text-faded">
            Title
          </Label>
          <Input
            id="reference-title"
            required
            placeholder="What is this?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reference-tags" className="text-2xs text-faded">
            Tags{" "}
            <span className="font-normal text-pencil">(comma-separated)</span>
          </Label>
          <Input
            id="reference-tags"
            placeholder="design, provenance"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="reference-note" className="text-2xs text-faded">
            Note <span className="font-normal text-pencil">(optional)</span>
          </Label>
          <Input
            id="reference-note"
            placeholder="Why it matters"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save reference"}
        </Button>
      </div>
    </form>
  );
}
