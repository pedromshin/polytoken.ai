/**
 * delete-account.test.tsx — the /settings/account danger-zone surface.
 *
 * jsdom via createRoot + act (this repo's convention — no @testing-library):
 * proves the destructive delete is GATED behind the AlertDialog confirm (no
 * POST from the surface alone) and that confirming POSTs to
 * /api/account/delete. Layout/look is NOT asserted here — jsdom does no layout;
 * that's owed to screenshot/geometry.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("~/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import { DeleteAccount } from "../delete-account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DeleteAccount />);
  });
}

// The AlertDialog confirm renders into a Radix portal on document.body, not
// inside our container — so search the whole document.
function findButton(re: RegExp): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find((b) =>
    re.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

beforeEach(() => {
  signOut.mockClear();
  // Stub navigation — jsdom throws on real location assignment.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: "" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200 }) as Response),
  );
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

describe("DeleteAccount", () => {
  it("gates the delete behind the confirm dialog — no POST from the surface alone", async () => {
    await mount();
    // The trigger is present, but the confirm action is not mounted (dialog
    // closed), and nothing has been POSTed.
    expect(findButton(/delete account/i)).toBeTruthy();
    expect(findButton(/delete permanently/i)).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("POSTs to /api/account/delete only after confirming in the dialog", async () => {
    await mount();

    // Open the dialog.
    await act(async () => {
      findButton(/delete account/i)!.click();
    });
    const confirm = findButton(/delete permanently/i);
    expect(confirm).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();

    // Confirm.
    await act(async () => {
      confirm!.click();
    });

    expect(fetch).toHaveBeenCalledWith("/api/account/delete", { method: "POST" });
    expect(signOut).toHaveBeenCalled();
  });
});
