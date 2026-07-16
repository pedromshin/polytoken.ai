/**
 * message-stream-law.test.tsx — 61-04-PLAN.md Task 3. Law 2 on the message
 * stream, and law 1 on the tool rounds.
 *
 * WHY THE STREAM IS LAW 2'S HARD CASE, AND WHY IT GETS ITS OWN GATE: every
 * other surface Phase 60 swept renders one provenance per element — a subject
 * is a subject, a type name is a type name. A chat answer does not. ONE
 * assistant turn mixes polytoken's own voice (the prose) with the user's own
 * material (a cited email's real subject) inside a few hundred pixels, and the
 * ONE component that carries the user's material into it — `ProvenanceLink` —
 * receives BOTH provenances through the SAME `label` prop. Law 2 either
 * becomes executable here or it quietly does not hold on this surface.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE TRUSTING A GREEN RUN. TWO LIMITS, BOTH REAL.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * 1. **THE LAW-1 LEG IS A PROXY, NOT A PROOF.** It asserts that no rendered
 *    class on either tool row carries the madder TEXT or BORDER token. That is
 *    the closest a class-reading test can get to a rule about INTENT, and it is
 *    not the rule. `role-hue-ban.test.ts` says so about itself in the same
 *    words, and it has a KNOWN blind spot in this exact direction: 60-06 found
 *    `<Badge variant="destructive">Preview failed</Badge>` in
 *    `pdf-preview-pane.tsx` — a status wearing the identity's irreversible
 *    colour, PASSING the gate, found only by a human reading the file. 61-04
 *    found its own by reading too: this row's AlertTriangle wore the madder
 *    text token, and no gate objected for two milestones. **Do not let a green
 *    run here read as "law 1 has been checked on this surface."** It has been
 *    checked by a person; this leg only makes the cheap regression expensive.
 *
 * 2. **jsdom COMPUTES NO LAYOUT AND RUNS NO CASCADE.** This file can see class
 *    STRINGS and attributes. It cannot see that `pmark` sets `font-family:
 *    var(--font-serif)` and therefore cannot catch serif ARRIVING BY
 *    INHERITANCE — the exact trap 60-05 hit and 60-06 re-hit. Leg 6 covers the
 *    only part of that a className-reading gate can cover (the marker class
 *    being present at all). The rest is covered by `ProvenanceLink` composing
 *    its chip instead of wearing `pmark` (D-61-04-B, recorded in that file's
 *    header) — a structural choice, not an assertion. Nor can this file see
 *    that a class EXISTS: `break-words` is the Tailwind v3 name and emits
 *    nothing in v4, and every assertion here would have passed on it.
 *    `npm run test:geometry` and the built sheet own those halves.
 *
 * ON WRITING LITERALS IN THIS FILE: `role-hue-ban.test.ts` is a RATCHET whose
 * `SCOPED_DIRS` Phases 61-63 append their surface roots to as they sweep, and
 * this file sits under `chat/`. That gate matches a colour-utility PREFIX + the
 * family and reads LINES, not prose — it cannot tell an assertion from a class.
 * So the banned families below are assembled at runtime and never written out,
 * exactly as that gate and `chat-frame-structure.test.tsx` assemble their own.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { MessageTurn } from "../message-turn";
import { ToolRoundActivityRow } from "../tool-round-activity-row";
import { ToolInvocationResultRow } from "../tool-invocation-result-row";
import { ProvenanceLink } from "~/components/provenance-link";
import type { MessagePart } from "../../_hooks/use-chat-stream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Assembled at runtime; never written out (see the header note) ──────────
/** The identity's irreversible colour. Law 1: actions only, never states. */
const MADDER = ["destruc", "tive"].join("");
/** The retired role-as-hue family (law 3). */
const ROLE_HUE = ["gra", "ph"].join("");
/** Colour-bearing utility prefixes that make a token PAINT something. */
const COLOR_PREFIXES = ["bg", "text", "border", "ring", "fill", "stroke", "outline", "shadow"];
/** Madder as a STATE — the banned half. The allowed half is a fill/variant on
 * a genuinely irreversible control, which is why only text/border match. */
