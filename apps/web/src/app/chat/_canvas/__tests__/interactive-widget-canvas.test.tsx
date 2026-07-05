/**
 * interactive-widget-canvas.test.tsx — dual-surface parity proof (Task 4,
 * 24-03, D-08): the SAME interactive_widget message part renders in BOTH the
 * transcript (MessageTurn) and the canvas (the GenuiPanelNodeBody seam),
 * driven by ONE controller-derived widget surface — a click in the canvas
 * fires the SAME onSubmitOption with the SAME interactionId, and flipping the
 * shared state map to "submitted" flips BOTH surfaces to the Selected
 * treatment.
 *
 * Mirrors panel-data-flow.test.tsx's zero-mock createRoot-in-jsdom harness:
 * GenuiPanelNodeBody is module-private and needs React Flow context, so this
 * reproduces its interactive_widget branch (useCanvasPart +
 * useOptionalChatController + InteractiveWidgetBoundary variant="bare") over
 * the real CanvasSpecProvider/ChatControllerProvider seams.
 */

import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageTurn, type MessageTurnWidgets } from "../../_components/message-turn";
import {
  InteractiveWidgetBoundary,
  type InteractiveWidgetPart,
} from "../../_components/interactive-widget-boundary";
import type { MessagePart } from "../../_hooks/use-chat-stream";
import type { ConversationController } from "../../_hooks/use-conversation-controller";
import { CanvasSpecProvider, useCanvasPart } from "../canvas-spec-context";
import { ChatControllerProvider } from "../chat-node";
import { useOptionalChatController } from "../chat-node";
import {
  genuiPanelNodeId,
  reconcileNodesFromHistory,
} from "../use-canvas-persistence";
import type { ChatHistoryRow } from "../../_hooks/use-conversation-controller";
import type { Provenance } from "../node-data-schemas";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_ID = "00000000-0000-0000-0000-0000000000a1";
const INTERACTION_ID = "11111111-1111-1111-1111-111111111111";

const WIDGET_PART: MessagePart = {
  type: "interactive_widget",
  interactionId: INTERACTION_ID,
  widgetKind: "proposal_cards",
  declaration: {
    prompt: "Which plan?",
    options: [
      { id: "opt-0", title: "Ship next week" },
      { id: "opt-1", title: "Ship next month" },
    ],
  },
};

const PROVENANCE: Provenance = { messageId: MESSAGE_ID, partIndex: 0, runId: null };
const PARTS_MAP = new Map<string, MessagePart>([
  [`${MESSAGE_ID}:0`, WIDGET_PART],
]);

/** Reproduces GenuiPanelNodeBody's interactive_widget branch exactly. */
function CanvasWidgetHarness({ provenance }: { readonly provenance: Provenance }): React.ReactElement | null {
  const part = useCanvasPart(provenance);
  const controller = useOptionalChatController();
  if (part?.type !== "interactive_widget") return null;
  const ip = part as unknown as InteractiveWidgetPart;
  return (
    <InteractiveWidgetBoundary
      part={ip}
      displayState={controller?.widgets.states[ip.interactionId] ?? "pending"}
      submittedValue={controller?.widgets.submittedValues[ip.interactionId]}
      errorMessage={controller?.widgets.errorMessages[ip.interactionId] ?? null}
      onSubmitOption={(optionId) => controller?.widgets.onSubmitOption(ip.interactionId, optionId)}
      variant="bare"
    />
  );
}

function controllerWith(widgets: MessageTurnWidgets): ConversationController {
  return { widgets } as unknown as ConversationController;
}

function DualSurface({ widgets }: { readonly widgets: MessageTurnWidgets }): React.ReactElement {
  return (
    <>
      <div data-testid="transcript">
        <MessageTurn role="assistant" parts={[WIDGET_PART]} widgets={widgets} />
      </div>
      <div data-testid="canvas">
        <CanvasSpecProvider specsByProvenance={new Map()} partsByProvenance={PARTS_MAP}>
          <ChatControllerProvider controller={controllerWith(widgets)}>
            <CanvasWidgetHarness provenance={PROVENANCE} />
          </ChatControllerProvider>
        </CanvasSpecProvider>
      </div>
    </>
  );
}

