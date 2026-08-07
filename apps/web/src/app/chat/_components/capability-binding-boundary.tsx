"use client";

/**
 * capability-binding-boundary.tsx — the LIVE mount for the D2 binding proof
 * (REG-04): the seam where "the agent emits a genui spec that NAMES a registry
 * capability" becomes "a human-gated invocation that runs through the
 * resolver".
 *
 * This is the consumer `capability-confirm-card.tsx`'s header calls out as
 * "another wave's file" — the one that mounts the card and passes `onConfirm`
 * (the actual invoke). It plugs into exactly the three collaborators that were
 * already built and unit-proven, and re-implements none of them:
 *
 *   - `CapabilityBindingSchema` / `tryBindCapability` (@polytoken/genui/binding,
 *     bind-capability.ts) — the resolver. A spec's `capability` reference is a
 *     DATA descriptor; resolving it is a registry LOOKUP that FAILS CLOSED
 *     (INV-5): an id absent from the registry never becomes an invoker, so this
 *     boundary renders NOTHING for it (no confirm affordance for something that
 *     could not run anyway). No `switch`, no second copy of the fail-closed
 *     rule — `tryBindCapability` owns it.
 *   - `CapabilityConfirmCard` (capability-confirm-card.tsx) — the confirm
 *     affordance. It owns the ONE risk gate (`requiresConfirm`): a `read`-tier
 *     binding renders no card and never auto-invokes (invoking a side effect on
 *     render is exactly what the confirm gate exists to prevent). The
 *     card's `onConfirm` is the only path to the invoker, and only from an
 *     explicit human approve.
 *   - `BoundCapability.invoke` (bind-capability.ts) — the invocation. On
 *     approve, args flow through the Zod boundary (INV-1: `capability.input`
 *     before `execute`, `capability.output` after) — the resolver re-parses at
 *     the boundary because the registry erases IO types to `never`. This
 *     boundary never touches `execute` directly.
 *
 * ## The runtime seam (`CapabilityInvokerContext`)
 *
 * A capability can only run where its executor lives. The web tier holds no
 * client-executable registry of its own (the daemon's fs/browser executors are
 * a user-machine process the Next bundle must never import; the control-plane
 * registries execute server-side behind their own tRPC routers). So the
 * executable registry + its invocation context are INJECTED through
 * `CapabilityInvokerContext`, exactly the "ship the seam, wire the host later"
 * discipline `capabilities/index.ts` uses for its own live-manifest seam.
 *
 * DEFAULT = null ⇒ FAIL CLOSED. With no provider, `useCapabilityInvoker()`
 * returns null and this boundary renders nothing: an agent-emitted binding
 * cannot summon a confirm for a runtime that isn't wired. The full path
 * (spec → card → resolver.invoke → execute) is exercised the moment a host
 * supplies a real registry via `CapabilityInvokerProvider` — proven end-to-end
 * in capability-binding-boundary.test.tsx.
 *
 * ## Additive / dark-until-emitted
 *
 * `extractCapabilityBinding` is the ONLY change to the finalized-genui_spec
 * render path. A spec with no `capability` field returns the SAME spec object
 * reference and a null binding, so `MessageTurn`'s existing branch renders
 * byte-identically to before this wave.
 *
 * ## Why this path is GATED, not merely un-emitted (2026-08-07 security fix)
 *
 * An earlier version of this header argued the feature was "inert until an
 * emitter opts in" because `SpecRootSchema` is `.strict()`. That reasoning was
 * wrong and the correction is load-bearing: the listener persists the
 * `emit_ui_spec` tool JSON verbatim, and this extraction runs BEFORE the strict
 * parse — it removes `capability` from the object the parse would have
 * rejected. Nothing but the model's cooperation kept the key out, and the chat
 * agent reads attacker-controlled text by design. The kill switch inside
 * `extractCapabilityBinding` (`NEXT_PUBLIC_CAPABILITY_BINDING_ENABLED`,
 * default OFF) is what actually makes the claim true, and the confirm card now
 * DISCLOSES the arguments an approval would run with.
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import type { CapabilityManifestEntry, CapabilityRegistry } from "@polytoken/capabilities";
import {
  CapabilityBindingSchema,
  tryBindCapability,
  type BoundCapability,
  type CapabilityBinding,
} from "@polytoken/genui/binding";

import { CapabilityConfirmCard } from "./capability-confirm-card";

// ---------------------------------------------------------------------------
// Runtime seam — the injected executable registry + invocation context
// ---------------------------------------------------------------------------

/**
 * The executable registry a host wires into the chat tree, plus the context its
 * capabilities execute against. Deliberately loosely typed (`ctx: unknown`) —
 * the binding machinery is generic over `TCtx`/`TScope` and re-parses every
 * arg at the boundary, so the invoker context is opaque data threaded verbatim
 * to `BoundCapability.invoke`, never inspected here.
 */
