import { afterEach, describe, expect, it, vi } from "vitest";

import { callPython } from "../tasks";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.API_KEY;
  delete process.env.LISTENER_INTERNAL_URL;
});

describe("callPython", () => {
  it("POSTs JSON to the internal route with the api-key header and resolves on 2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_KEY = "secret-key";
    process.env.LISTENER_INTERNAL_URL = "http://localhost:8000";

    await callPython("/v1/emails/ingest-job", { ses_message_id: "m1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:8000/v1/emails/ingest-job");
    expect(opts.method).toBe("POST");
    expect(opts.headers["content-type"]).toBe("application/json");
    expect(opts.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(opts.body as string)).toEqual({ ses_message_id: "m1" });
  });

  it("throws on a non-2xx response so graphile-worker records a failed attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "pipeline boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callPython("/v1/emails/ingest-job", {})).rejects.toThrow(/500/);
  });
});