let container: HTMLDivElement;
let root: { render: (el: React.ReactElement) => void; unmount: () => void };

describe("interactive_widget dual-surface parity (D-08)", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("one click handler + one state source drive BOTH transcript and canvas", async () => {
    const onSubmitOption = vi.fn();
    const widgets: MessageTurnWidgets = {
      states: {},
      submittedValues: {},
      errorMessages: {},
      onSubmitOption,
    };

    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
    await act(async () => {
      root.render(<DualSurface widgets={widgets} />);
    });

    const canvas = container.querySelector('[data-testid="canvas"]')!;
    const canvasButton = canvas.querySelector(
      '[aria-label="Choose this option — Ship next week"]',
    ) as HTMLButtonElement | null;
    expect(canvasButton).not.toBeNull();

    await act(async () => {
      canvasButton!.click();
    });

    // ONE handler — the canvas click fires the SAME onSubmitOption with the
    // SAME interactionId + optionId the transcript would.
    expect(onSubmitOption).toHaveBeenCalledTimes(1);
    expect(onSubmitOption).toHaveBeenCalledWith(INTERACTION_ID, "opt-0");
  });

  it("flipping the shared state map to 'submitted' flips BOTH surfaces to Selected", async () => {
    const onSubmitOption = vi.fn();
    const pendingWidgets: MessageTurnWidgets = {
      states: {},
      submittedValues: {},
      errorMessages: {},
      onSubmitOption,
    };

    const { createRoot } = await import("react-dom/client");
    root = createRoot(container);
    await act(async () => {
      root.render(<DualSurface widgets={pendingWidgets} />);
    });

    // Pending: neither surface shows "Selected".
    expect(container.querySelector('[data-testid="transcript"]')?.textContent).not.toContain("Selected");
    expect(container.querySelector('[data-testid="canvas"]')?.textContent).not.toContain("Selected");

    const submittedWidgets: MessageTurnWidgets = {
      states: { [INTERACTION_ID]: "submitted" },
      submittedValues: { [INTERACTION_ID]: { optionId: "opt-0" } },
      errorMessages: {},
      onSubmitOption,
    };
    await act(async () => {
      root.render(<DualSurface widgets={submittedWidgets} />);
    });

    // Both surfaces now show the Selected treatment (one state source).
    expect(container.querySelector('[data-testid="transcript"]')?.textContent).toContain("Selected");
    expect(container.querySelector('[data-testid="canvas"]')?.textContent).toContain("Selected");
  });
});

describe("canvas materialization (buildExpectedGenuiPanelSpecs via reconcileNodesFromHistory)", () => {
  it("materializes an interactive_widget part as a genui-panel node and NOT an interaction_result part", () => {
    const rows: ChatHistoryRow[] = [
      {
        id: MESSAGE_ID,
        role: "assistant",
        status: "completed",
        turnIndex: 1,
        siblingGroupId: null,
        version: 1,
        isActive: true,
        parts: [
          WIDGET_PART,
          {
            type: "interaction_result",
            interactionId: INTERACTION_ID,
            widgetKind: "proposal_cards",
            summary: { chosenTitle: "Ship next week" },
          },
        ],
      },
    ];

    const nodes = reconcileNodesFromHistory([], rows);

    // interactive_widget at partIndex 0 -> genui-panel:{messageId}:0
    expect(nodes.some((n) => n.id === genuiPanelNodeId(MESSAGE_ID, 0))).toBe(true);
    // interaction_result at partIndex 1 -> NO panel node
    expect(nodes.some((n) => n.id === genuiPanelNodeId(MESSAGE_ID, 1))).toBe(false);
  });
});
