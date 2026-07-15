/**
 * region-overlay-law.test.tsx — 60-04-PLAN.md Task 3: the role x status
 * matrix gate. Laws 1 and 3 on the document surface, made executable.
 *
 * WHY THIS GATE HAS A DIFFERENT SHAPE THAN THE INBOX'S (recorded so nobody
 * later "harmonizes" them): the inbox gate (`inbox-structure.test.tsx`)
 * compares a colour-blind DOM fingerprint against a frozen baseline,
 * because the inbox's redesign is a restructure and DOM shape is the
 * honest evidence. `RegionOverlayBox`'s entire job is class COMPOSITION
 * over an absolutely-positioned div — its redesign genuinely lives in the
 * class vocabulary, not in DOM topology. A shape-delta gate here would
 * prove nothing, so the honest gate is a semantic matrix over the
 * vocabulary. This file deliberately does NOT import `fingerprintTree` and
 * does not fabricate DOM to make a shape gate applicable.
 *
 * Mounts `RegionOverlayBox` over the cross-product of role in {entity,
 * field, unrelated, null} x status in {confirmed, candidate, pending,
 * rejected, superseded} — 20 cases — with a valid polygon and a fixed
 * pageSize.
 */

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { RegionOverlayBox } from "../region-overlay-box";
import { tierOf } from "../region-vocabulary";

import type { ComponentRole } from "../region-overlay-box";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_SIZE = { width: 800, height: 1000 };

const VALID_POLYGON: ReadonlyArray<readonly [number, number]> = [
  [0.1, 0.1],
  [0.2, 0.1],
  [0.2, 0.2],
  [0.1, 0.2],
];

const STATUSES = ["confirmed", "candidate", "pending", "rejected", "superseded"] as const;
const ROLES: ReadonlyArray<ComponentRole> = ["entity", "field", "unrelated", null];

interface RegionComponentFixture {
  readonly id: string;
  readonly attachmentId: string | null;
  readonly sourceType: string;
  readonly contentText: string | null;
  readonly extractionStatus: string;
  readonly location: unknown;
  readonly entityTypeLabel: string | null;
  readonly entityTypeSlug: string | null;
  readonly extractedFields: unknown;
  readonly confidenceScore: unknown;
  readonly role?: ComponentRole;
}

function makeComponent(
  status: string,
  role: ComponentRole,
  labelSource: "type" | "text" = "type",
): RegionComponentFixture {
  return {
    id: `c-${status}-${role ?? "none"}-${labelSource}`,
    attachmentId: "att-1",
    sourceType: "region",
    contentText: labelSource === "text" ? "some raw OCR text snippet" : null,
    extractionStatus: status,
    location: { type: "region", page_index: 0, polygon: VALID_POLYGON },
    entityTypeLabel: labelSource === "type" ? "Supplier" : null,
    entityTypeSlug: labelSource === "type" ? "supplier" : null,
    extractedFields: null,
    confidenceScore: null,
    role: role ?? undefined,
  };
}

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

afterEach(() => {
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
});

async function renderBox(component: RegionComponentFixture): Promise<HTMLElement> {
  const container = await mount(
    <RegionOverlayBox
      component={component}
      pageSize={PAGE_SIZE}
      activeComponentId={null}
      setActiveComponentId={() => undefined}
    />,
  );
  const box = container.querySelector<HTMLElement>("[data-component-id]");
  if (!box) throw new Error("RegionOverlayBox did not render a [data-component-id] element");
  return box;
}

