import type { Task } from "graphile-worker";
import { afterEach, describe, expect, it, vi } from "vitest";

import { callPython, fanOutMorningBoards, morningJobKey, taskList, todayUtc } from "../tasks";

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

/** Invoke a taskList handler with a no-op helpers stub (handlers under test ignore helpers). */
function invokeTask(task: Task, payload: unknown): Promise<void> {
  return (task as (p: unknown, h: unknown) => Promise<void>)(payload, {} as never);
}

describe("assemble_morning_board handler (MORN-03 worker side)", () => {
  it("POSTs the { user_id } payload to /v1/home/assemble-job with the api-key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    process.env.API_KEY = "secret-key";
    process.env.LISTENER_INTERNAL_URL = "http://localhost:8000";

    await invokeTask(taskList.assemble_morning_board as Task, { user_id: "user-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://localhost:8000/v1/home/assemble-job");
    expect(opts.method).toBe("POST");
    expect(opts.headers["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(opts.body as string)).toEqual({ user_id: "user-1" });
  });

  it("throws on a non-2xx response (no swallow) so graphile-worker retries → dead-letters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => "assembly boom" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(invokeTask(taskList.assemble_morning_board as Task, { user_id: "u" })).rejects.toThrow(/502/);
  });
});

describe("fanOutMorningBoards (MORN-02)", () => {
  it("enqueues exactly one assemble_morning_board job per user with morning:<uid>:<day> keys", async () => {
    const calls: Array<{ identifier: string; payload: unknown; jobKey: string }> = [];
    const enqueue = async (identifier: string, payload: unknown, jobKey: string): Promise<void> => {
      calls.push({ identifier, payload, jobKey });
    };
    const now = new Date("2026-07-26T05:00:00.000Z");

    const n = await fanOutMorningBoards(["a", "b", "c"], enqueue, now);

    expect(n).toBe(3);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.identifier === "assemble_morning_board")).toBe(true);
    expect(calls.map((c) => c.jobKey)).toEqual([
      "morning:a:2026-07-26",
      "morning:b:2026-07-26",
      "morning:c:2026-07-26",
    ]);
    expect(calls[0].payload).toEqual({ user_id: "a" });
  });

  it("N users → N jobs; empty user set → zero enqueues", async () => {
    const calls: unknown[] = [];
    const enqueue = async (): Promise<void> => {
      calls.push(1);
    };
    expect(await fanOutMorningBoards([], enqueue)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent per day: same-day re-run yields identical keys; next day differs", () => {
    const lateNight = new Date("2026-07-26T23:59:00.000Z");
    const nextMorning = new Date("2026-07-27T00:01:00.000Z");

    // Same day → identical key (graphile job_key REPLACES the pending job, never duplicates).
    expect(morningJobKey("a", todayUtc(lateNight))).toBe("morning:a:2026-07-26");
    expect(morningJobKey("a", todayUtc(lateNight))).toBe(morningJobKey("a", todayUtc(lateNight)));
    // Next UTC day → distinct key (a fresh board is enqueued).
    expect(morningJobKey("a", todayUtc(nextMorning))).toBe("morning:a:2026-07-27");
  });
});