export interface CapabilityInvoker {
  /** `CapabilityRegistry<never>` — a registry that accepts ANY execution
   * context (its `TCtx` is contravariant, so `never` is the one parameter that
   * lets a host's concretely-typed registry, e.g. `CapabilityRegistry<DaemonCtx>`,
   * assign into this seam). The matching `ctx` is threaded back at invoke time. */
  readonly registry: CapabilityRegistry<never>;
  /** Threaded verbatim to `invoke(ctx, args)`; opaque to this boundary — it is
   * the existential partner of `registry`, matched by the host that provides
   * both, cast to the invoker's erased `never` ctx at the one invoke site. */
  readonly ctx: unknown;
}

/**
 * DEFAULT null ⇒ fail closed. No provider means no executable runtime, so an
 * agent-emitted binding renders no confirm affordance at all.
 */
const CapabilityInvokerContext = React.createContext<CapabilityInvoker | null>(null);

export function CapabilityInvokerProvider({
  value,
  children,
}: {
  readonly value: CapabilityInvoker | null;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <CapabilityInvokerContext.Provider value={value}>{children}</CapabilityInvokerContext.Provider>
  );
}

export function useCapabilityInvoker(): CapabilityInvoker | null {
  return React.useContext(CapabilityInvokerContext);
}

// ---------------------------------------------------------------------------
// extractCapabilityBinding — the agent-emits-binding-spec parse (emit path)
// ---------------------------------------------------------------------------

export interface ExtractedBinding {
  /** The validated binding descriptor, or null when the spec names no
   * capability (or names one malformed — fail closed on shape). */
  readonly binding: CapabilityBinding | null;
  /** The spec to hand the genui renderer, with any `capability` key removed so
   * the `.strict()` `SpecRootSchema` still parses it. When the spec carried no
   * `capability` key, this is the SAME object reference passed in — the
   * byte-identical additive guarantee. */
  readonly spec: Readonly<Record<string, unknown>>;
}

/**
 * Split a finalized genui spec into its optional capability binding and the
 * renderable spec. The binding rides on a top-level `capability` field the
 * agent adds to the `emit_ui_spec` output; it is validated with the SAME
 * `CapabilityBindingSchema` the resolver uses (shape only — whether the id
 * RESOLVES is the resolver's fail-closed job, not this parse's).
 *
 * Pure — no side effects. A malformed `capability` field is stripped (so the
 * accompanying UI still renders) but yields a null binding (nothing to bind).
 */
export function extractCapabilityBinding(
  spec: Readonly<Record<string, unknown>>,
): ExtractedBinding {
  if (spec === null || typeof spec !== "object" || !("capability" in spec)) {
    // No capability field — return the SAME reference (byte-identical path).
    return { binding: null, spec };
  }

  const { capability: rawBinding, ...rest } = spec;

  // KILL SWITCH (default OFF) — the transport is reachable, so it is gated.
  //
  // The header above used to claim this path was inert because SpecRootSchema
  // is `.strict()`. It is not: the listener stores the emit_ui_spec tool JSON
  // VERBATIM (turn_state.py — "no validation/fallback, that gate is the web
  // boundary"), and this extraction runs BEFORE the strict parse, stripping
  // `capability` out of the spec the parse would have rejected. A Bedrock
  // input_schema shapes GENERATION, it does not validate — the repo knows this
  // (PARSE_FAILURE_TEXT exists precisely because models emit non-conforming
  // JSON). Since the chat agent reads untrusted content by design (mail bodies,
  // web-search results, deep research), an injected instruction to add a
  // top-level `capability` key would reach a live confirm card.
  //
  // No emitter exists yet, so gating costs nothing today and makes the claim
  // true by construction until an emitter is deliberately built (see
  // NESTED-ARGS-ANALYSIS Stage 0). Literal property access is load-bearing —
  // Next only inlines `process.env.NEXT_PUBLIC_*` written exactly this way.
  if (process.env.NEXT_PUBLIC_CAPABILITY_BINDING_ENABLED !== "true") {
    return { binding: null, spec: rest };
  }
  const parsed = CapabilityBindingSchema.safeParse(rawBinding);
  if (!parsed.success) {
    // Fail closed on shape: strip the bad field so the strict SpecRoot parse
    // still succeeds, but bind nothing.
    return { binding: null, spec: rest };
  }
  return { binding: parsed.data, spec: rest };
}

