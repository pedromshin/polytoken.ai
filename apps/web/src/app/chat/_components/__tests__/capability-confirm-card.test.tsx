/**
 * capability-confirm-card.test.tsx — CapabilityConfirmCard (INV-4 chat-side
 * confirm affordance) unit tests:
 *   - read risk renders NOTHING (the one gate, risk-gate.ts, says no confirm);
 *   - write/exec render the card in the suggested (dashed) register with the
 *     tier vocabulary and both controls;
 *   - approve fires `onConfirm` exactly once, even under a double click;
 *   - dismiss fires `onDismiss` and NEVER `onConfirm`, and withdraws the card.
 *
 * Mounts the REAL component — mirrors this repo's createRoot-in-jsdom + `act`
 * convention (compact-interaction-entry.test.tsx, tool-invocation-result-row.test.tsx).
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CapabilityManifestEntry, Risk } from "@polytoken/capabilities";

import { CapabilityConfirmCard } from "../capability-confirm-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let containers: HTMLDivElement[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return container;
}

function makeEntry(risk: Risk): CapabilityManifestEntry {
  return {
    id: "daemon.fs.write",
    describe: "Write a file inside the granted directory.",
    risk,
    cost: "free",
    source: "builtin",
    trust: "first-party",
  };
}

async function click(button: Element): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const approveButton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector<HTMLButtonElement>('button[aria-label^="Approve"]');
const dismissButton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector<HTMLButtonElement>('button[aria-label^="Dismiss"]');

describe("CapabilityConfirmCard", () => {
  afterEach(() => {
    for (const c of containers) {
      document.body.removeChild(c);
    }
    containers = [];
  });

  it("renders NOTHING for a read-risk capability (requiresConfirm gate)", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const container = await mount(
      <CapabilityConfirmCard entry={makeEntry("read")} args={{ path: "/notes.md" }} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );
    expect(container.firstChild).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("renders the card for write risk: id, describe line, tier label, both controls, dashed register", async () => {
    const container = await mount(
      <CapabilityConfirmCard entry={makeEntry("write")} args={{ path: "/notes.md" }} onConfirm={vi.fn()} onDismiss={vi.fn()} />,
    );

    const card = container.querySelector('[role="group"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-state")).toBe("suggested");
    // Machine-suggested framing: dashed border until a human approves.
    expect(card!.className).toContain("border-dashed");

    expect(container.textContent).toContain("daemon.fs.write");
    expect(container.textContent).toContain("Write a file inside the granted directory.");
    // The ONE risk vocabulary's write-tier label (capability-vocabulary.ts).
    expect(container.textContent).toContain("Changes data");

    expect(approveButton(container)).not.toBeNull();
    expect(dismissButton(container)).not.toBeNull();
    // Write is the caution tier, not the irreversible class: approve is ink,
    // not the madder fill.
    expect(approveButton(container)!.className).not.toContain("bg-destructive");
  });

  it("renders the card for exec risk with the exec tier label and the madder-fill approve", async () => {
    const container = await mount(
      <CapabilityConfirmCard entry={makeEntry("exec")} args={{ path: "/notes.md" }} onConfirm={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(container.querySelector('[role="group"]')).not.toBeNull();
    expect(container.textContent).toContain("Runs programs");
    // Exec IS the irreversible class — the one scope where the accent is earned.
    expect(approveButton(container)!.className).toContain("bg-destructive");
    expect(dismissButton(container)).not.toBeNull();
  });

  it("approve fires onConfirm exactly once (double click cannot double-fire) and never onDismiss", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const container = await mount(
      <CapabilityConfirmCard entry={makeEntry("write")} args={{ path: "/notes.md" }} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );

    const approve = approveButton(container)!;
    await click(approve);
    // Second click on the same node — the ref guard must hold even if the
    // decided re-render had not yet removed the control.
    await click(approve);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();

    // Approved state: solid register, controls gone, card still present.
    const card = container.querySelector('[role="group"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-state")).toBe("approved");
    expect(card!.className).not.toContain("border-dashed");
    expect(approveButton(container)).toBeNull();
    expect(dismissButton(container)).toBeNull();
  });

  it("dismiss fires onDismiss, NEVER onConfirm, and withdraws the card", async () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const container = await mount(
      <CapabilityConfirmCard entry={makeEntry("exec")} args={{ path: "/notes.md" }} onConfirm={onConfirm} onDismiss={onDismiss} />,
    );

    const dismiss = dismissButton(container)!;
    await click(dismiss);
    await click(dismiss);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    // The suggestion withdraws itself entirely.
    expect(container.querySelector('[role="group"]')).toBeNull();
  });
});
