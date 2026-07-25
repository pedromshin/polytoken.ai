/**
 * canvas-publish.ts — the source-node PUBLISH PORT (Phase 73 Wave B / LCAN-03).
 *
 * The recompute engine (`usePanelData` overlay + `resolveCanvasPath`) is already
 * reactive; the missing half was a PRODUCER. Today only genui panels write into
 * the canvas store — the tRPC-backed source nodes (entity / usage / brief /
 * spreadsheet / …) fetch their data but never publish a `sourcePath`-addressable
 * value, so an agent-wired edge FROM one of them resolves to `undefined`.
 *
 * A source node publishes a BOUNDED projection of its fetched data to
 * `shared.published.{nodeId}` through the store's existing `mutate("set", …)`
 * enum. An edge whose (rewritten) sourcePath is
 * `shared.published.{nodeId}.{field}` then resolves to it through the UNCHANGED
 * resolution engine — no new reactivity.
 *
 * The projection is bounded on purpose: `sharedState` is a size-capped blob
 * persisted whole (`canvas-mutations.ts` PRECONDITION_FAILED on overflow), so a
 * node that dumped its full dataset would blow the cap and get the entire save
 * refused. `projectForPublish` caps depth, breadth, string length, and total
 * serialized size, and drops every non-JSON value — a SUMMARY, never the raw
 * dataset. Every key also crosses the same FORBIDDEN_KEYS guard the store's
 * `mutate` re-applies, so a poisoned key never reaches the store.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** The `values`-root namespace every source node publishes under. A physical
 * store path is `shared.published.{nodeId}.{field}` (dotted, walked by
 * `resolveCanvasPath`). Node ids contain a `:` (`agent:sheet`,
 * `spreadsheet:rent`) — that lives WITHIN a single dotted segment, so the id is
 * one path key, never split. */
export const PUBLISH_NAMESPACE = "shared.published";

/** The store path a node's whole published projection object lives at. */
export function publishedNodePath(nodeId: string): string {
  return `${PUBLISH_NAMESPACE}.${nodeId}`;
}

// Bounds — deliberately conservative. A published value is a glanceable summary
// (a total, a count, a short label, a handful of rows), never a full fetch.
const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 30;
const MAX_STRING_LEN = 2_000;
const MAX_SERIALIZED_BYTES = 8_192;

/**
 * projectForPublish — clamps an arbitrary fetched value into a bounded,
 * JSON-only projection safe to write to `sharedState`. Pure; never mutates its
 * input. Returns `undefined` when the value cannot be represented (a function,
 * a symbol, a non-finite number at the root) so the caller can skip the publish
 * rather than write junk. A projection that still exceeds
 * `MAX_SERIALIZED_BYTES` after clamping is rejected wholesale (returns
 * `undefined`) — better no publish than a save-refusing oversize blob.
 */
export function projectForPublish(value: unknown): unknown {
  const clamped = clamp(value, 0);
  if (clamped === undefined) return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(clamped);
  } catch {
    return undefined; // circular / unserializable after clamp — skip
  }
  if (serialized === undefined) return undefined;
  // byte length via the platform TextEncoder when present, else UTF-16 length
  const size =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(serialized).length
      : serialized.length;
  if (size > MAX_SERIALIZED_BYTES) return undefined;
  return clamped;
}

function clamp(value: unknown, depth: number): unknown {
  if (value === null) return null;

  const t = typeof value;
  if (t === "string") {
    return (value as string).slice(0, MAX_STRING_LEN);
  }
  if (t === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (t === "boolean") {
    return value;
  }
  if (t === "bigint") {
    // representable as a Number for a glanceable summary; drop if it would lose
    // magnitude wildly (still bounded by the serialized-size gate)
    return Number(value as bigint);
  }
  if (t === "function" || t === "symbol" || t === "undefined") {
    return undefined;
  }

  if (depth >= MAX_DEPTH) return undefined; // too deep — prune this branch

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value.slice(0, MAX_ARRAY_ITEMS)) {
      const c = clamp(item, depth + 1);
      if (c !== undefined) out.push(c);
    }
    return out;
  }

  if (t === "object") {
    // Date → ISO string (a common fetched field); other exotic objects fall
    // through to plain-key enumeration.
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (kept >= MAX_OBJECT_KEYS) break;
      if (FORBIDDEN_KEYS.has(key)) continue;
      const c = clamp(v, depth + 1);
      if (c === undefined) continue;
      out[key] = c;
      kept += 1;
    }
    return out;
  }

  return undefined;
}