const STATE_MADDER = new RegExp(`\\b(?:text|border)-${MADDER}\\b(?!-foreground)`);
const ROLE_HUE_PATTERN = new RegExp(`\\b(?:${COLOR_PREFIXES.join("|")})-${ROLE_HUE}-[a-z]`);
/**
 * The serif-bearing marker utilities. `pmark` IMPLIES `font-serif`
 * (globals.css:419), and `REGION_TIER.chip` is built ON `pmark` — that
 * implication is invisible to a class-reading gate, which is precisely why
 * leg 6 exists.
 *
 * MATCHED AS A WHOLE CLASS TOKEN, NOT AS A SUBSTRING, AND THAT IS LOAD-
 * BEARING. `/\bchip\b/` looks correct and is not: it matches `px-chip-x` and
 * `py-chip-y`, the NAMED SPACING STEP every chip in the app uses — so the
 * pattern fires on the correctly-built chip and reports the one element that
 * is right. (It did exactly that on first run.) `role-hue-ban.test.ts` warns
 * about this precise failure in its own header: "widen the pattern to a bare
 * family match and this gate will execute its own siblings." A gate that
 * cries wolf on the right answer gets deleted.
 */
const SERIF_MARKER_TOKENS = new Set(["pmark", "chip"]);

function wearsSerifMarker(className: string): boolean {
  return className
    .split(/\s+/)
    .some((token) => SERIF_MARKER_TOKENS.has(token) || token.startsWith("pmark-"));
}

// ── The real subject of a real email. The user's own material — evidence. ──
const REAL_SUBJECT = "Cotação frete SP → POA — Lote 88";
const EMAIL_ID = "1a2b3c4d5e6f7788";

const ASSISTANT_PROSE = "Acme Freight came back at R$ 4.820,00 — pickup Friday.";
const USER_PROSE = "What did Acme Freight quote for Lote 88?";

let containers: HTMLDivElement[] = [];
let roots: Root[] = [];

async function mount(element: React.ReactElement): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  for (const c of containers) c.remove();
  containers = [];
  roots = [];
});

/** Every element in the tree, root included. */
function allElements(container: HTMLElement): HTMLElement[] {
  return [container, ...Array.from(container.querySelectorAll<HTMLElement>("*"))];
}

function classesOf(el: HTMLElement): string {
  // SVG elements carry SVGAnimatedString, not string — lucide icons are in
  // this tree, so a naive `el.className.split()` would throw on them.
  return typeof el.className === "string" ? el.className : String(el.getAttribute("class") ?? "");
}

function hasClass(el: HTMLElement, cls: string): boolean {
  return classesOf(el).split(/\s+/).includes(cls);
}

function describeEl(el: HTMLElement): string {
  return `<${el.tagName.toLowerCase()} class="${classesOf(el)}"> "${(el.textContent ?? "").slice(0, 40)}"`;
}

// ═══════════════════════════════════════════════════════════════════════════

