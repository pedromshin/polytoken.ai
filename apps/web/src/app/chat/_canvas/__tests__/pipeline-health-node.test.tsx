/**
 * pipeline-health-node.test.tsx — the canvas `pipeline-health` node now also
 * carries the WEDG-03 learning-loop section (the SAME LearningSummarySection
 * the inbox panel renders — one component, one data path). jsdom proves the
 * rendered contract only: the per-importer pipeline rows still render, the
 * learning section is present, and the all-zeros pre-flip state reads as the
 * honest "no corrections yet" line — never fake meters.
 *
 * Harness mirrors desktop-node.test.tsx: createRoot-in-jsdom + `act`,
 * `useReactFlow` mocked via a PARTIAL factory, `~/trpc/react` mocked for the
 * learning query, global.fetch mocked for the pipeline proxy. The node mounts
 * with no CanvasStoreProvider on purpose — useCanvasPublish no-ops off-canvas.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

const mockDeleteElements = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ deleteElements: mockDeleteElements }),
  };
});

interface LearningQueryState {
  data?: {
    correctionsMade: number;
    typeCorrections: number;
    mergeCascades: number;
    emailsRelabeled: number;
    relabelsPerCorrection: number | null;
    stickRate: number | null;
  };
  isLoading: boolean;
  isError: boolean;
}

let learningState: LearningQueryState = {
  data: {
    correctionsMade: 0,
    typeCorrections: 0,
    mergeCascades: 0,
    emailsRelabeled: 0,
    relabelsPerCorrection: null,
    stickRate: null,
  },
  isLoading: false,
  isError: false,
};

vi.mock("~/trpc/react", () => ({
  api: {
    learning: {
      summary: {
        useQuery: () => ({ ...learningState, refetch: vi.fn() }),
      },
    },
  },
}));

import { PipelineHealthNode, type PipelineHealthNodeType } from "../pipeline-health-node";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const originalFetch = global.fetch;

const HEALTH_PAYLOAD = {
  importers: [
    {
      importer_id: "11111111-2222-3333-4444-555555555555",
      label: "acme.com",
      received: 12,
      fully_analyzed: 9,
      failed_by_stage: { ocr: 2 },
    },
  ],
};

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

function baseNodeProps(id: string, type: string): Record<string, unknown> {
  return {
    id,
    type,
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

async function mountNode(
  data: Record<string, unknown> = {},
): Promise<HTMLDivElement> {
  return mount(
    <ReactFlowProvider>
      <PipelineHealthNode
        {...({
          ...baseNodeProps("pipeline-health:1", "pipeline-health"),
          data,
        } as unknown as NodeProps<PipelineHealthNodeType>)}
      />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  mockDeleteElements.mockReset();
  learningState = {
    data: {
      correctionsMade: 0,
      typeCorrections: 0,
      mergeCascades: 0,
      emailsRelabeled: 0,
      relabelsPerCorrection: null,
      stickRate: null,
    },
    isLoading: false,
    isError: false,
  };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => HEALTH_PAYLOAD,
  }) as unknown as typeof fetch;
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  roots = [];
  for (const c of containers) c.remove();
  containers = [];
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("PipelineHealthNode — rendered contract with the learning section", () => {
  it("renders the per-importer pipeline rows AND the learning-loop section", async () => {
    const container = await mountNode();

    expect(container.textContent).toContain("acme.com");
    expect(container.textContent).toContain("12 received");
    expect(container.textContent).toContain("9 analyzed");
    expect(container.textContent).toContain("Learning loop");
  });

  it("all-zeros pre-flip state renders the honest quiet line, never fake meters", async () => {
    const container = await mountNode();

    expect(container.textContent).toContain("No corrections yet");
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).not.toContain("% stick");
  });

  it("a live summary renders the tabular metric lines on the card", async () => {
    learningState = {
      data: {
        correctionsMade: 4,
        typeCorrections: 3,
        mergeCascades: 1,
        emailsRelabeled: 8,
        relabelsPerCorrection: 8,
        stickRate: 0.75,
      },
      isLoading: false,
      isError: false,
    };

    const container = await mountNode();

    expect(container.textContent).toContain("4 corrections");
    expect(container.textContent).toContain("8 emails");
    expect(container.textContent).toContain("8 re-labels per correction");
    expect(container.textContent).toContain("75% stick");
  });
});
