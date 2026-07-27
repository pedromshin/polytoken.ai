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
  isUuid,
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

/**
 * AddMemberForm — add a member by RAW user UUID (there is no user-search
 * endpoint yet; "user search" is a followup). The id is validated for UUID
 * shape client-side before the mutation is allowed. Role options are capped at
 * the caller's own rank.
 */
function AddMemberForm(props: {
  workspaceId: string;
  callerRole: WorkspaceRole;
  onError: (message: string) => void;
  onDone: () => Promise<void>;
}): React.ReactElement {
  const { workspaceId, callerRole } = props;
  const options = grantableRoles(callerRole);

  const [userId, setUserId] = React.useState("");
  const [role, setRole] = React.useState<WorkspaceRole>("member");

  const addMember = api.workspaces.addMember.useMutation({
    onError: (e) => props.onError(e.message),
    onSuccess: async () => {
      props.onError("");
      setUserId("");
      setRole("member");
      await props.onDone();
    },
  });

  const trimmed = userId.trim();
  const validId = isUuid(trimmed);
  const canSubmit = validId && !addMember.isPending;

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canSubmit) return;
    addMember.mutate({ workspaceId, userId: trimmed, role });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-2 rounded-md border border-rule bg-bright p-panel sm:flex-row sm:items-end"
      aria-label="Add member by user ID"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label
          htmlFor="add-member-id"
          className="text-2xs font-medium text-muted-foreground"
        >
          Add member by user ID
        </label>
        <Input
          id="add-member-id"
          value={userId}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(e) => setUserId(e.target.value)}
          disabled={addMember.isPending}
          aria-invalid={trimmed.length > 0 && !validId ? true : undefined}
          className="tabular"
        />
        {trimmed.length > 0 && !validId ? (
          <p className="text-2xs text-muted-foreground">
            Enter a valid user UUID. (User search is coming later.)
          </p>
        ) : null}
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
