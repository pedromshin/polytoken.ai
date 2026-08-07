"use client";

import { LockKeyhole, LogOut, X } from "lucide-react";
import * as React from "react";

import { Button } from "@polytoken/ui/button";
import { Input } from "@polytoken/ui/input";
import { Skeleton } from "@polytoken/ui/skeleton";

import { api } from "~/trpc/react";

import {
  ALL_ROLES,
  canManageMembers,
  grantableRoles,
  ROLE_LABEL,
  type WorkspaceRole,
} from "../../_lib/roles";

/**
 * members-panel.tsx — the /workspaces/[id] roster + RBAC surface (Stream B).
 *
 * Reads `workspaces.members` (membership-gated server-side) and drives the
 * four owner/RBAC mutations: addMember / changeRole / removeMember / leave. It
 * NEVER touches sharing or any resource-list query.
 *
 * ## Honest RBAC surfacing (the server is still the sole authority)
 * The caller's own role for THIS workspace comes from the `workspaces.list`
 * row (the list returns a `role` per workspace). Every control is then shown
 * or disabled to MIRROR the server's rules, so the UI never dangles an action
 * the server will only reject:
 *   - Member mutations need admin+ → a viewer/member sees a READ-ONLY roster.
 *   - A caller may never grant a role OUTRANKING their own → the role pickers
 *     only offer `grantableRoles(callerRole)` (an admin cannot mint an owner).
 *   - The workspace OWNER's row is immutable → no demote/remove control on it;
 *     it is labelled as such.
 *   - The owner cannot leave → the "Leave" control is hidden for an owner.
 * The server re-checks all of this against `ctx.user.id`; when it still
 * rejects (e.g. a stale role), the error surfaces inline rather than silently.
 *
 * Chrome is monochrome (law 1): roles are sans labels, never coloured badges;
 * the remove/leave controls are neutral ghost buttons — removing a member is
 * reversible (re-add), so it does not earn destructive madder.
 */

interface MemberRow {
  id: string;
  userId: string;
  role: WorkspaceRole;
  createdAt: Date | string;
}

