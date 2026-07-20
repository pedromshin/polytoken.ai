/**
 * THE CAPABILITY REGISTRY — the D2 spine, lifted to shared substrate (Phase 68 / INV-1).
 *
 * ## Why this package exists
 *
 * The user's D2 directive (DIRECTIVES-2026-07-17.md): the repo is INFRASTRUCTURE; the product
 * EMANATES from it. genui composes typed primitives into real features, bounded only by what the
 * infrastructure exposes. The architectural consequence:
 *
 *   **One capability, declared once, read by four consumers** (INV-1):
 *     - the LLM     → as a tool definition (`describe` + `input`)
 *     - genui       → as a composable block (`input`/`output` shapes)
 *     - the daemon  → as an executable (`execute`)
 *     - the canvas  → as a node type
 *
 * The daemon (Phase 65) shipped first and deliberately used the frozen field names below
 * (`id`/`input`/`output`/`risk`/`cost`/`describe`/`source`/`trust`), so lifting its descriptor into
 * this package is an IMPORT CHANGE, not a rewrite (INV-2). The metadata half here has zero daemon
 * coupling by construction — the ONE daemon-private thing (the execution context) is the generic
 * parameter `TCtx`, and the scope-decision shape is the generic parameter `TScope`.
 *
 * ## INV-3: source/trust are the hook v2.3's OSS ontology populates
 *
 * `source`/`trust` are constants today (`"builtin"`/`"first-party"`). They exist so the OSS/skills
 * ontology — the same registry pointed OUTWARD — is a POPULATE, not a re-architecture.
 *
 * ## INV-4: risk is DATA, not code
 *
 * `risk` is a FIELD. No capability implements its own confirm flow; the ONE permission model reads
 * this field and drives the prompt from it. Risk at each call site cannot deliver "one permission
 * model" — that is the whole point.
 *
 * This package is OSS substrate (negative-space Q4): NO tenant logic, NO env coupling, NO Supabase.
 * Its only dependency is `@polytoken/daemon-protocol` (for the frozen `Risk` enum) and `zod`.
 */
import type { ZodType } from "zod";
import type { Risk } from "@polytoken/daemon-protocol";

export type { Risk };

/**
 * Declared cost. Nominal/constant today (no metering yet) but declared from day one so planners and
 * the LLM can reason about it later without a schema migration (INV-1).
 */
export type CapabilityCost = "free" | "cheap" | "moderate" | "expensive";

/** Where the capability came from. `"external"` is v2.3 ontology territory (INV-3). */
export type CapabilitySource = "builtin" | "external";

/** How much the capability is trusted. Everything shipped in-repo is first-party (INV-3). */
export type CapabilityTrust = "first-party" | "verified" | "claimed" | "unvetted";

/**
 * An executable capability: the universal metadata (`id`/`input`/`output`/`risk`/`cost`/`describe`/
 * `source`/`trust`) plus an execution half parameterized by the consumer's context (`TCtx`) and its
 * scope-decision shape (`TScope`). The daemon binds `TCtx = ExecCtx` and `TScope = CapabilityScope`
 * (a filesystem-shaped permission scope); a future genui/chat executor binds its own. The metadata
 * half is identical across all consumers — see {@link CapabilityMeta} for the projection they read.
 *
 * This is a FLAT object type (not an intersection) on purpose: the daemon's pre-seamed descriptor is
 * flat, and the concrete→`never` assignability the registry relies on (INV-2) depends on that shape.
 */
export type Capability<
  TInput = unknown,
  TOutput = unknown,
  TCtx = unknown,
  TScope = unknown,
