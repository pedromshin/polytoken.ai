/**
 * desktops-pane.test.tsx — the ST-03 desktop-management pane (E5 / RFC §5 / §6):
 * the pure tenancy + confirm-gate logic, the list render + OWNED-SCOPING (a
 * cross-user row never shows), and the DESTROY CONFIRM-GATE (irreversible ⇒ the
 * mutation fires only after the confirm, never on the first click).
 *
 * jsdom BEHAVIOUR only (CLAUDE.md: jsdom does no layout). `~/trpc/react` is
 * mocked as plain vi.fn()s (mirrors send-to.test.tsx). The cost ticker mounts
 * for real — it is a thin wrapper whose money math is proven in
 * lib/desktop-cost.test.ts.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canHibernate,
  selectOwnedDesktops,
  verbRequiresConfirm,
  type DesktopSessionView,
} from "../_lib";

// --- trpc mock --------------------------------------------------------------

let listData: DesktopSessionView[] = [];
const destroyMutate = vi.fn();
const hibernateMutate = vi.fn();
const invalidate = vi.fn(async () => undefined);

vi.mock("~/trpc/react", () => ({
  api: {
    useUtils: () => ({ desktop: { list: { invalidate } } }),
    desktop: {
      list: { useQuery: () => ({ data: listData, isLoading: false }) },
      hibernate: {
        useMutation: () => ({
          mutate: hibernateMutate,
          isPending: false,
          variables: undefined,
        }),
      },
      destroy: {
        useMutation: () => ({
          mutate: destroyMutate,
          isPending: false,
          variables: undefined,
        }),
      },
    },
  },
}));

import { DesktopsPane } from "../_components/desktops-pane";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER = "user-me";
const OTHER = "user-them";

function session(over: Partial<DesktopSessionView>): DesktopSessionView {
  return {
    id: "sess-1",
    userId: USER,
    label: "Dev box",
    status: "running",
    provider: "hetzner",
    region: "eu-central",
    shape: "CPX41",
    hourlyRateCents: 5,
    maxLifetimeMinutes: 480,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    providerInstanceId: "i-abc",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

describe("selectOwnedDesktops — tenancy floor (INV-8)", () => {
  it("keeps only the current user's rows", () => {
    const rows = [
      session({ id: "mine", userId: USER }),
      session({ id: "theirs", userId: OTHER }),
    ];
    const owned = selectOwnedDesktops(rows, USER);
    expect(owned).toHaveLength(1);
    expect(owned[0]!.id).toBe("mine");
  });

  it("fails closed with no user id or no rows (never 'show everything')", () => {
    expect(selectOwnedDesktops([session({})], undefined)).toEqual([]);
    expect(selectOwnedDesktops(undefined, USER)).toEqual([]);
  });
});

describe("verbRequiresConfirm — confirm is DATA (INV-4)", () => {
  it("destroy is irreversible ⇒ confirm required; hibernate is reversible ⇒ not", () => {
    expect(verbRequiresConfirm("destroy")).toBe(true);
    expect(verbRequiresConfirm("hibernate")).toBe(false);
  });
});

describe("canHibernate", () => {
  it("running/provisioning can hibernate; hibernated/destroyed cannot", () => {
    expect(canHibernate("running")).toBe(true);
    expect(canHibernate("provisioning")).toBe(true);
    expect(canHibernate("hibernated")).toBe(false);
    expect(canHibernate("destroyed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function mount(el: React.ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(el);
  });
}

beforeEach(() => {
  listData = [];
  container = undefined;
  root = undefined;
  destroyMutate.mockReset();
  hibernateMutate.mockReset();
  invalidate.mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  // Radix AlertDialog portals to body — clear any leftover portal nodes.
  document.body.innerHTML = "";
});

describe("DesktopsPane — list render + owned-scoping", () => {
  it("renders the owner's desktop and NOT a cross-user session", async () => {
    listData = [
      session({ id: "mine", label: "My box", userId: USER }),
      session({ id: "theirs", label: "Their box", userId: OTHER }),
    ];
    await mount(<DesktopsPane currentUserId={USER} />);
    expect(container!.textContent).toContain("My box");
    expect(container!.textContent).not.toContain("Their box");
  });

  it("shows the live cost rate for a running desktop", async () => {
    listData = [session({ id: "mine", hourlyRateCents: 5, userId: USER })];
    await mount(<DesktopsPane currentUserId={USER} />);
    // The ticker renders the per-hour rate as reference chrome beside the total.
    expect(container!.textContent).toContain("$0.05/hr");
  });

  it("teaches an empty state when the user has no desktops", async () => {
    listData = [session({ userId: OTHER })]; // exists, but not ours
    await mount(<DesktopsPane currentUserId={USER} />);
    expect(container!.textContent).toContain("No cloud desktops yet");
  });
});

describe("DesktopsPane — destroy confirm-gate (irreversible)", () => {
  it("Destroy does NOT fire the mutation on first click — it opens a confirm", async () => {
    listData = [session({ id: "mine", label: "My box", userId: USER })];
    await mount(<DesktopsPane currentUserId={USER} />);

    const destroyBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === "Destroy",
    );
    expect(destroyBtn, "Destroy button did not render").toBeDefined();

    await act(async () => {
      destroyBtn!.click();
    });

    // Not yet — the irreversible verb must be confirmed first.
    expect(destroyMutate).not.toHaveBeenCalled();

    // The confirm dialog (portaled to body) is now open with data-loss language.
    expect(document.body.textContent).toContain("cannot be undone");

    const confirmBtn = Array.from(
      document.body.querySelectorAll("button"),
    ).find((b) => b.textContent === "Destroy permanently");
    expect(confirmBtn, "confirm action did not render").toBeDefined();

    await act(async () => {
      confirmBtn!.click();
    });

    // Only NOW does the destroy mutation fire, with the owned session id.
    expect(destroyMutate).toHaveBeenCalledWith({ id: "mine" });
  });

  it("Hibernate (reversible) fires directly, no confirm", async () => {
    listData = [session({ id: "mine", status: "running", userId: USER })];
    await mount(<DesktopsPane currentUserId={USER} />);

    const hibernateBtn = Array.from(container!.querySelectorAll("button")).find(
      (b) => b.textContent === "Hibernate",
    );
    expect(hibernateBtn, "Hibernate button did not render").toBeDefined();

    await act(async () => {
      hibernateBtn!.click();
    });

    expect(hibernateMutate).toHaveBeenCalledWith({ id: "mine" });
  });
});
