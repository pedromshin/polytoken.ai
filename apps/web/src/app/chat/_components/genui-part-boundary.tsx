"use client";

/**
 * genui-part-boundary.tsx — progressive partial-tree genui rendering
 * (STREAM-02, D-17, FOUND-6).
 *
 * Wraps the UNMODIFIED @nauta/genui SpecRenderer. Never patches, forks, or
 * re-implements the renderer itself — only decides WHAT pre-validated
 * subtree to hand it, mirroring the existing genui.generate.ts /
 * history-island.tsx web-boundary pattern (SpecRootSchema.safeParse ->
 * SAFE_FALLBACK_SPEC on failure).
 *
 * Progressive rendering strategy (D-17):
 *   1. Lenient partial JSON parse — a streamed emit_ui_spec tool call's
 *      accumulated text is, by construction, always a PREFIX of well-formed
 *      JSON (never arbitrary garbage). attemptRepairJson closes any
 *      currently-open string/object/array at the last point the buffer was
 *      structurally complete, discarding a dangling in-progress token.
 *   2. Cheap happy path — if the repaired buffer already safeParses as a
 *      full valid SpecRoot, render it directly (covers both "streaming
 *      finished emitting slightly before the terminal event arrived" and
 *      the finalized-spec case).
 *   3. Partial-tree walk — otherwise, recursively keep only the CONTIGUOUS
 *      PREFIX of a container's children that individually validate against
 *      SpecNodeSchema (stack/grid/section/card + the header/footer/
 *      itemTemplate/emptyState/then slot fields — the same child-bearing
 *      fields spec-schema.ts's own countNodes/specDepth walkers enumerate).
 *      Anything not yet confidently valid renders as a generic 3-bar
 *      Skeleton placeholder (the UI-SPEC's required minimum).
 *   4. Final gate — once streaming ends, the ONLY path to the renderer is
 *      SpecRootSchema.safeParse; failure renders SAFE_FALLBACK_SPEC via the
 *      existing unchanged path (no new fallback UI, FOUND-6).
 *
 * Security: no eval, no Function, no dangerouslySetInnerHTML anywhere on
 * this path (T-22-34) — only JSON.parse + Zod safeParse + string scanning.
 */

import * as React from "react";

import { Skeleton } from "@nauta/ui/skeleton";
import { SpecRenderer } from "@nauta/genui/renderer";
import {
  SAFE_FALLBACK_SPEC,
  SpecNodeSchema,
  SpecRootSchema,
  type SpecRoot,
} from "@nauta/genui/schema";