> = {
  /** The stable registry id — THE RESOLUTION KEY (INV-2). Also the daemon allowlist's key. */
  readonly id: string;
  readonly input: ZodType<TInput>;
  readonly output: ZodType<TOutput>;
  /** INV-4: drives the ONE permission model's prompt. Data, not code. */
  readonly risk: Risk;
  /** INV-1: declared even though nominal today. */
  readonly cost: CapabilityCost;
  /** Human/LLM-readable purpose. This is what an LLM reads to decide whether to call it. */
  readonly describe: string;
  /** INV-3: constant today; the hook v2.3's ontology populates. */
  readonly source: CapabilitySource;
  /** INV-3: constant today. */
  readonly trust: CapabilityTrust;
  /** What a permission decision would be scoped to. Pure — no side effects, no permission logic. */
  readonly scope: (input: TInput) => TScope;
  /** Runs ONLY after the permission model has allowed it. Never consults permissions itself. */
  readonly execute: (input: TInput, ctx: TCtx) => Promise<TOutput>;
};

/**
 * The universal, consumer-agnostic half of a capability — what the LLM, genui, and the canvas read.
 * NO execution coupling: this is the "registry pointed outward" (INV-1). Derived from
 * {@link Capability} so the two can never drift.
 */
export type CapabilityMeta<TInput = unknown, TOutput = unknown> = Pick<
  Capability<TInput, TOutput>,
  "id" | "input" | "output" | "risk" | "cost" | "describe" | "source" | "trust"
>;

/**
 * The describable projection — the registry "pointed outward". Deliberately the shape a
 * tool-definition emitter or a genui block catalogue consumes. Nothing here can execute.
 */
export type CapabilityManifestEntry = {
  readonly id: string;
  readonly describe: string;
  readonly risk: Risk;
  readonly cost: CapabilityCost;
  readonly source: CapabilitySource;
  readonly trust: CapabilityTrust;
};

/** A registry is a plain, immutable id→capability map. Resolution is a lookup, never a switch. */
export type CapabilityRegistry<TCtx = unknown, TScope = unknown> = {
  readonly ids: readonly string[];
  get(id: string): Capability<never, never, TCtx, TScope> | undefined;
  /** Everything an LLM / genui / the canvas needs, with no executable coupling. */
  list(): readonly CapabilityManifestEntry[];
};

/**
 * Build an immutable registry from descriptors. Duplicate ids throw: two capabilities with one id
 * make resolution ambiguous — and the daemon allowlist keys on that id, so ambiguity here is a
 * permission bug waiting to happen (INV-2).
 */
export const createCapabilityRegistry = <TCtx = unknown, TScope = unknown>(
  // Heterogeneous by construction: each capability has its own input/output types. `any` in those
  // positions lets concrete capabilities register without a cast; type safety is restored at the
  // boundary — `get()` returns `never` inputs, so a consumer MUST re-parse args against
  // `capability.input` before `execute` ever sees them (the daemon's handler.ts already does this).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  descriptors: readonly Capability<any, any, TCtx, TScope>[],
): CapabilityRegistry<TCtx, TScope> => {
  const byId = new Map<string, Capability<never, never, TCtx, TScope>>();

  for (const descriptor of descriptors) {
    if (byId.has(descriptor.id)) {
      throw new Error(`[capabilities] duplicate capability id "${descriptor.id}"`);
    }
    byId.set(descriptor.id, descriptor as unknown as Capability<never, never, TCtx, TScope>);
  }

  return Object.freeze({
    ids: Object.freeze([...byId.keys()]),
    get: (id: string) => byId.get(id),
    list: () =>
      Object.freeze(
        [...byId.values()].map((d) =>
          Object.freeze({
            id: d.id,
            describe: d.describe,
            risk: d.risk,
            cost: d.cost,
            source: d.source,
            trust: d.trust,
          }),
        ),
      ),
  });
};

/** Helper preserving inference while pinning the descriptor shape and freezing it. */
export const defineCapability = <TInput, TOutput, TCtx = unknown, TScope = unknown>(
  descriptor: Capability<TInput, TOutput, TCtx, TScope>,
): Capability<TInput, TOutput, TCtx, TScope> => Object.freeze(descriptor);
