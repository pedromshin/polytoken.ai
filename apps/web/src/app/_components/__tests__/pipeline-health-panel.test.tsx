/**
 * pipeline-health-panel.test.tsx — behavioral tests for the inbox rail's
 * Pipeline health panel: ready render (counts + per-stage failures), honest
 * error state with a working Retry, and the empty state — plus the WEDG-03
 * LearningSummarySection (owner-scoped `learning.summary` metrics) that now
 * lives on this surface: the honest all-zeros pre-flip state, the non-zero
 * readout, the null-rate em-dashes, and the error + Retry path.
 *
 * Mounts the REAL components with a mocked global.fetch and a mocked
 * `~/trpc/react` (the learning query) — this repo's createRoot-in-jsdom +
 * `act` convention (empty-state.test.tsx et al.). jsdom proves behavior
 * only, nothing visual.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LearningSummaryLike } from "~/lib/pipeline-health";

const ZERO_LEARNING: LearningSummaryLike = {
  correctionsMade: 0,
  typeCorrections: 0,
  mergeCascades: 0,
  emailsRelabeled: 0,
  relabelsPerCorrection: null,
  stickRate: null,
};

interface LearningQueryState {
  data?: LearningSummaryLike;
  /** React Query v5 three-state status — the component's source of truth
   * (all three branches switch on it exclusively; isLoading is dead). */
  status: "pending" | "error" | "success";
  isError: boolean;
}

let learningState: LearningQueryState = {
  data: ZERO_LEARNING,
  status: "success",
  isError: false,
};
const learningRefetch = vi.fn();

vi.mock("~/trpc/react", () => ({
  api: {
    learning: {
      summary: {
        useQuery: () => ({ ...learningState, refetch: learningRefetch }),
      },
    },
  },
}));

import {
  LearningSummarySection,
  PipelineHealthPanel,
} from "../pipeline-health-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const originalFetch = global.fetch;

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

beforeEach(() => {
  learningState = {
    data: ZERO_LEARNING,
    status: "success",
    isError: false,
  };
  learningRefetch.mockClear();
});

afterEach(async () => {
  for (const root of roots) {
    await act(async () => {
      root.unmount();
    });
  }
  roots = [];
  for (const c of containers) {
    document.body.removeChild(c);
  }
  containers = [];
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

const HEALTH_PAYLOAD = {
  importers: [
    {
      importer_id: "11111111-2222-3333-4444-555555555555",
      label: "acme.com",
      received: 12,
      fully_analyzed: 9,
      failed_by_stage: { ocr: 2, extraction: 1 },
    },
  ],
};

function okResponse(body: unknown): Partial<Response> {
  return { ok: true, json: async () => body };
}

describe("PipelineHealthPanel", () => {
  it("renders per-importer counts and per-stage failures from the proxy payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(HEALTH_PAYLOAD));
    global.fetch = fetchMock as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pipeline/health",
      expect.objectContaining({ method: "GET" }),
    );
    expect(container.textContent).toContain("Pipeline health");
    expect(container.textContent).toContain("acme.com");
    expect(container.textContent).toContain("12 received");
    expect(container.textContent).toContain("9 analyzed");
    expect(container.textContent).toContain("3 failed");
    expect(container.textContent).toContain("ocr × 2");
    expect(container.textContent).toContain("extraction × 1");
  });

  it("omits the failure frame entirely when nothing failed", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      okResponse({
        importers: [
          {
            importer_id: "a-importer-id",
            label: "clean.com",
            received: 4,
            fully_analyzed: 4,
            failed_by_stage: {},
          },
        ],
      }),
    ) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(container.textContent).toContain("4 received");
    expect(container.textContent).not.toContain("failed");
  });

  it("shows the honest empty state for an importer-less account", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okResponse({ importers: [] })) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(container.textContent).toContain("No pipeline activity yet");
  });

  it("shows a framed error with Retry on a non-ok response (endpoint absent)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "Pipeline health request failed" }),
    }) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Pipeline status unavailable.");
    expect(alert!.querySelector("button")).not.toBeNull();
  });

  it("shows the error state (not NaN counts) when the payload drifts from the contract", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okResponse({ totally: "different" })) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain("NaN");
  });

  it("Retry refetches and recovers to the ready state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce(okResponse(HEALTH_PAYLOAD));
    global.fetch = fetchMock as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    const retry = container.querySelector<HTMLButtonElement>(
      '[role="alert"] button',
    );
    await act(async () => {
      retry!.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain("acme.com");
  });

  it("network failure (fetch rejects) lands in the error state, never an infinite skeleton", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("carries the WEDG-03 learning-loop section on this existing surface", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okResponse(HEALTH_PAYLOAD)) as unknown as typeof fetch;

    const container = await mount(<PipelineHealthPanel />);

    expect(container.textContent).toContain("Learning loop");
  });
});

describe("LearningSummarySection (WEDG-03)", () => {
  it("renders the honest all-zeros state (pre-WEDG-01: flags not flipped yet)", async () => {
    const container = await mount(<LearningSummarySection />);

    expect(container.textContent).toContain("Learning loop");
    expect(container.textContent).toContain("No corrections yet");
    // Never fake meters in the zero state — no "0%" stick, no NaN.
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toContain("NaN");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders the non-zero readout with tabular metrics", async () => {
    learningState = {
      data: {
        correctionsMade: 12,
        typeCorrections: 9,
        mergeCascades: 3,
        emailsRelabeled: 30,
        relabelsPerCorrection: 10,
        stickRate: 0.86,
      },
      status: "success",
      isError: false,
    };

    const container = await mount(<LearningSummarySection />);

    expect(container.textContent).toContain("12 corrections");
    expect(container.textContent).toContain("30 emails");
    expect(container.textContent).toContain("re-labeled");
    expect(container.textContent).toContain("10 re-labels per merge");
    expect(container.textContent).toContain("86% stick");
  });

  it("renders an em-dash (not a fake 0) for a null leverage when only type corrections exist", async () => {
    learningState = {
      data: {
        correctionsMade: 2,
        typeCorrections: 2,
        mergeCascades: 0,
        emailsRelabeled: 0,
        relabelsPerCorrection: null,
        stickRate: 1,
      },
      status: "success",
      isError: false,
    };

    const container = await mount(<LearningSummarySection />);

    expect(container.textContent).toContain("2 corrections");
    expect(container.textContent).toContain("— re-labels per merge");
    expect(container.textContent).toContain("100% stick");
  });

  it("shows a framed error with a Retry that refetches when the query fails", async () => {
    learningState = {
      data: undefined,
      status: "error",
      isError: true,
    };

    const container = await mount(<LearningSummarySection />);

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("Learning metrics unavailable.");

    const retry = alert!.querySelector("button");
    expect(retry).not.toBeNull();
    await act(async () => {
      retry!.click();
    });
    expect(learningRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton (no alert, no numbers) while loading", async () => {
    learningState = {
      data: undefined,
      status: "pending",
      isError: false,
    };

    const container = await mount(<LearningSummarySection />);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("corrections");
  });

  it("paused-pending (offline, RQ v5: status 'pending', no data) shows a skeleton, never the error alert", async () => {
    // React Query v5: a query paused before its first fetch (fetchStatus
    // "paused", e.g. offline) reports status "pending" with isError false.
    // That is "no data yet", not a failure — skeleton, no alert.
    learningState = {
      data: undefined,
      status: "pending",
      isError: false,
    };

    const container = await mount(<LearningSummarySection />);

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain("Learning metrics unavailable.");
    expect(container.textContent).not.toContain("corrections");
  });
});