export function MembersPanel(props: {
  workspaceId: string;
}): React.ReactElement {
  const { workspaceId } = props;
  const utils = api.useUtils();

  const listQuery = api.workspaces.list.useQuery();
  const membersQuery = api.workspaces.members.useQuery({ workspaceId });

  const callerRole: WorkspaceRole | undefined = listQuery.data?.find(
    (w) => w.id === workspaceId,
  )?.role;

  const [actionError, setActionError] = React.useState<string | null>(null);

  async function refresh(): Promise<void> {
    await Promise.all([
      utils.workspaces.members.invalidate({ workspaceId }),
      utils.workspaces.list.invalidate(),
    ]);
  }

  const changeRole = api.workspaces.changeRole.useMutation({
    onError: (e) => setActionError(e.message),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
  });
  const removeMember = api.workspaces.removeMember.useMutation({
    onError: (e) => setActionError(e.message),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
  });
  const leave = api.workspaces.leave.useMutation({
    onError: (e) => setActionError(e.message),
    onSuccess: () => {
      setActionError(null);
      void refresh();
    },
  });

  if (membersQuery.isPending || listQuery.isPending) {
    return (
      <ul className="flex flex-col gap-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3"
          >
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-4 w-20" />
          </li>
        ))}
      </ul>
    );
  }

  if (membersQuery.isError) {
    return (
      <div className="rounded-md border border-rule bg-bright p-panel text-sm text-ink">
        <p className="font-medium">Couldn’t load the members.</p>
        <p className="mt-1 text-muted-foreground">
          {membersQuery.error.message}. You may not have access to this
          workspace.
        </p>
      </div>
    );
  }

  const members = (membersQuery.data ?? []) as MemberRow[];
  const canManage = callerRole !== undefined && canManageMembers(callerRole);
  const canLeave = callerRole !== undefined && callerRole !== "owner";

  return (
    <div className="flex flex-col gap-4">
      {canManage && callerRole !== undefined ? (
        <AddMemberForm
          workspaceId={workspaceId}
          callerRole={callerRole}
          onError={setActionError}
          onDone={refresh}
        />
      ) : (
        <p className="text-2xs text-muted-foreground">
          {callerRole === undefined
            ? "You are viewing this workspace."
            : `You are a ${ROLE_LABEL[callerRole].toLowerCase()} — only an admin or owner can change members.`}
        </p>
      )}

      {actionError ? (
        <p className="text-2xs text-ink" role="alert">
          {actionError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2" aria-label="Workspace members">
        {members.map((m) => {
          const isOwner = m.role === "owner";
          return (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-md border border-rule bg-bright px-4 py-3"
            >
              <span
                className="tabular min-w-0 flex-1 truncate text-sm text-ink"
                title={m.userId}
              >
                {m.userId}
              </span>

              {canManage && !isOwner && callerRole !== undefined ? (
                <RoleSelect
                  value={m.role}
                  options={grantableRoles(callerRole)}
                  disabled={changeRole.isPending}
                  ariaLabel={`Role for ${m.userId}`}
                  onChange={(role) =>
                    changeRole.mutate({ workspaceId, userId: m.userId, role })
                  }
                />
              ) : (
                <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
                  {isOwner ? (
                    <LockKeyhole
                      className="h-3 w-3"
                      aria-hidden
                      strokeWidth={1.5}
                    />
                  ) : null}
                  {ROLE_LABEL[m.role]}
                  {isOwner ? " · immutable" : ""}
                </span>
              )}

              {canManage && !isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-ink"
                  aria-label={`Remove ${m.userId}`}
                  disabled={removeMember.isPending}
                  onClick={() =>
                    removeMember.mutate({ workspaceId, userId: m.userId })
                  }
                >
                  <X className="h-4 w-4" aria-hidden strokeWidth={1.5} />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canLeave ? (
        <div>
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-ink"
            disabled={leave.isPending}
            onClick={() => leave.mutate({ workspaceId })}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden strokeWidth={1.5} />
            {leave.isPending ? "Leaving…" : "Leave workspace"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Mirrors USER_SEARCH_MIN_QUERY on `workspaces.searchUsers` (server-enforced). */
const SEARCH_MIN_CHARS = 3;

interface UserSearchRow {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * AddMemberForm — search-and-pick (vLAUNCH W65; replaces the raw-UUID field).
 *
 * Type >= 3 characters → `workspaces.searchUsers` surfaces up to 10 candidate
 * users (email + name; the server never returns more columns). Picking one
 * swaps the input for the selection (with a clear control) and arms Add —
 * one primary action, inline, no modal. Below the minimum the query never
 * fires and the hint says why (states speak ink; chrome stays monochrome).
 */
function AddMemberForm(props: {
  workspaceId: string;
  callerRole: WorkspaceRole;
  onError: (message: string) => void;
  onDone: () => Promise<void>;
}): React.ReactElement {
  const { workspaceId, callerRole } = props;
  const options = grantableRoles(callerRole);

  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<UserSearchRow | null>(null);
  const [role, setRole] = React.useState<WorkspaceRole>("member");

  const addMember = api.workspaces.addMember.useMutation({
    onError: (e) => props.onError(e.message),
    onSuccess: async () => {
      props.onError("");
      setQuery("");
      setPicked(null);
      setRole("member");
      await props.onDone();
    },
  });

  const trimmed = query.trim();
  const searchEnabled = picked === null && trimmed.length >= SEARCH_MIN_CHARS;
  const search = api.workspaces.searchUsers.useQuery(
    { query: trimmed },
    { enabled: searchEnabled },
  );
  const results: UserSearchRow[] = searchEnabled ? (search.data ?? []) : [];

  const canSubmit = picked !== null && !addMember.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit || picked === null) return;
    addMember.mutate({ workspaceId, userId: picked.id, role });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-md border border-rule bg-bright p-panel"
      aria-label="Add member"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label
            htmlFor="add-member-search"
            className="text-2xs font-medium text-muted-foreground"
          >
            Add member
          </label>
          {picked === null ? (
            <Input
              id="add-member-search"
              value={query}
              placeholder="Search by email or name"
              onChange={(e) => setQuery(e.target.value)}
              disabled={addMember.isPending}
              autoComplete="off"
            />
          ) : (
            <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-rule bg-bright px-3">
              <span
                className="min-w-0 flex-1 truncate text-sm text-ink"
                title={picked.email ?? picked.id}
              >
                {picked.email ?? picked.name ?? picked.id}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-ink"
                aria-label="Clear selected user"
                disabled={addMember.isPending}
                onClick={() => {
                  setPicked(null);
                  setQuery("");
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </div>

        <RoleSelect
          value={role}
          options={options}
          disabled={addMember.isPending}
          ariaLabel="Role for new member"
          onChange={setRole}
        />

        <Button type="submit" disabled={!canSubmit}>
          {addMember.isPending ? "Adding…" : "Add"}
        </Button>
      </div>

      {picked === null && trimmed.length > 0 && trimmed.length < SEARCH_MIN_CHARS ? (
        <p className="text-2xs text-muted-foreground">
          Type at least {SEARCH_MIN_CHARS} characters to search.
        </p>
      ) : null}

      {searchEnabled ? (
        search.isPending ? (
          <p className="text-2xs text-muted-foreground" aria-live="polite">
            Searching…
          </p>
        ) : search.isError ? (
          <p className="text-2xs text-ink" role="alert">
            Search failed. {search.error.message}
          </p>
        ) : results.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            No users match “{trimmed}”.
          </p>
        ) : (
          <ul
            className="flex flex-col overflow-hidden rounded-md border border-rule"
            aria-label="User search results"
          >
            {results.map((u) => (
              <li key={u.id} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-baseline gap-2 px-3 py-2 text-left hover:bg-shade"
                  onClick={() => setPicked(u)}
                >
                  <span className="min-w-0 truncate text-sm text-ink">
                    {u.email ?? u.id}
                  </span>
                  {u.name ? (
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {u.name}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </form>
  );
}

/**
 * RoleSelect — a native <select> for a role. Native (not the Radix Select
 * primitive) because a role picker is a plain form control that must remain
 * fully keyboard- and test-drivable; it is styled with identity tokens so it
 * reads as chrome (monochrome, law 1).
 */
function RoleSelect(props: {
  value: WorkspaceRole;
  options: readonly WorkspaceRole[];
  disabled?: boolean;
  ariaLabel: string;
  onChange: (role: WorkspaceRole) => void;
}): React.ReactElement {
  return (
    <select
      aria-label={props.ariaLabel}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value as WorkspaceRole)}
      className="h-9 shrink-0 rounded-md border border-rule bg-bright px-2 text-sm text-ink"
    >
      {/* The current value is always shown even if it is not grantable by the
          caller (a select must contain its own value) — but only grantable
          options are selectable targets. */}
      {ALL_ROLES.filter(
        (r) => r === props.value || props.options.includes(r),
      ).map((r) => (
        <option key={r} value={r} disabled={!props.options.includes(r)}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}
