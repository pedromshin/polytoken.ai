/**
 * renderer/error-boundary.tsx — Per-node error boundary for the trusted interpreter.
 *
 * NodeErrorBoundary is a React class component using getDerivedStateFromError
 * to catch render errors from a single spec node, preventing one malformed node
 * from crashing the entire rendered surface (SPEC-03, D-14, T-12-11).
 *
 * NodeErrorFallback is the inline fallback UI — does NOT import @nauta/ui/alert
 * to avoid circular dependency on the error path (UI-SPEC §5).
 *
 * Security: no eval, no Function, no dangerouslySetInnerHTML (GR-01).
 */

import * as React from "react";

// ---------------------------------------------------------------------------
// NodeErrorFallback — inline fallback, no @nauta/ui/alert import (UI-SPEC §5)
// ---------------------------------------------------------------------------

export interface NodeErrorFallbackProps {
  readonly nodeType: string;
  readonly reason: string;
}

/**
 * Visual fallback for a failed node render.
 *
 * role="alert" ensures the error is announced to screen readers (a11y).
 * Styling per UI-SPEC §9: bg-destructive/10 border border-destructive/30 text-destructive.
 * Copy per UI-SPEC §9: `[!] "${nodeType}" node — ${reason}`.
 *
 * DOES NOT import from @nauta/ui/alert — circular-dep avoidance on the error path (UI-SPEC §5).
 */
export function NodeErrorFallback({
  nodeType,
  reason,
}: NodeErrorFallbackProps): React.ReactElement {
  return (
    <div
      role="alert"
      className="bg-destructive/10 border border-destructive/30 text-destructive rounded-md px-3 py-2 text-xs"
    >
      {`[!] "${nodeType}" node — ${reason}`}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NodeErrorBoundary — class component with getDerivedStateFromError (D-14)
//
// Hooks cannot replace getDerivedStateFromError — class component is mandatory.
// One instance wraps each registry dispatch in renderNode so one bad node's
// throw is caught here and renders NodeErrorFallback while siblings keep rendering.
// ---------------------------------------------------------------------------

export interface ErrorBoundaryProps {
  readonly children?: React.ReactNode;
  readonly nodeType: string;
}

export interface ErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Per-node React error boundary.
 *
 * Catches synchronous render errors from descendant components. One instance
 * per registry dispatch in renderNode — error isolation is at the node level,
 * not the tree level (SPEC-03, D-14, T-12-11).
 *
 * Usage: <NodeErrorBoundary nodeType={node.type}>{renderedComponent}</NodeErrorBoundary>
 */
export class NodeErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  /**
   * Logs the full error context server-side (or to monitoring sink) so broken
   * spec nodes are never silently swallowed in production (WR-02 / CLAUDE.md:
   * "Log detailed errors server-side; show friendly messages client-side").
   *
   * In production, replace console.error with the application's monitoring
   * integration (e.g. Sentry, Datadog).
   */
  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      "[NodeErrorBoundary] node render failed",
      {
        nodeType: this.props.nodeType,
        error: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      },
    );
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <NodeErrorFallback
          nodeType={this.props.nodeType}
          reason="render error"
        />
      );
    }
    return this.props.children;
  }
}
