/**
 * members-panel.test.tsx — behaviour + RBAC surfacing of the
 * /workspaces/[id] roster (Stream B). jsdom-only: BEHAVIOUR, not layout.
 *
 * Covered (mirrors the server rules in router/workspaces/index.ts):
 *   1. ROSTER RENDERS — a row per member from `workspaces.members`.
 *   2. OWNER ROW IS IMMUTABLE — no role <select>, no remove control on it.
 *   3. AN ADMIN CANNOT MINT AN OWNER — the add-member role picker offers no
 *      `owner` option (grantableRoles caps at the caller's own rank).
 *   4. CALLS changeRole / removeMember — a non-owner row's controls invoke the
 *      right mutation with { workspaceId, userId, role? }.
 *   5. A NON-ADMIN SEES READ-ONLY — no add form, no per-row controls.
 *
 * `~/trpc/react` is mocked; the caller's own role is fed via the
 * `workspaces.list` row for the workspace under test.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const WS_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

type Role = "owner" | "admin" | "member" | "viewer";

interface WsRow {
  id: string;
  name: string;
  role: Role;
  createdAt: string;
}
interface MemberRow {
  id: string;
  userId: string;
  role: Role;
  createdAt: string;
}

let listData: WsRow[] = [];
let membersData: MemberRow[] = [];

const addMemberMutate = vi.fn();
const changeRoleMutate = vi.fn();
const removeMemberMutate = vi.fn();
const leaveMutate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      workspaces: {
        members: { invalidate },
        list: { invalidate },
      },
    }),
    workspaces: {
      list: {
        useQuery: () => ({ data: listData, isPending: false, isError: false, error: null }),
      },
      members: {
        useQuery: () => ({ data: membersData, isPending: false, isError: false, error: null }),
      },
      addMember: {
        useMutation: () => ({ mutate: addMemberMutate, isPending: false }),
      },
      changeRole: {
        useMutation: () => ({ mutate: changeRoleMutate, isPending: false }),
      },
      removeMember: {
        useMutation: () => ({ mutate: removeMemberMutate, isPending: false }),
      },
      leave: {
        useMutation: () => ({ mutate: leaveMutate, isPending: false }),
      },
    },
  },
}));

import { MembersPanel } from "../members-panel";

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<MembersPanel workspaceId={WS_ID} />);
  });
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value",
  )!.set!;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const OWNER_ID = "00000000-0000-0000-0000-00000000000a";
const MEMBER_ID = "00000000-0000-0000-0000-00000000000b";

function seedRoster(): void {
  membersData = [
    { id: "m1", userId: OWNER_ID, role: "owner", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "m2", userId: MEMBER_ID, role: "member", createdAt: "2026-07-02T00:00:00.000Z" },
  ];
}

/** Set the caller's own role for WS_ID via the list row. */
function callerIs(role: Role): void {
  listData = [{ id: WS_ID, name: "Acme", role, createdAt: "2026-07-01T00:00:00.000Z" }];
}

beforeEach(() => {
  listData = [];
  membersData = [];
  addMemberMutate.mockClear();
  changeRoleMutate.mockClear();
  removeMemberMutate.mockClear();
  leaveMutate.mockClear();
  invalidate.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MembersPanel — RBAC surfacing", () => {
  it("renders a roster row per member", async () => {
    callerIs("admin");
    seedRoster();
    await mount();
    const rows = container.querySelectorAll('ul[aria-label="Workspace members"] > li');
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain(OWNER_ID);
    expect(container.textContent).toContain(MEMBER_ID);
  });

  it("shows the owner row as immutable — no select, no remove control", async () => {
    callerIs("admin");
    seedRoster();
    await mount();

    const rows = Array.from(
      container.querySelectorAll<HTMLLIElement>(
        'ul[aria-label="Workspace members"] > li',
      ),
    );
    const ownerRow = rows.find((r) => r.textContent?.includes(OWNER_ID))!;
    expect(ownerRow.querySelector("select")).toBeNull();
    expect(
      ownerRow.querySelector(`button[aria-label="Remove ${OWNER_ID}"]`),
    ).toBeNull();
    expect(ownerRow.textContent).toContain("immutable");
  });

  it("an admin cannot mint an owner — the add-member picker has no owner option", async () => {
    callerIs("admin");
    seedRoster();
    await mount();

    const addSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Role for new member"]',
    )!;
    expect(addSelect).not.toBeNull();
    const values = Array.from(addSelect.options).map((o) => o.value);
    expect(values).toEqual(["viewer", "member", "admin"]);
    expect(values).not.toContain("owner");
  });

  it("changing a non-owner row's role calls changeRole with the new role", async () => {
    callerIs("admin");
    seedRoster();
    await mount();

    const select = container.querySelector<HTMLSelectElement>(
      `select[aria-label="Role for ${MEMBER_ID}"]`,
    )!;
    expect(select).not.toBeNull();
    await act(async () => {
      setSelectValue(select, "admin");
    });

    expect(changeRoleMutate).toHaveBeenCalledTimes(1);
    expect(changeRoleMutate).toHaveBeenCalledWith({
      workspaceId: WS_ID,
      userId: MEMBER_ID,
      role: "admin",
    });
  });

  it("clicking a non-owner row's remove control calls removeMember", async () => {
    callerIs("admin");
    seedRoster();
    await mount();

    const btn = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Remove ${MEMBER_ID}"]`,
    )!;
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.click();
    });

    expect(removeMemberMutate).toHaveBeenCalledTimes(1);
    expect(removeMemberMutate).toHaveBeenCalledWith({
      workspaceId: WS_ID,
      userId: MEMBER_ID,
    });
  });

  it("a non-admin (member) sees a read-only roster — no add form, no per-row controls", async () => {
    callerIs("member");
    seedRoster();
    await mount();

    // No add-member form.
    expect(
      container.querySelector('form[aria-label="Add member by user ID"]'),
    ).toBeNull();
    // No role selects at all (owner + member rows both static).
    expect(container.querySelectorAll("select")).toHaveLength(0);
    // No remove controls.
    expect(
      container.querySelector(`button[aria-label="Remove ${MEMBER_ID}"]`),
    ).toBeNull();
  });

  it("a non-owner caller sees a Leave control; an owner does not", async () => {
    callerIs("member");
    seedRoster();
    await mount();
    const leaveBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Leave workspace"),
    );
    expect(leaveBtn).toBeDefined();
    await act(async () => {
      leaveBtn!.click();
    });
    expect(leaveMutate).toHaveBeenCalledWith({ workspaceId: WS_ID });

    // Re-mount as owner: no Leave control.
    act(() => root.unmount());
    container.remove();
    callerIs("owner");
    seedRoster();
    await mount();
    const ownerLeave = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Leave workspace"),
    );
    expect(ownerLeave).toBeUndefined();
  });
});
