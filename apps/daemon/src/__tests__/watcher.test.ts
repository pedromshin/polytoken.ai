import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { startWatcher, toRelativeForwardSlash } from "../watch/watcher.js";
import { canonicalizePath, type CanonicalPath } from "../permissions/paths.js";
import type { ClientRegistry } from "../server/clients.js";
import type { MsgType } from "@polytoken/daemon-protocol";

/**
 * Real chokidar, real files. A watcher proven against a mocked fs proves only that the mock was
 * called — the Windows partial-write behaviour that `awaitWriteFinish` exists to absorb is
 * invisible to a mock.
 */

let tmp: string;
let root: CanonicalPath;
let broadcasts: Array<{ type: MsgType; payload: unknown }>;
let registry: ClientRegistry;
const watchers: Array<{ close(): Promise<void> }> = [];

const canon = (p: string): CanonicalPath => {
  const r = canonicalizePath(p);
  if (!r.ok) throw new Error(r.reason);
  return r.path;
};

/** Poll until a matching broadcast arrives, or fail loudly. Real fs events need real waiting. */
const waitForEvent = async (
  match: (payload: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = broadcasts
      .filter((b) => b.type === "fs.watch.event")
      .map((b) => b.payload as Record<string, unknown>)
      .find(match);
    if (found !== undefined) return found;
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for a matching fs.watch.event; saw: ${JSON.stringify(broadcasts)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 40));
  }
};

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "daemon-watch-")));
  root = canon(tmp);
  broadcasts = [];
  registry = {
    add: () => {},
    remove: () => {},
    broadcast: (type: MsgType, payload: unknown) => broadcasts.push({ type, payload }),
    size: 1,
    list: () => [],
  };
});

afterEach(async () => {
  for (const watcher of watchers.splice(0)) await watcher.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const start = () => {
  const watcher = startWatcher({ root, registry });
  watchers.push(watcher);
  return watcher;
};

describe("toRelativeForwardSlash (R-08)", () => {
  it("makes the path root-relative with forward slashes", () => {
    expect(toRelativeForwardSlash("C:\\r", "C:\\r\\a\\b.txt")).toBe("a/b.txt");
  });

  it("returns '' for the root itself", () => {
    expect(toRelativeForwardSlash("C:\\r", "C:\\r")).toBe("");
  });

  it("never emits a backslash", () => {
    expect(toRelativeForwardSlash("C:\\r", "C:\\r\\deep\\nested\\f.txt")).not.toContain("\\");
  });
});

describe("startWatcher (DMON-04) — real file events reach clients", () => {
  it("a new file broadcasts kind 'add' with a root-relative forward-slash path", async () => {
    start();
    await new Promise((r) => setTimeout(r, 300)); // let chokidar settle before touching the fs

    fs.writeFileSync(path.join(tmp, "hello.txt"), "hi");

    const event = await waitForEvent((p) => p.path === "hello.txt" && p.kind === "add");
    expect(event.root).toBe(root);
    expect(event.kind).toBe("add");
    expect(event.path).toBe("hello.txt");
  });

  it("a nested file emits a forward-slash relative path (never a Windows backslash)", async () => {
    start();
    await new Promise((r) => setTimeout(r, 300));

    fs.mkdirSync(path.join(tmp, "nested", "deep"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "nested", "deep", "x.txt"), "x");

    const event = await waitForEvent((p) => String(p.path).endsWith("x.txt"));
    expect(event.path).toBe("nested/deep/x.txt");
    expect(String(event.path)).not.toContain("\\");
  });

  it("modifying a file broadcasts 'change'", async () => {
    const file = path.join(tmp, "mut.txt");
    fs.writeFileSync(file, "one");
    start();
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(file, "two");
    const event = await waitForEvent((p) => p.path === "mut.txt" && p.kind === "change");
    expect(event.kind).toBe("change");
  });

  it("deleting a file broadcasts 'unlink'", async () => {
    const file = path.join(tmp, "gone.txt");
    fs.writeFileSync(file, "bye");
    start();
    await new Promise((r) => setTimeout(r, 300));

    fs.rmSync(file);
    const event = await waitForEvent((p) => p.path === "gone.txt" && p.kind === "unlink");
    expect(event.kind).toBe("unlink");
  });

  it("a new directory broadcasts 'addDir'", async () => {
    start();
    await new Promise((r) => setTimeout(r, 300));

    fs.mkdirSync(path.join(tmp, "newdir"));
    const event = await waitForEvent((p) => p.path === "newdir" && p.kind === "addDir");
    expect(event.kind).toBe("addDir");
  });

  it("every broadcast payload satisfies fsWatchEventSchema (validated in clients.send)", async () => {
    start();
    await new Promise((r) => setTimeout(r, 300));
    fs.writeFileSync(path.join(tmp, "valid.txt"), "v");
    await waitForEvent((p) => p.path === "valid.txt");

    const { fsWatchEventSchema } = await import("@polytoken/daemon-protocol");
    for (const broadcast of broadcasts) {
      expect(fsWatchEventSchema.safeParse(broadcast.payload).success).toBe(true);
    }
  });

  it("ignoreInitial: pre-existing files do NOT flood clients on startup", async () => {
    fs.writeFileSync(path.join(tmp, "old1.txt"), "1");
    fs.writeFileSync(path.join(tmp, "old2.txt"), "2");

    start();
    await new Promise((r) => setTimeout(r, 500));

    expect(broadcasts).toHaveLength(0);
  });

  it("close() stops the broadcasts (no events after shutdown)", async () => {
    const watcher = start();
    await new Promise((r) => setTimeout(r, 300));
    await watcher.close();
    watchers.length = 0;

    broadcasts = [];
    fs.writeFileSync(path.join(tmp, "after-close.txt"), "x");
    await new Promise((r) => setTimeout(r, 400));

    expect(broadcasts).toHaveLength(0);
  });

  it("a throwing broadcast reaches onError and does NOT crash the watcher (T-65-17)", async () => {
    const onError = vi.fn();
    const throwing: ClientRegistry = {
      ...registry,
      broadcast: () => {
        throw new Error("client exploded");
      },
    };
    const watcher = startWatcher({ root, onError, registry: throwing });
    watchers.push(watcher);
    await new Promise((r) => setTimeout(r, 300));

    fs.writeFileSync(path.join(tmp, "boom.txt"), "x");
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 5_000 });
  });
});