describe("message-stream-law (D-58-01 laws 1 and 2 on the chat stream)", () => {
  // ── LEG 1 ────────────────────────────────────────────────────────────────
  describe("LEG 1 — the pair holds BOTH ways: font-serif <-> data-evidence", () => {
    /**
     * Asserted as a MUTUAL IMPLICATION over the whole rendered tree rather
     * than as two spot checks on two known elements. That is what makes it a
     * gate instead of two examples: it constrains elements this file has never
     * heard of, including ones a later plan adds. brand-guide §3: "the gates
     * enforce the pair, so marking one without the other is a test failure,
     * not a style nit."
     */
    async function assertPairHolds(container: HTMLElement, label: string): Promise<void> {
      for (const el of allElements(container)) {
        const serif = hasClass(el, "font-serif");
        const evidence = el.hasAttribute("data-evidence");
        expect(
          serif === evidence,
          `${label}: font-serif and data-evidence must imply each other, but this element has ` +
            `font-serif=${serif} and data-evidence=${evidence}:\n    ${describeEl(el)}\n` +
            `  Law 2 marks the USER'S OWN MATERIAL. font-serif without data-evidence is serif on ` +
            `something we have not claimed is evidence; data-evidence without font-serif is a ` +
            `claim we are not honouring. Both, or neither.`,
        ).toBe(true);
      }
    }

    it("holds on a citation chip carrying a real subject (the evidence branch)", async () => {
      const container = await mount(
        <ProvenanceLink kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />,
      );
      await assertPairHolds(container, "ProvenanceLink[label]");
      // ...and is not vacuous: this tree really does contain the pair.
      expect(container.querySelectorAll("[data-evidence]").length).toBe(1);
    });

    it("holds on a citation chip with no label (the chrome branch)", async () => {
      const container = await mount(<ProvenanceLink kind="email" id={EMAIL_ID} />);
      await assertPairHolds(container, "ProvenanceLink[no label]");
    });

    it("holds across an assistant turn mixing prose, a tool round and chips", async () => {
      const parts: MessagePart[] = [
        {
          type: "tool_invocation_result",
          toolUseId: "t1",
          toolName: "search_emails",
          content: JSON.stringify({
            results: [1, 2],
            citations: [
              { kind: "email", id: EMAIL_ID, route: "" },
              { kind: "entity", id: "e2", route: "" },
            ],
          }),
          isError: false,
        },
        { type: "text", text: ASSISTANT_PROSE },
      ];
      const container = await mount(
        <MessageTurn role="assistant" parts={parts} status="completed" />,
      );
      await assertPairHolds(container, "assistant turn (prose + round + chips)");
    });

    it("holds on a user turn", async () => {
      const container = await mount(
        <MessageTurn role="user" parts={[{ type: "text", text: USER_PROSE }]} />,
      );
      await assertPairHolds(container, "user turn");
    });

    it("holds on both tool rows", async () => {
      const a = await mount(<ToolRoundActivityRow toolName="search_emails" />);
      await assertPairHolds(a, "ToolRoundActivityRow");
      const b = await mount(
        <ToolInvocationResultRow toolName="search_emails" content="{}" isError={true} />,
      );
      await assertPairHolds(b, "ToolInvocationResultRow[isError]");
    });
  });

  // ── LEG 2 ────────────────────────────────────────────────────────────────
  describe("LEG 2 — evidence is DISCRIMINATED: same component, same props shape, opposite treatment", () => {
    /**
     * The heart of the plan. `label ?? fallbackLabel(kind, id)` collapsed an
     * email's real subject and polytoken's own placeholder into one string, so
     * the component was structurally unable to obey law 2. These two tests are
     * the same component with the same props shape, decided ONLY by where the
     * words came from.
     */
    it("a real subject renders serif AND data-evidence", async () => {
      const container = await mount(
        <ProvenanceLink kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />,
      );
      const span = Array.from(container.querySelectorAll<HTMLElement>("span")).find(
        (s) => s.textContent === REAL_SUBJECT,
      );
      expect(span, "the chip did not render the real subject at all").toBeDefined();
      expect(hasClass(span!, "font-serif"), "the mail's own words must be serif (law 2)").toBe(true);
      expect(span!.hasAttribute("data-evidence")).toBe(true);
    });

    it("the fallback label renders sans with NEITHER marker", async () => {
      const container = await mount(<ProvenanceLink kind="email" id={EMAIL_ID} />);
      const span = Array.from(container.querySelectorAll<HTMLElement>("span")).find((s) =>
        s.textContent?.startsWith("Email · "),
      );
      expect(span, "the chip did not render the fallback label at all").toBeDefined();
      expect(
        hasClass(span!, "font-serif"),
        "'Email · 1a2b3c4d' is POLYTOKEN'S OWN word for a thing it cannot name — chrome, so sans. " +
          "Serif here would claim the user's mail said 'Email · 1a2b3c4d'.",
      ).toBe(false);
      expect(span!.hasAttribute("data-evidence")).toBe(false);
    });

    it("the href is built from kind+id and is IDENTICAL across both branches (T-61-12)", async () => {
      // Typography here makes a provenance claim; if a crafted subject could
      // move the href, the chip could wear the serif that vouches for the
      // user's mail while pointing somewhere else.
      const evidence = await mount(
        <ProvenanceLink kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />,
      );
      const chrome = await mount(<ProvenanceLink kind="email" id={EMAIL_ID} />);
      const href = (c: HTMLElement) => c.querySelector("a")?.getAttribute("href");
      expect(href(evidence)).toBe(`/emails/${EMAIL_ID}`);
      expect(href(evidence)).toBe(href(chrome));
    });

    it("a hostile subject cannot promote itself — a blank label falls back to chrome", async () => {
      // The blank check can only DEMOTE evidence -> chrome, never promote.
      const container = await mount(<ProvenanceLink kind="email" id={EMAIL_ID} label="   " />);
      expect(container.querySelectorAll("[data-evidence]").length).toBe(0);
      expect(container.textContent).toBe(`Email · ${EMAIL_ID.slice(0, 8)}`);
    });
  });

  // ── LEG 3 ────────────────────────────────────────────────────────────────
  describe("LEG 3 — polytoken's voice is SANS, on BOTH roles", () => {
    /**
     * The tempting wrong move, and the reason 58-IDENTITY audited its own
     * sketch: the assistant's answer is the most "document-like" text on the
     * surface, so it invites the serif. It is polytoken SPEAKING. The sketch's
     * own manifesto lede was set back to sans to prove the rule obeys itself —
     * "Nothing polytoken says in its own voice wears the serif, not even a
     * manifesto" — and one exception makes the rule unlearnable.
     */
    it("an assistant text turn's prose carries neither font-serif nor data-evidence", async () => {
      const container = await mount(
        <MessageTurn
          role="assistant"
          parts={[{ type: "text", text: ASSISTANT_PROSE }]}
          status="completed"
        />,
      );
      expect(container.textContent).toContain("Acme Freight came back");
      for (const el of allElements(container)) {
        expect(
          hasClass(el, "font-serif"),
          `The assistant's answer is POLYTOKEN SPEAKING, so it is sans. The serif marks the ` +
            `user's own MATERIAL — mail, saved sources, values pulled out of them — never a ` +
            `voice. Offender:\n    ${describeEl(el)}`,
        ).toBe(false);
        expect(el.hasAttribute("data-evidence")).toBe(false);
      }
    });

    it("a user turn's typed message carries neither either", async () => {
      const container = await mount(
        <MessageTurn role="user" parts={[{ type: "text", text: USER_PROSE }]} />,
      );
      expect(container.textContent).toContain("Acme Freight quote");
      for (const el of allElements(container)) {
        expect(
          hasClass(el, "font-serif"),
          `A user's TYPED MESSAGE is the user talking to polytoken — not material quoted from ` +
            `their mail. Sans. Offender:\n    ${describeEl(el)}`,
        ).toBe(false);
        expect(el.hasAttribute("data-evidence")).toBe(false);
      }
    });

    it("the ONLY serif in a full assistant turn comes from a labelled citation chip", async () => {
      // Positive control for leg 3: proves the two tests above are not green
      // merely because nothing in this suite can ever be serif.
      const container = await mount(
        <div>
          <MessageTurn
            role="assistant"
            parts={[{ type: "text", text: ASSISTANT_PROSE }]}
            status="completed"
          />
          <ProvenanceLink kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />
        </div>,
      );
      const serif = allElements(container).filter((el) => hasClass(el, "font-serif"));
      expect(serif).toHaveLength(1);
      expect(serif[0]?.textContent).toBe(REAL_SUBJECT);
    });
  });

  // ── LEG 4 ────────────────────────────────────────────────────────────────
  describe("LEG 4 — the tool round is NOT a button", () => {
    /**
     * An affordance lie is a design bug with a checkable signature: chrome
     * promising an interaction the element does not have. This row is a
     * `role="status"` div with no handler and no tabindex, and it wore a hover
     * background and a focus ring for two milestones.
     */
    it("renders no hover-background class and no focus-ring class, and is not focusable", async () => {
      const container = await mount(<ToolRoundActivityRow toolName="search_emails" />);
      const row = container.querySelector<HTMLElement>('[role="status"]');
      expect(row, "the activity row must keep role=status").not.toBeNull();

      const cls = classesOf(row!);
      expect(
        cls,
        `a hover BACKGROUND on a non-interactive status div invites a click that does nothing: "${cls}"`,
      ).not.toMatch(/hover:bg-/);
      expect(
        cls,
        `a focus RING on an element that can never receive focus is chrome describing an ` +
          `interaction that does not exist: "${cls}"`,
      ).not.toMatch(/focus-visible:ring|focus:ring/);

      // The other half: it must not have quietly BECOME focusable to justify
      // the ring — that would satisfy the class checks by making the lie true.
      expect(row!.hasAttribute("tabindex")).toBe(false);
      expect(container.querySelectorAll("button, a, [role='button']")).toHaveLength(0);
    });

    it("keeps its 39-UI-SPEC copy and its spinner", async () => {
      // The row must stay quiet, not disappear. Guards against "fixing" the
      // affordance lie by deleting the affordance.
      const known = await mount(<ToolRoundActivityRow toolName="search_emails" />);
      expect(known.textContent).toBe("Searching emails…");
      const unknown = await mount(<ToolRoundActivityRow toolName="mystery_tool" />);
      expect(unknown.textContent).toBe("Running a lookup…");
      expect(known.querySelector("svg")).not.toBeNull();
    });
  });

  // ── LEG 5 ────────────────────────────────────────────────────────────────
  describe("LEG 5 — law 1 on the rounds: no madder on a state (A PROXY — see the header)", () => {
    /**
     * `isError` is a STATE. 58-IDENTITY: madder means "irreversible — this
     * cannot be undone", allowed on destructive CONTROLS and "never errors,
     * never warnings". A failed lookup is retryable.
     *
     * THIS LEG DID NOT FIND THE VIOLATION IT NOW GUARDS. A human reading the
     * file did. See the header before treating a green run as a law-1 check.
     */
    const TOOL_ROW_CASES: ReadonlyArray<readonly [string, React.ReactElement]> = [
      ["in-flight", <ToolRoundActivityRow toolName="search_emails" key="a" />],
      [
        "settled + citations",
        <ToolInvocationResultRow
          key="b"
          toolName="search_emails"
          content={JSON.stringify({
            results: [1],
            citations: [{ kind: "email", id: EMAIL_ID, route: "" }],
          })}
          isError={false}
        />,
      ],
      [
        "settled + isError",
        <ToolInvocationResultRow key="c" toolName="search_emails" content="boom" isError={true} />,
      ],
      [
        "settled + unparseable content",
        <ToolInvocationResultRow key="d" toolName="search_emails" content="{trunc" isError={false} />,
      ],
      [
        "settled + zero results",
        <ToolInvocationResultRow
          key="e"
          toolName="search_emails"
          content={JSON.stringify({ results: [], citations: [] })}
          isError={false}
        />,
      ],
    ];

    for (const [label, element] of TOOL_ROW_CASES) {
      it(`${label}: no rendered class carries a madder text/border token, or a retired role hue`, async () => {
        const container = await mount(element);
        for (const el of allElements(container)) {
          const cls = classesOf(el);
          expect(
            cls,
            `Law 1: madder means "irreversible — this cannot be undone", never an error and ` +
              `never a status. A failed tool round is a STATE and retrying it is one click ` +
              `away. An error is ink on a rule; an uncertain read is pencil. Offender:\n` +
              `    ${describeEl(el)}`,
          ).not.toMatch(STATE_MADDER);
          expect(cls, `Law 3: type/role is shape, never hue.\n    ${describeEl(el)}`).not.toMatch(
            ROLE_HUE_PATTERN,
          );
        }
      });
    }

    it("the isError row still ANNOUNCES itself — quiet is not silent", async () => {
      // Guards the other side of the fix: law 1 removed the colour, not the
      // signal. The row keeps role=alert and its copy.
      const container = await mount(
        <ToolInvocationResultRow toolName="search_emails" content="boom" isError={true} />,
      );
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).toContain("Couldn't search emails.");
      expect(container.querySelector("svg"), "the triangle carries the meaning by SHAPE").not.toBeNull();
    });
  });

  // ── LEG 6 ────────────────────────────────────────────────────────────────
  describe("LEG 6 — no serif smuggling via pmark/chip", () => {
    /**
     * `pmark`/`chip` set `font-family: var(--font-serif)`. A gate that reads
     * class strings CANNOT see one class implying another, so a container
     * wearing `pmark` silently serifs every sans child inside it — 60-05's
     * finding, re-confirmed by 60-06. This is the one part of that hole a
     * className-reading gate can cover: if a marker class is present at all,
     * the element must either BE evidence or explicitly cancel the serif.
     */
    const SMUGGLING_SURFACES: ReadonlyArray<readonly [string, React.ReactElement]> = [
      ["chip[evidence]", <ProvenanceLink key="a" kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />],
      ["chip[chrome]", <ProvenanceLink key="b" kind="email" id={EMAIL_ID} />],
      [
        "assistant turn + round + chips",
        <MessageTurn
          key="c"
          role="assistant"
          status="completed"
          parts={[
            {
              type: "tool_invocation_result",
              toolUseId: "t1",
              toolName: "search_emails",
              content: JSON.stringify({
                results: [1],
                citations: [{ kind: "email", id: EMAIL_ID, route: "" }],
              }),
              isError: false,
            },
            { type: "text", text: ASSISTANT_PROSE },
          ]}
        />,
      ],
      ["user turn", <MessageTurn key="d" role="user" parts={[{ type: "text", text: USER_PROSE }]} />],
    ];

    for (const [label, element] of SMUGGLING_SURFACES) {
      it(`${label}: nothing wears a serif-implying marker without data-evidence or a sans cancel`, async () => {
        const container = await mount(element);
        for (const el of allElements(container)) {
          const cls = classesOf(el);
          if (!wearsSerifMarker(cls)) continue;
          const excused = el.hasAttribute("data-evidence") || hasClass(el, "font-serif");
          const cancels = hasClass(el, "font-sans");
          expect(
            excused || cancels,
            `This element carries a marker that IMPLIES font-serif, but claims to be neither ` +
              `evidence nor cancelled back to sans. The serif will arrive by INHERITANCE, where ` +
              `no class-reading gate can see it (60-05's finding). Either mark it as evidence, ` +
              `or add font-sans to cancel and re-apply font-serif on the evidence span only.\n` +
              `    ${describeEl(el)}`,
          ).toBe(true);
        }
      });
    }

    it("the chip's CONTAINER states font-sans rather than inheriting it (D-61-04-B)", async () => {
      // ProvenanceLink is a SHARED primitive: a consumer may one day render it
      // inside a pmark'd context, and then the chrome branch would silently
      // inherit serif. Stating the cancel makes chrome sans by declaration.
      const container = await mount(<ProvenanceLink kind="email" id={EMAIL_ID} label={REAL_SUBJECT} />);
      const anchor = container.querySelector<HTMLElement>("a");
      expect(hasClass(anchor!, "font-sans")).toBe(true);
      // ...and the chip does not reach for the tier mark: it makes no tier claim.
      expect(wearsSerifMarker(classesOf(anchor!))).toBe(false);
      // The named chip SPACING step is not the tier mark and must not be
      // confused for it — this is the substring trap, pinned.
      expect(hasClass(anchor!, "px-chip-x")).toBe(true);
    });
  });

  // ── LEG 7 ────────────────────────────────────────────────────────────────
  describe("LEG 7 — the part switch survives a restyle", () => {
    /**
     * 61-04 rewrote this component's root. The emission order and the
     * full-content REPLACEMENTS are behaviour, not style, and a restyle is
     * exactly when they get quietly dropped. 61-07 edits this file next.
     */
    it("tool_invocation renders NOTHING — the paired result row narrates the round (DO-NOT 7)", async () => {
      const container = await mount(
        <MessageTurn
          role="assistant"
          status="completed"
          parts={[
            { type: "tool_invocation", toolUseId: "t1", toolName: "search_emails", arguments: {} },
          ]}
        />,
      );
      expect(container.textContent).toBe("");
    });

    it("a failed turn's content is FULLY replaced by the retry card (D-19)", async () => {
      const container = await mount(
        <MessageTurn
          role="assistant"
          status="failed"
          parts={[{ type: "text", text: ASSISTANT_PROSE }]}
          onRegenerate={() => undefined}
        />,
      );
      expect(container.textContent).not.toContain("Acme Freight came back");
    });

    it("a cost-capped-pre-turn's content is FULLY replaced by its own card (D-21)", async () => {
      const container = await mount(
        <MessageTurn
          role="assistant"
          status="cost_capped_pre_turn"
          parts={[{ type: "text", text: ASSISTANT_PROSE }]}
        />,
      );
      expect(container.textContent).not.toContain("Acme Freight came back");
    });

    it("the user's bubble is the only bordered/filled thing in the stream — the assistant has no rail", async () => {
      const user = await mount(
        <MessageTurn role="user" parts={[{ type: "text", text: USER_PROSE }]} />,
      );
      const assistant = await mount(
        <MessageTurn
          role="assistant"
          status="completed"
          parts={[{ type: "text", text: ASSISTANT_PROSE }]}
        />,
      );
      const userRoot = user.firstElementChild as HTMLElement;
      const assistantRoot = assistant.firstElementChild as HTMLElement;

      expect(classesOf(userRoot), "the user's turn is the sketch's .uturn: a --shade bubble").toMatch(
        /bg-shade/,
      );
      expect(
        classesOf(assistantRoot),
        `the sketch's .aturn has NO rail, no card and no border — the answer IS the surface. ` +
          `v1.4's "assistant role rail" (border-l-2) is what this replaced.`,
      ).not.toMatch(/border-l|bg-/);
    });
  });
});