describe("region-overlay-law (D-58-01 laws 1 and 3 on the document surface)", () => {
  describe("the empty-polygon guard (T-60-07)", () => {
    it("a component with polygon: [] renders nothing", async () => {
      const component: RegionComponentFixture = {
        ...makeComponent("confirmed", "entity"),
        location: { type: "region", page_index: 0, polygon: [] },
      };
      const container = await mount(
        <RegionOverlayBox
          component={component}
          pageSize={PAGE_SIZE}
          activeComponentId={null}
          setActiveComponentId={() => undefined}
        />,
      );
      expect(container.querySelector("[data-component-id]")).toBeNull();
      expect(container.innerHTML).toBe("");
    });
  });

  describe("TIER IS COLOUR — 20-case matrix (role x status)", () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        it(`role=${role ?? "null"} status=${status}: data-tier matches tierOf(status); solid/dashed and conf/sugg tokens follow tier alone`, async () => {
          const box = await renderBox(makeComponent(status, role));
          const expectedTier = tierOf(status);

          expect(box.getAttribute("data-tier")).toBe(expectedTier);

          if (expectedTier === "confirmed") {
            expect(box.className).toContain("conf");
            expect(box.className).not.toContain("border-dashed");
          } else if (expectedTier === "suggested") {
            expect(box.className).toContain("sugg");
            expect(box.className).toContain("border-dashed");
          } else {
            // terminal: a rejected/superseded region makes NO tier claim.
            expect(box.className).not.toContain("conf");
            expect(box.className).not.toContain("sugg");
          }
        });
      }
    }
  });

  describe("ROLE IS NOT COLOUR — for a fixed status, no two roles' class strings differ by a colour token", () => {
    for (const status of STATUSES) {
      it(`status=${status}: the class-string DIFFERENCE between any two roles contains no conf/sugg/graph- token`, async () => {
        const classesByRole = new Map<string, Set<string>>();
        for (const role of ROLES) {
          const box = await renderBox(makeComponent(status, role));
          classesByRole.set(role ?? "null", new Set(box.className.split(/\s+/).filter(Boolean)));
        }

        const roleKeys = Array.from(classesByRole.keys());
        for (let i = 0; i < roleKeys.length; i++) {
          for (let j = i + 1; j < roleKeys.length; j++) {
            const a = classesByRole.get(roleKeys[i]!)!;
            const b = classesByRole.get(roleKeys[j]!)!;
            const symmetricDiff = [
              ...Array.from(a).filter((cls) => !b.has(cls)),
              ...Array.from(b).filter((cls) => !a.has(cls)),
            ];
            for (const cls of symmetricDiff) {
              expect(
                cls,
                `role-only class difference "${cls}" (between ${roleKeys[i]} and ${roleKeys[j]} at status=${status}) must not carry a tier/graph token`,
              ).not.toMatch(/conf|sugg|graph-/);
            }
          }
        }
      });
    }
  });

  describe("ROLE IS LEGIBLE — for a fixed status, all four roles produce DISTINCT class strings", () => {
    for (const status of STATUSES) {
      it(`status=${status}: entity/field/unrelated/null all render distinguishably`, async () => {
        const classStrings: string[] = [];
        for (const role of ROLES) {
          const box = await renderBox(makeComponent(status, role));
          classStrings.push(box.className);
        }
        expect(new Set(classStrings).size).toBe(ROLES.length);
      });
    }
  });

  describe("LAW 1 ON CHROME — no graph- anywhere; selection/active/active-parent rings are ink, never a tier hue", () => {
    it("no rendered class contains graph- across the full matrix", async () => {
      for (const role of ROLES) {
        for (const status of STATUSES) {
          const box = await renderBox(makeComponent(status, role));
          expect(box.className).not.toContain("graph-");
        }
      }
    });

    it("selection ring is ring-ink and carries no tier hue", async () => {
      const container = await mount(
        <RegionOverlayBox
          component={makeComponent("confirmed", "entity")}
          pageSize={PAGE_SIZE}
          activeComponentId={null}
          setActiveComponentId={() => undefined}
          isSelected
        />,
      );
      const box = container.querySelector<HTMLElement>("[data-component-id]")!;
      expect(box.className).toContain("ring-ink");
      expect(box.className).not.toMatch(/ring-conf|ring-sugg/);
    });

    it("active-parent ring is ring-ink/20 and carries no tier hue", async () => {
      const container = await mount(
        <RegionOverlayBox
          component={makeComponent("candidate", "entity")}
          pageSize={PAGE_SIZE}
          activeComponentId={null}
          setActiveComponentId={() => undefined}
          isActiveParent
        />,
      );
      const box = container.querySelector<HTMLElement>("[data-component-id]")!;
      expect(box.className).toContain("ring-4");
      expect(box.className).toContain("ring-ink/20");
      expect(box.className).not.toMatch(/ring-conf|ring-sugg/);
    });

    it("hover-active (mouse-tracked) ring is ink, for every role, not just null", async () => {
      for (const role of ROLES) {
        const component = makeComponent("candidate", role);
        const container = await mount(
          <RegionOverlayBox
            component={component}
            pageSize={PAGE_SIZE}
            activeComponentId={component.id}
            setActiveComponentId={() => undefined}
          />,
        );
        const box = container.querySelector<HTMLElement>("[data-component-id]")!;
        expect(box.className).toContain("ring-ink/40");
      }
    });
  });

  describe("LAW 2 — serif only when the label carries the document's own words", () => {
    it("a box whose label falls back to content text carries data-evidence and font-serif", async () => {
      const box = await renderBox(makeComponent("candidate", "field", "text"));
      expect(box.hasAttribute("data-evidence")).toBe(false); // the BOX itself is chrome
      const chip = box.querySelector<HTMLElement>("span");
      expect(chip).not.toBeNull();
      expect(chip?.hasAttribute("data-evidence")).toBe(true);
      expect(chip?.className).toContain("font-serif");
    });

    it("a box with an entityTypeLabel carries neither data-evidence nor font-serif on its chip", async () => {
      const box = await renderBox(makeComponent("confirmed", "entity", "type"));
      const chip = box.querySelector<HTMLElement>("span");
      expect(chip).not.toBeNull();
      expect(chip?.hasAttribute("data-evidence")).toBe(false);
      expect(chip?.className).not.toContain("font-serif");
    });

    it("a box with neither an entityTypeLabel nor usable content text (status fallback) carries neither marker", async () => {
      const component: RegionComponentFixture = {
        ...makeComponent("pending", "unrelated"),
        entityTypeLabel: null,
        contentText: null,
      };
      const box = await renderBox(component);
      const chip = box.querySelector<HTMLElement>("span");
      expect(chip).not.toBeNull();
      expect(chip?.hasAttribute("data-evidence")).toBe(false);
      expect(chip?.className).not.toContain("font-serif");
      expect(chip?.textContent).toBe("pending");
    });
  });
});
