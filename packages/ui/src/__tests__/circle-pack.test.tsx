/**
 * circle-pack.test.tsx — TM-01 rendering behaviour (jsdom = behaviour only, NO
 * visual claim; jsdom does no layout). Covers: one SVG node per circle, the
 * leaf render-prop slot firing per leaf, leaf activation on click and on Enter,
 * and the hover card.
 *
 * createRoot + act, mirroring the canvas suite's mount convention — no
 * testing-library dependency in this package.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CirclePack, type CircleDatum } from "../circle-pack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface LeafRef {
  readonly emailId: string;
}

const DATA: CircleDatum<LeafRef> = {
  name: "Mailbox",
  children: [
    {
      name: "alice@example.com",
      children: [
        { name: "Q3 renewal", value: 3, leaf: { emailId: "e1" }, tint: 0.9 },
        { name: "Invoice", value: 1, leaf: { emailId: "e2" }, tint: 0.2 },
      ],
    },
    {
      name: "bob@example.com",
      children: [{ name: "Contract", value: 4, leaf: { emailId: "e3" }, tint: 0.5 }],
    },
  ],
};

let containers: HTMLDivElement[] = [];

async function mount(el: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(el);
  });
  return container;
}

afterEach(() => {
  for (const c of containers) c.remove();
  containers = [];
});

describe("CirclePack — structure", () => {
  it("renders one <g data-circle-id> per node (root + 2 senders + 3 leaves)", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    const groups = container.querySelectorAll("g[data-circle-id]");
    expect(groups.length).toBe(6);
    expect(container.querySelectorAll('g[data-leaf="true"]').length).toBe(3);
  });

  it("exposes an accessible, focusable group", async () => {
    const container = await mount(
      <CirclePack data={DATA} width={200} height={200} ariaLabel="Email landscape" />,
    );
    const view = container.querySelector('[data-testid="circle-pack"]')!;
    expect(view.getAttribute("role")).toBe("group");
    expect(view.getAttribute("aria-label")).toBe("Email landscape");
    expect(view.getAttribute("tabindex")).toBe("0");
  });
});

describe("CirclePack — leaf render slot", () => {
  it("invokes renderLeaf once per leaf and mounts its SVG content", async () => {
    const renderLeaf = vi.fn(({ circle }) => (
      <text data-testid="leaf-label">{circle.datum.name}</text>
    ));
    const container = await mount(
      <CirclePack data={DATA} width={300} height={300} renderLeaf={renderLeaf} />,
    );
    // Called for every leaf (may run again on an animation re-render — assert
    // the rendered result, which is the stable fact: one label per leaf).
    expect(renderLeaf).toHaveBeenCalled();
    const names = renderLeaf.mock.calls.map((c) => c[0].circle.datum.name);
    expect(new Set(names)).toEqual(new Set(["Q3 renewal", "Invoice", "Contract"]));
    expect(container.querySelectorAll('[data-testid="leaf-label"]').length).toBe(3);
  });
});

describe("CirclePack — leaf activation", () => {
  it("clicking a leaf circle fires onLeafActivate with the leaf payload", async () => {
    const onLeafActivate = vi.fn();
    const container = await mount(
      <CirclePack data={DATA} width={300} height={300} onLeafActivate={onLeafActivate} />,
    );
    const leaf = container.querySelector('g[data-circle-id="0/0/0"]')!;
    await act(async () => {
      leaf.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onLeafActivate).toHaveBeenCalledTimes(1);
    expect(onLeafActivate.mock.calls[0][0].datum.leaf).toEqual({ emailId: "e1" });
  });

  it("Enter on a cursored leaf activates it (keyboard contract)", async () => {
    const onLeafActivate = vi.fn();
    const container = await mount(
      <CirclePack data={DATA} width={300} height={300} onLeafActivate={onLeafActivate} />,
    );
    const view = container.querySelector('[data-testid="circle-pack"]') as HTMLElement;
    // root -> ArrowDown (sender) -> ArrowDown (leaf) -> Enter
    const key = (k: string) =>
      act(async () => {
        view.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      });
    // dispatchEvent bypasses React's synthetic system; drive via React props
    // instead by focusing and using the onKeyDown handler through fireEvent-like
    // native events on the element React attached to. React 19 attaches its
    // listener at the root, so a bubbling native KeyboardEvent reaches it.
    await key("ArrowDown");
    await key("ArrowDown");
    await key("Enter");
    expect(onLeafActivate).toHaveBeenCalled();
    expect(onLeafActivate.mock.calls.at(-1)![0].datum.leaf).toEqual({ emailId: "e1" });
  });
});

describe("CirclePack — zoom-out affordances (touch has no Escape key)", () => {
  const click = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  it("shows a zoom-out button only while zoomed in, and it zooms back out", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    expect(container.querySelector('[data-testid="circle-pack-zoom-out"]')).toBeNull();

    // Zoom into a sender container.
    await click(container.querySelector('g[data-circle-id="0/0"]')!);
    const button = container.querySelector('[data-testid="circle-pack-zoom-out"]');
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Zoom out");

    await click(button!);
    expect(container.querySelector('[data-testid="circle-pack-zoom-out"]')).toBeNull();
  });

  it("clicking the currently-focused container zooms out to its parent", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    const sender = container.querySelector('g[data-circle-id="0/0"]')!;
    await click(sender); // zoom in → focused on 0/0
    expect(container.querySelector('[data-testid="circle-pack-zoom-out"]')).not.toBeNull();
    await click(sender); // same circle again → back out to the root
    expect(container.querySelector('[data-testid="circle-pack-zoom-out"]')).toBeNull();
  });

  it("clicking a leaf does not strand the viewport (focus goes to its parent, not the leaf)", async () => {
    const onLeafActivate = vi.fn();
    const container = await mount(
      <CirclePack data={DATA} width={300} height={300} onLeafActivate={onLeafActivate} />,
    );
    await click(container.querySelector('g[data-circle-id="0/0/0"]')!);
    expect(onLeafActivate).toHaveBeenCalledTimes(1);
    // Zoomed to the leaf's parent → the way back out must be visible.
    expect(container.querySelector('[data-testid="circle-pack-zoom-out"]')).not.toBeNull();
  });
});

describe("CirclePack — breadcrumb / reset / back (the way OUT)", () => {
  const click = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  it("hides the whole nav bar at the root and shows it once drilled in", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).toBeNull();
    await click(container.querySelector('g[data-circle-id="0/0"]')!); // into a sender
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="circle-pack-reset"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="circle-pack-breadcrumb"]')).not.toBeNull();
  });

  it("renders a crumb per ancestor, root → focus, with the focus crumb disabled", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    await click(container.querySelector('g[data-circle-id="0/0"]')!); // focus a sender
    const crumbs = Array.from(
      container.querySelectorAll('[data-testid="circle-pack-crumb"]'),
    ) as HTMLButtonElement[];
    expect(crumbs.map((c) => c.getAttribute("data-crumb-id"))).toEqual(["0", "0/0"]);
    // The current-location crumb is not itself a jump target.
    expect(crumbs.at(-1)!.disabled).toBe(true);
    expect(crumbs[0]!.disabled).toBe(false);
  });

  it("clicking the root crumb resets all the way out", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    await click(container.querySelector('g[data-circle-id="0/0"]')!);
    const rootCrumb = container.querySelector('[data-crumb-id="0"]')!;
    await click(rootCrumb);
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).toBeNull();
  });

  it("the reset control returns home from any depth", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    await click(container.querySelector('g[data-circle-id="0/0"]')!);
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).not.toBeNull();
    await click(container.querySelector('[data-testid="circle-pack-reset"]')!);
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).toBeNull();
  });

  it("the back button steps up exactly one level", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    // drill root → sender (0/0)
    await click(container.querySelector('g[data-circle-id="0/0"]')!);
    let crumbs = container.querySelectorAll('[data-testid="circle-pack-crumb"]');
    expect(crumbs.length).toBe(2); // [root, sender]
    await click(container.querySelector('[data-testid="circle-pack-zoom-out"]')!);
    // one level up = back at the root → nav bar gone
    expect(container.querySelector('[data-testid="circle-pack-nav"]')).toBeNull();
  });
});

describe("CirclePack — hover card", () => {
  it("shows a hover card naming the circle under the pointer", async () => {
    const container = await mount(<CirclePack data={DATA} width={300} height={300} />);
    expect(container.querySelector('[data-testid="circle-pack-hover-card"]')).toBeNull();
    const sender = container.querySelector('g[data-circle-id="0/1"]')!;
    await act(async () => {
      // React synthesizes onMouseEnter from native mouseover (bubbling); a raw
      // "mouseenter" event would not drive React's synthetic enter/leave.
      sender.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    const card = container.querySelector('[data-testid="circle-pack-hover-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("bob@example.com");
  });
});