export interface GenuiPartBoundaryProps {
  /** The accumulating (or, once !isStreaming, final) emit_ui_spec tool-call
   * JSON text — a genui_spec_streaming part's partialJson, or a finalized
   * genui_spec part's spec re-serialized to text (both are treated as raw
   * JSON text so the same parse/validate path handles either case). */
  readonly specJson: string;
  /** False once the matching tool_result/terminal event has settled the
   * spec — triggers the final safeParse -> SAFE_FALLBACK_SPEC gate. */
  readonly isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Card wrapper — exact classes per 22-UI-SPEC.md "Interleaved typed parts"
// ---------------------------------------------------------------------------

function GenuiCard({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <div className="my-2 rounded-lg border border-border p-4">{children}</div>
  );
}

/** Generic minimum-viable pending-content placeholder (22-UI-SPEC.md D-17):
 * three stacked bars, w-full / w-5/6 / w-2/3. */
function SkeletonBars(): React.ReactElement {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// attemptRepairJson — best-effort completion of a truncated JSON PREFIX
// ---------------------------------------------------------------------------

type ContainerFrame = { kind: "object" | "array"; state: "key" | "value" };

/**
 * Repairs a truncated JSON buffer into syntactically valid JSON text by
 * closing every string/object/array open at the LAST point the buffer was
 * structurally complete (i.e. right after a full value — string, number,
 * literal, or nested container — finished), discarding any dangling
 * in-progress token (an unterminated string, a bare key with no value yet,
 * a trailing comma). Returns null when no safe completion exists (e.g. the
 * buffer never reaches a single complete value).
 *
 * Pure string scanning only — no eval/Function (T-22-34).
 */
export function attemptRepairJson(raw: string): string | null {
  const stack: ContainerFrame[] = [];
  let i = 0;
  let inString = false;
  let escapeNext = false;
  let lastSafeEnd = -1;

  const markValueComplete = (endIndex: number): void => {
    const top = stack[stack.length - 1];
    if (top !== undefined) {
      top.state = "value"; // next token (after a comma) starts a new key/value
    }
    lastSafeEnd = endIndex;
  };

  while (i < raw.length) {
    const ch = raw[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
        const top = stack[stack.length - 1];
        const isKeyString = top !== undefined && top.kind === "object" && top.state === "key";
        if (isKeyString) {
          top!.state = "value"; // key closed — awaiting ':' then a value, NOT a safe point
        } else {
          markValueComplete(i + 1);
        }
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }
    if (ch === "{") {
      stack.push({ kind: "object", state: "key" });
      i++;
      continue;
    }
    if (ch === "[") {
      stack.push({ kind: "array", state: "value" });
      i++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      stack.pop();
      markValueComplete(i + 1);
      i++;
      continue;
    }
    if (ch === ":") {
      i++;
      continue; // a value must still follow — not a safe point
    }
    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top !== undefined) top.state = top.kind === "object" ? "key" : "value";
      i++;
      continue;
    }
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // Literal/number token — scan to its end.
    let j = i;
    while (j < raw.length && !'{}[]:,"'.includes(raw[j]!) && !/\s/.test(raw[j]!)) {
      j++;
    }
    const token = raw.slice(i, j);
    const isCompleteLiteral =
      token === "true" ||
      token === "false" ||
      token === "null" ||
      /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token);
    // Only trust the token as COMPLETE if something else follows it in the
    // buffer — a token flush against the end of the buffer could still be
    // mid-digit (e.g. "12" about to become "123").
    if (isCompleteLiteral && j < raw.length) {
      markValueComplete(j);
    }
    i = j;
  }

  if (lastSafeEnd <= 0) return null;

  const truncated = raw.slice(0, lastSafeEnd);

  // Recompute the open-container stack up to the truncation point so we know
  // exactly what to close, in reverse order.
  const closeStack: Array<"object" | "array"> = [];
  let inStr = false;
  let esc = false;
  for (const c of truncated) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") closeStack.push("object");
    else if (c === "[") closeStack.push("array");
    else if (c === "}" || c === "]") closeStack.pop();
  }

  let closing = "";
  for (let k = closeStack.length - 1; k >= 0; k--) {
    closing += closeStack[k] === "object" ? "}" : "]";
  }

  return truncated + closing;
}

