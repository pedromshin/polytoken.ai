/**
 * pipeline-health-panel.test.tsx — behavioral tests for the inbox rail's
 * Pipeline health panel: ready render (counts + per-stage failures), honest
 * error state with a working Retry, and the empty state.
 *
 * Mounts the REAL component with a mocked global.fetch — this repo's
 * createRoot-in-jsdom + `act` convention (empty-state.test.tsx et al.).
 * jsdom proves behavior only, nothing visual.
 */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PipelineHealthPanel } from "../pipeline-health-panel";

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
});