// ---------------------------------------------------------------------------
// CapabilityBindingBoundary — mount + resolver wiring (render path)
// ---------------------------------------------------------------------------

function InvokeErrorRow({ message }: { readonly message: string }): React.ReactElement {
  // Unboxed, ink-only (law 1) — mirrors interactive-widget-boundary's ErrorRow:
  // a refused invocation is a state, and the least "irreversible" thing on the
  // surface (the binding is still sitting there). The glyph carries it, never
  // the accent.
  return (
    <div role="alert" className="mt-1 flex items-center gap-2">
      <AlertTriangle className="size-4 shrink-0 text-ink" aria-hidden />
      <span className="text-2xs text-ink">{message}</span>
    </div>
  );
}

/**
 * CapabilityBindingBoundary — renders the confirm card for a resolved binding
 * and routes an approve through the resolver's invoker.
 *
 * Fail-closed order (hooks run unconditionally FIRST, then the conditional
 * returns — Rules of Hooks):
 *   1. no invoker provider wired          → render nothing
 *   2. `tryBindCapability` unregistered   → render nothing (INV-5)
 *   3. id not in the registry's manifest  → render nothing (can't describe it)
 * Only past all three does the card mount. The card itself then applies the
 * risk gate (a `read` tier renders null).
 */
export function CapabilityBindingBoundary({
  binding,
}: {
  readonly binding: CapabilityBinding;
}): React.ReactElement | null {
  const invoker = useCapabilityInvoker();
  const [invokeError, setInvokeError] = React.useState<string | null>(null);

  // Resolve the binding through the resolver (fail closed) and project the
  // manifest entry from the SAME registry — one source of truth for the risk
  // tier the card renders.
  const resolved = React.useMemo((): {
    readonly bound: BoundCapability<never>;
    readonly entry: CapabilityManifestEntry;
  } | null => {
    if (invoker === null) return null;
    const bind = tryBindCapability<never, unknown>(invoker.registry, binding);
    if (!bind.ok) return null; // INV-5 fail closed — unregistered never binds.
    const entry =
      invoker.registry.list().find((candidate) => candidate.id === binding.capabilityId) ?? null;
    if (entry === null) return null;
    return { bound: bind.capability, entry };
  }, [invoker, binding]);

  if (resolved === null || invoker === null) return null;

  // Fail closed BEFORE offering an approve: args that do not satisfy the
  // capability's own input schema can never become an approvable action. The
  // resolver would reject them at invoke time anyway — surfacing it here means
  // a human is never asked to authorize something that cannot legally run.
  const argCheck = resolved.bound.parseArgs(binding.args);
  if (!argCheck.ok) {
    return <InvokeErrorRow message={`Refused: ${argCheck.error.message}`} />;
  }

  const handleConfirm = async (): Promise<void> => {
    // The resolver's invoker: Zod-parse args → execute → Zod-parse output
    // (INV-1). Never throws for a validation/execute failure — those return a
    // discriminated `{ ok: false }` we surface inline.
    // `invoker.ctx` is the existential partner of `invoker.registry` (see the
    // CapabilityInvoker doc); cast to the resolver's erased `never` ctx here.
    const result = await resolved.bound.invoke(invoker.ctx as never, binding.args);
    if (!result.ok) {
      setInvokeError(result.error.message);
    }
  };

  return (
    <>
      <CapabilityConfirmCard
        entry={resolved.entry}
        // Disclosure is the gate: the human sees the exact arguments this
        // approval would run with, not merely which capability.
        args={binding.args}
        onConfirm={handleConfirm}
        onDismiss={() => {
          /* Withdrawn — the resolver is never touched. */
        }}
      />
      {invokeError !== null && <InvokeErrorRow message={invokeError} />}
    </>
  );
}
