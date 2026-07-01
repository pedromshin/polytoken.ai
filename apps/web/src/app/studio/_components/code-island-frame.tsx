"use client";

/**
 * code-island-frame.tsx — the jailed-eval render surface for the Phase-20 code-island SPIKE.
 *
 * Runs arbitrary island code inside an `<iframe sandbox="allow-scripts">` (NO allow-same-origin
 * → opaque/null origin, no host DOM/cookie/storage access) whose srcdoc carries a `<meta>` CSP
 * (`default-src 'none'; connect-src 'none'`). The pure repair-loop state machine
 * (@nauta/genui/sandbox) drives validate → autofix → run → heal ≤N → safe-placeholder; this
 * component only performs the two effectful steps (rendering the frame, awaiting the injected
 * heal()) and authenticates every inbound message (source identity + null origin + nonce).
 *
 * SAFETY-MODEL NOTE (jailed-eval, Phase 20): the HOST performs no eval/Function/
 * dangerouslySetInnerHTML — execution is confined to the sandboxed frame. The AST allowlist
 * (validateIslandCode) rejects dangerous code before it ever reaches the frame.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ISLAND_SANDBOX,
  buildIslandSrcdoc,
  buildSafePlaceholderSrcdoc,
  isTrustedIslandMessage,
  onHealed,
  onRunSuccess,
  onRuntimeError,
  parseIslandMessage,
  startIsland,
  type IslandA11yViolation,
  type IslandPhase,
  type IslandState,
} from "@nauta/genui/sandbox";
import { getAxeSource } from "@nauta/genui/sandbox/axe-source";

export type IslandHealer = (code: string, error: string) => Promise<string | null>;

export interface CodeIslandFrameProps {
  readonly code: string;
  /** Injectable self-heal seam. In the full phase this calls Bedrock; omit → no heal. */
  readonly heal?: IslandHealer;
  readonly maxAttempts?: number;
  readonly runA11y?: boolean;
}

function makeNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `n-${Math.floor(Math.random() * 1e9)}`;
}

const PHASE_LABEL: Record<IslandPhase, string> = {
  running: "Running…",
  healing: "Self-healing…",
  rendered: "Rendered ✓",
  healed: "Rendered after self-heal ✓",
  rejected: "Blocked by allowlist ✗",
  fallback: "Fell back to safe placeholder",
};

const PHASE_TONE: Record<IslandPhase, string> = {
  running: "bg-amber-50 text-amber-800 border-amber-200",
  healing: "bg-amber-50 text-amber-800 border-amber-200",
  rendered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  healed: "bg-emerald-50 text-emerald-800 border-emerald-200",
  rejected: "bg-red-50 text-red-800 border-red-200",
  fallback: "bg-red-50 text-red-800 border-red-200",
};

