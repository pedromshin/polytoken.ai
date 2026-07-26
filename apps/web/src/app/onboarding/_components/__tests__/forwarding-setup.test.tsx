/**
 * forwarding-setup.test.tsx — the /onboarding client surface.
 *
 * jsdom via createRoot + act (this repo's convention — no @testing-library):
 * proves the personal forwarding address renders and the Copy affordance is
 * present and wired to the clipboard. Layout/look is NOT asserted here — jsdom
 * does no layout; that's owed to screenshot/geometry.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AddressData {
  token: string;
  address: string;
}

let addressState: {
  data: AddressData | undefined;
  isPending: boolean;
  isError: boolean;
  error: { message: string } | null;
} = {
  data: { token: "tok_abc", address: "u-tok_abc@mail.example.com" },
  isPending: false,
  isError: false,
  error: null,
};

let emailsState: {
  data: { items: unknown[]; hasMore: boolean } | undefined;
  isPending: boolean;
  isError: boolean;
} = { data: { items: [], hasMore: false }, isPending: false, isError: false };

vi.mock("~/trpc/react", () => ({
  api: {
    forwarding: {
      getOrCreateMyAddress: { useQuery: () => addressState },
    },
    emails: {
      list: { useQuery: () => emailsState },
    },
  },
}));

import { ForwardingSetup } from "../forwarding-setup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<ForwardingSetup />);
  });
}

function button(re: RegExp): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((b) =>
    re.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
}

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  addressState = {
    data: { token: "tok_abc", address: "u-tok_abc@mail.example.com" },
    isPending: false,
    isError: false,
    error: null,
  };
  emailsState = { data: { items: [], hasMore: false }, isPending: false, isError: false };
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("ForwardingSetup", () => {
  it("renders the personal forwarding address", async () => {
    await mount();
    expect(container.textContent ?? "").toContain("u-tok_abc@mail.example.com");
  });

  it("renders a Copy button that writes the address to the clipboard", async () => {
    await mount();
    const btn = button(/copy/i);
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
    });
    expect(writeText).toHaveBeenCalledWith("u-tok_abc@mail.example.com");
  });

  it("renders the numbered setup steps", async () => {
    await mount();
    const text = container.textContent ?? "";
    expect(text).toContain("Send yourself a test email");
    expect(container.querySelectorAll("ol li").length).toBe(4);
  });

  it("shows a graceful message while the address is loading", async () => {
    addressState = { data: undefined, isPending: true, isError: false, error: null };
    await mount();
    expect(button(/copy/i)).toBeUndefined();
  });
});