/** JSON.parse the buffer as-is; on failure, fall back to the repaired prefix. */
function tryParsePartial(specJson: string): unknown | undefined {
  try {
    return JSON.parse(specJson);
  } catch {
    const repaired = attemptRepairJson(specJson);
    if (repaired === null) return undefined;
    try {
      return JSON.parse(repaired);
    } catch {
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// buildPartialNode — recursive "render what validates, skeleton what doesn't"
// ---------------------------------------------------------------------------

/** The only fields anywhere in spec-schema.ts that ever hold nested
 * SpecNode(s) — mirrors spec-schema.ts's own countNodes/specDepth walkers so
 * this stays generic across every container node type without hardcoding
 * per-type semantics. `else`, list/tabs/form's specialized nested arrays are
 * intentionally out of scope for the partial walk (bounded effort, D-17's
 * "3-bar generic is the required minimum") — those subtrees simply wait for
 * a full parse. */
const SINGLE_CHILD_FIELDS = ["header", "footer", "itemTemplate", "emptyState", "then"] as const;
const REQUIRES_CHILDREN_TYPES = new Set(["stack", "grid", "section"]);
const OUT_OF_SCOPE_TYPES = new Set(["list", "tabs", "form", "conditional"]);

interface PartialNodeResult {
  /** A schema-valid node safe to render — null if nothing is renderable yet. */
  readonly node: Record<string, unknown> | null;
  /** True if this node (or a descendant) still has more content pending. */
  readonly hasPending: boolean;
}

function buildPartialNode(raw: unknown): PartialNodeResult {
  if (typeof raw !== "object" || raw === null) {
    return { node: null, hasPending: true };
  }

  // Fast path: the whole subtree (recursively, via the union's z.lazy
  // children) already validates — nothing pending underneath it.
  const fullParse = SpecNodeSchema.safeParse(raw);
  if (fullParse.success) {
    return { node: fullParse.data as unknown as Record<string, unknown>, hasPending: false };
  }

  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || OUT_OF_SCOPE_TYPES.has(type)) {
    return { node: null, hasPending: true };
  }

  const patched: Record<string, unknown> = { ...record };
  let hasPending = false;

  if (Array.isArray(record.children)) {
    const rawChildren = record.children as unknown[];
    const validChildren: Record<string, unknown>[] = [];
    for (const child of rawChildren) {
      const result = buildPartialNode(child);
      if (result.node !== null && !result.hasPending) {
        validChildren.push(result.node);
      } else {
        hasPending = true;
        break; // keep only the contiguous valid prefix
      }
    }
    if (validChildren.length < rawChildren.length) hasPending = true;
    patched.children = validChildren;
  } else if (REQUIRES_CHILDREN_TYPES.has(type)) {
    // children is a REQUIRED schema field for this container type but the
    // key hasn't streamed in at all yet — an empty array is schema-valid.
    patched.children = [];
    hasPending = true;
  }

  for (const field of SINGLE_CHILD_FIELDS) {
    if (field in record) {
      const result = buildPartialNode(record[field]);
      if (result.node !== null && !result.hasPending) {
        patched[field] = result.node;
      } else {
        delete patched[field];
        hasPending = true;
      }
    }
  }
  if ("else" in record) {
    // else is optional — safe to simply omit while incomplete.
    delete patched.else;
  }

  const patchedParse = SpecNodeSchema.safeParse(patched);
  if (!patchedParse.success) {
    return { node: null, hasPending: true };
  }
  return {
    node: patchedParse.data as unknown as Record<string, unknown>,
    hasPending,
  };
}

// ---------------------------------------------------------------------------
// GenuiPartBoundary
// ---------------------------------------------------------------------------

export function GenuiPartBoundary({
  specJson,
  isStreaming,
}: GenuiPartBoundaryProps): React.ReactElement {
  const parsed = tryParsePartial(specJson);

  if (!isStreaming) {
    // Finalized — the ONLY gate to the renderer, matching the existing
    // genui.generate.ts / history-island.tsx web-boundary pattern (FOUND-6).
    const finalParse = parsed !== undefined ? SpecRootSchema.safeParse(parsed) : undefined;
    const finalSpec: SpecRoot = finalParse?.success ? finalParse.data : SAFE_FALLBACK_SPEC;
    return (
      <GenuiCard>
        <SpecRenderer spec={finalSpec} />
      </GenuiCard>
    );
  }

  if (parsed !== undefined) {
    const fullParse = SpecRootSchema.safeParse(parsed);
    if (fullParse.success) {
      return (
        <GenuiCard>
          <SpecRenderer spec={fullParse.data} />
        </GenuiCard>
      );
    }

    const rootRaw = (parsed as Record<string, unknown> | null)?.root;
    if (rootRaw !== undefined) {
      const partial = buildPartialNode(rootRaw);
      if (partial.node !== null) {
        const syntheticRoot = { v: 1 as const, root: partial.node };
        const rootParse = SpecRootSchema.safeParse(syntheticRoot);
        if (rootParse.success) {
          return (
            <GenuiCard>
              <SpecRenderer spec={rootParse.data} />
              {partial.hasPending && <SkeletonBars />}
            </GenuiCard>
          );
        }
      }
    }
  }

  // Nothing renderable yet — the whole spec is still pending.
  return (
    <GenuiCard>
      <SkeletonBars />
    </GenuiCard>
  );
}
