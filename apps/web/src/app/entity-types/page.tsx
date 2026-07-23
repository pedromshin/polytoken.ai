"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@polytoken/ui/dialog";
import { Input } from "@polytoken/ui/input";
import { Label } from "@polytoken/ui/label";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import {
  EntityTypeDetail,
  type DetailEntityType,
} from "./_components/entity-type-detail";
import { useEntityTypeAdmin } from "./_components/use-entity-type-admin";

// ---------------------------------------------------------------------------
// Create-type dialog (inline — a single label/slug form)
// ---------------------------------------------------------------------------

const createTypeSchema = z.object({
  label: z.string().trim().min(1, "Name is required").max(200),
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(100)
    .regex(
      /^[a-z0-9_]+$/,
      "Slug may only contain lowercase letters, numbers and underscores",
    ),
});

function CreateTypeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: { slug: string; label: string }) => void;
}): React.ReactElement {
  const [label, setLabel] = useState("");
  const [slug, setSlug] = useState("");
  const [errors, setErrors] = useState<{ label?: string; slug?: string }>({});

  useEffect(() => {
    if (open) {
      setLabel("");
      setSlug("");
      setErrors({});
    }
  }, [open]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const parsed = createTypeSchema.safeParse({ label, slug });
    if (!parsed.success) {
      const next: { label?: string; slug?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "label" && next.label === undefined) next.label = issue.message;
        if (key === "slug" && next.slug === undefined) next.slug = issue.message;
      }
      setErrors(next);
      return;
    }
    onCreate(parsed.data);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New entity type</DialogTitle>
            <DialogDescription>
              Define a new kind of structured document the system can extract.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="new-type-label">Name</Label>
            <Input
              id="new-type-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Invoice"
              aria-invalid={errors.label !== undefined}
            />
            {errors.label !== undefined && (
              <p className="text-xs text-destructive">{errors.label}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-type-slug">Slug</Label>
            <Input
              id="new-type-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="invoice"
              aria-invalid={errors.slug !== undefined}
            />
            {errors.slug !== undefined && (
              <p className="text-xs text-destructive">{errors.slug}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Create type</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EntityTypesPage(): React.ReactElement {
  // Active-only by default: deactivated system types (e.g. the retired
  // maritime defaults) stay recoverable in the DB but out of the catalog view.
  const { data, isLoading, isError, error } =
    api.entityTypes.list.useQuery({ includeInactive: false });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Mobile-only (below md): whether the detail pane is the visible layer.
  // Desktop renders both panes and ignores this entirely. A tap on a list row
  // opens the detail full-screen; the back affordance returns to the list —
  // the same stacked master/detail grammar the inbox mobile tree uses.
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  const admin = useEntityTypeAdmin();

  useEffect(() => {
    if (isError && error) {
      console.error("[EntityTypesPage] tRPC error:", error);
    }
  }, [isError, error]);

  const types = useMemo<ReadonlyArray<DetailEntityType>>(
    () => (data ?? []) as ReadonlyArray<DetailEntityType>,
    [data],
  );

  // Default-select the first type once the list arrives.
  useEffect(() => {
    if (selectedId === null && types.length > 0) {
      setSelectedId(types[0]!.id);
    }
  }, [selectedId, types]);

  const selected = types.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="flex h-[calc(100svh-var(--app-tabbar-h))]">
      {/* Master list — full-width layer on a phone, fixed rail at md+. */}
      <aside
        className={`${mobileDetailOpen ? "hidden md:flex" : "flex"} w-full flex-col border-border/50 md:w-72 md:shrink-0 md:border-r`}
      >
        <div className="flex h-11 items-center justify-between border-b border-border/50 bg-background/95 px-3">
          <span className="text-sm font-semibold">Entity types</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCreateOpen(true)}
            aria-label="New entity type"
          >
            <Plus className="mr-1 size-4" aria-hidden />
            New type
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading && (
            <div className="space-y-2 p-1">
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
              <Skeleton className="h-10 w-full rounded" />
            </div>
          )}

          {!isLoading && isError && (
            <div className="p-4 text-sm text-muted-foreground">
              Entity types could not be loaded. Please try again.
            </div>
          )}

          {!isLoading && !isError && types.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No entity types yet. Create your first one.
            </div>
          )}

          {!isLoading &&
            !isError &&
            types.map((t) => {
              const active = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(t.id);
                    setMobileDetailOpen(true);
                  }}
                  aria-current={active ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                >
                  <span className="truncate">{t.label}</span>
                  {!t.isActive && (
                    <Badge variant="secondary" className="shrink-0">
                      Inactive
                    </Badge>
                  )}
                </button>
              );
            })}
        </div>
      </aside>

      {/* Detail — full-width layer on a phone (with a back affordance), the
          flexible pane at md+. min-w-0 keeps the fields table scrolling inside
          its own wrapper instead of panning the document. */}
      <section
        className={`${mobileDetailOpen ? "flex" : "hidden"} min-w-0 flex-1 flex-col overflow-hidden md:flex`}
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/50 px-2 md:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMobileDetailOpen(false)}
            aria-label="Back to entity types"
            className="gap-1 pointer-coarse:touch-target"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Entity types
          </Button>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {selected != null ? (
            <EntityTypeDetail type={selected} admin={admin} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select an entity type to view and edit its fields.
            </div>
          )}
        </div>
      </section>

      <CreateTypeDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={(input) => admin.createType(input)}
      />
    </div>
  );
}