export function CodeIslandFrame({
  code,
  heal,
  maxAttempts = 2,
  runA11y = true,
}: CodeIslandFrameProps): React.ReactElement {
  const [state, setState] = useState<IslandState>(() => startIsland(code, { maxAttempts }));
  const [a11y, setA11y] = useState<readonly IslandA11yViolation[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const erroredRef = useRef<boolean>(false);

  const axeSource = useMemo(() => (runA11y ? getAxeSource() : undefined), [runA11y]);

  // Fresh nonce per (re)render attempt — invalidates stale messages + forces a clean frame.
  const nonce = useMemo(() => makeNonce(), [state.code, state.attempts, state.phase]);

  // Reset per-render error tracking + a11y when a new attempt begins.
  useEffect(() => {
    erroredRef.current = false;
    setA11y([]);
  }, [nonce]);

  // Authenticate + route inbound frame messages.
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const message = parseIslandMessage(event.data);
      if (message == null) return;
      if (!isTrustedIslandMessage(event, iframeRef.current?.contentWindow, nonce, message)) return;

      if (message.type === "island-runtime-error") {
        erroredRef.current = true;
        setState((s) => onRuntimeError(s, message.message));
        return;
      }
      if (message.type === "island-a11y") {
        setA11y(message.violations);
        return;
      }
      if (message.type === "island-ready" && !erroredRef.current) {
        setState((s) => onRunSuccess(s));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [nonce]);

  // Drive the injected heal step whenever we enter the healing phase.
  useEffect(() => {
    if (state.phase !== "healing") return;
    let cancelled = false;
    const healer: IslandHealer = heal ?? (async () => null);
    void healer(state.code, state.lastError ?? "").then((healed) => {
      if (!cancelled) setState((s) => onHealed(s, healed));
    });
    return () => {
      cancelled = true;
    };
    // attempts in deps so a subsequent healing round re-triggers.
  }, [state.phase, state.attempts, heal, state.code, state.lastError]);

  // Restart the pipeline when the incoming code prop changes.
  useEffect(() => {
    setState(startIsland(code, { maxAttempts }));
  }, [code, maxAttempts]);

  const srcdoc = useMemo(() => {
    if (state.phase === "rejected") {
      const reason = state.violations.map((v) => `${v.rule}: ${v.detail}`).join("; ");
      return buildSafePlaceholderSrcdoc(reason || "Code blocked by the security allowlist.");
    }
    if (state.phase === "fallback") {
      return buildSafePlaceholderSrcdoc(state.lastError ?? "Could not repair the generated code.");
    }
    const hostOrigin = typeof window !== "undefined" ? window.location.origin : undefined;
    return buildIslandSrcdoc({ code: state.code, nonce, axeSource, hostOrigin });
  }, [state.phase, state.code, state.violations, state.lastError, nonce, axeSource]);

  const renderKey = state.phase === "rejected" || state.phase === "fallback" ? "safe" : nonce;

  return (
    <div className="flex flex-col gap-3">
      <StatusBar phase={state.phase} attempts={state.attempts} lastError={state.lastError} />

      <iframe
        key={renderKey}
        ref={iframeRef}
        title="Sandboxed code-island output"
        sandbox={ISLAND_SANDBOX}
        srcDoc={srcdoc}
        className="h-[420px] w-full rounded-lg border border-border/60 bg-white"
      />

      {state.phase === "rejected" && state.violations.length > 0 ? (
        <ViolationList
          heading="Allowlist violations (code never executed)"
          items={state.violations.map((v) => `${v.rule} — ${v.detail}`)}
          tone="red"
        />
      ) : null}

      {a11y.length > 0 ? (
        <ViolationList
          heading={`Accessibility findings (${a11y.length})`}
          items={a11y
            .slice()
            .sort((a, b) => impactRank(b.impact) - impactRank(a.impact))
            .map((v) => `${(v.impact ?? "n/a").toUpperCase()} — ${v.id}: ${v.help}`)}
          tone="amber"
        />
      ) : null}
    </div>
  );
}

function StatusBar({
  phase,
  attempts,
  lastError,
}: {
  readonly phase: IslandPhase;
  readonly attempts: number;
  readonly lastError: string | null;
}): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm ${PHASE_TONE[phase]}`}
    >
      <span className="font-medium">{PHASE_LABEL[phase]}</span>
      {attempts > 0 ? <span className="text-xs opacity-80">heal attempts: {attempts}</span> : null}
      {lastError ? <span className="text-xs opacity-80">· {lastError}</span> : null}
    </div>
  );
}

function ViolationList({
  heading,
  items,
  tone,
}: {
  readonly heading: string;
  readonly items: readonly string[];
  readonly tone: "red" | "amber";
}): React.ReactElement {
  const toneClass =
    tone === "red"
      ? "border-red-200 bg-red-50 text-red-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${toneClass}`}>
      <p className="mb-1 font-semibold">{heading}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function impactRank(impact: string | null | undefined): number {
  switch (impact) {
    case "critical":
      return 4;
    case "serious":
      return 3;
    case "moderate":
      return 2;
    case "minor":
      return 1;
    default:
      return 0;
  }
}
