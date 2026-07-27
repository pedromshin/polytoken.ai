/**
 * client-capability-registry.ts — the web tier's CLIENT-EXECUTABLE capability
 * registry: the host that finally supplies a real `CapabilityInvoker` to
 * `capability-binding-boundary.tsx`'s runtime seam, lighting up the REG-04
 * confirm-card path in-app (Stream #2).
 *
 * ## What is (and is NOT) client-invocable
 *
 * A capability can only run where its executor lives. The boundary's own header
 * states the rule: the daemon's `fs.*` / `terminal.exec` / `git` / `browser.*`
 * executors are a USER-MACHINE process the Next bundle must never import, so they
 * stay UNREGISTERED here and the boundary renders nothing for them (fail closed,
 * INV-5). The control-plane triples, by contrast, execute SERVER-SIDE behind
 * their own tRPC routers, which a browser CAN reach:
 *
 *   - `canvas.addNode` / `canvas.connect` / `canvas.removeNode`
 *       → `api.chat.addCanvasNode` / `.connectCanvasNodes` / `.removeCanvasNode`
 *         (packages/api-client/src/router/chat/canvas-mutations.ts)
 *   - `table.create` / `table.update`
 *       → `api.spreadsheets.create` / `.update`
 *         (packages/api-client/src/router/spreadsheets/index.ts)
 *
 * So THOSE five — and only those five — are wired here. Every one is
 * `protectedProcedure`, asserts ownership server-side, and re-parses its input
 * at the boundary: the browser holds no privilege the router does not already
 * grant `ctx.user.id`.
 *
 * ## Reuse, do not re-declare (INV-1)
 *
 * The wired capabilities are the SAME frozen `defineCapability()` descriptors the
 * server binds (`CANVAS_CAPABILITIES` / `TABLE_CAPABILITIES`). We do not fork a
 * second "client" declaration — we bind the existing descriptors to a client
 * `Ctx` whose store methods happen to be tRPC round-trips. The descriptor's
 * `execute` is `(input, ctx) => ctx.store.<verb>(input)` verbatim; here `ctx.store`
 * is a client store that forwards to `api.*.mutate`. The Zod boundary the resolver
 * enforces (`capability.input` before execute, `capability.output` after) is
 * unchanged — it now fences the tRPC round-trip on both sides.
 *
 * ## Never auto-invoke
 *
 * This module only PROVIDES the executable registry. Invocation stays entirely
 * behind the human confirm card (`CapabilityConfirmCard`, gated by
 * `requiresConfirm` — all five are `risk: "write"`, so all five confirm). Nothing
 * here calls `execute`; the boundary does, and only from an explicit approve.
 */

import {
  CANVAS_CAPABILITIES,
  TABLE_CAPABILITIES,
  createCapabilityRegistry,
  type Capability,
  type CapabilityRegistry,
  type CanvasAddNodeInput,
  type CanvasAddNodeOutput,
  type CanvasConnectInput,
  type CanvasConnectOutput,
  type CanvasExecCtx,
  type CanvasMutationStore,
  type CanvasRemoveNodeInput,
  type CanvasRemoveNodeOutput,
  type CanvasScope,
  type SpreadsheetStore,
  type TableCreateInput,
  type TableCreateOutput,
  type TableExecCtx,
  type TableScope,
  type TableUpdateInput,
  type TableUpdateOutput,
} from "@polytoken/capabilities";

import type { CapabilityInvoker } from "./capability-binding-boundary";

// ---------------------------------------------------------------------------
// The client execution context — one store, both control-plane surfaces
// ---------------------------------------------------------------------------

/**
 * The store the client-bound capabilities execute against. It satisfies BOTH the
 * canvas descriptors' `CanvasExecCtx["store"]` (`CanvasMutationStore`) and the
 * table descriptors' `TableExecCtx["store"]` (`SpreadsheetStore`) at once, so a
 * single `ctx` object serves every wired capability: `canvas.addNode`'s execute
 * reads `ctx.store.addNode`, `table.create`'s reads `ctx.store.create`, and so on.
 */
export type ClientCapabilityStore = CanvasMutationStore & SpreadsheetStore;

/**
 * The invocation context threaded to every wired capability's `execute`.
 * Assignable to BOTH `CanvasExecCtx` and `TableExecCtx` (its `store` is the
 * intersection of their two store ports), which is exactly what lets the two
 * differently-typed descriptor arrays fold into one registry.
 */
export type ClientCapabilityCtx = { readonly store: ClientCapabilityStore };

/** The union of the wired descriptors' scope-decision shapes. */
export type ClientCapabilityScope = CanvasScope | TableScope;

// ---------------------------------------------------------------------------
// The tRPC-mutation port — the one seam this module needs from the web app
// ---------------------------------------------------------------------------

/**
 * The exact set of tRPC mutations the client store forwards to — a narrow port
 * so this module never has to import `~/trpc/react` (the React provider wires the
 * real `api.*.mutate` in; a test injects a fake). Each method's IO is the
 * capability's own validated input/output (the tRPC procedures are typed from the
 * same descriptors), so no shape drift is possible.
 */
export interface ClientCapabilityMutations {
  addCanvasNode(input: CanvasAddNodeInput): Promise<CanvasAddNodeOutput>;
  connectCanvasNodes(input: CanvasConnectInput): Promise<CanvasConnectOutput>;
  removeCanvasNode(input: CanvasRemoveNodeInput): Promise<CanvasRemoveNodeOutput>;
  createTable(input: TableCreateInput): Promise<TableCreateOutput>;
  updateTable(input: TableUpdateInput): Promise<TableUpdateOutput>;
}

/**
 * Build the client store from the tRPC mutation port. Every method is a thin
 * forward — the input is already Zod-validated by the resolver before it reaches
 * here, and the server re-validates it again at the procedure boundary.
 */
export function createClientCapabilityStore(
  mutations: ClientCapabilityMutations,
): ClientCapabilityStore {
  return {
    addNode: (input) => mutations.addCanvasNode(input),
    connect: (input) => mutations.connectCanvasNodes(input),
    removeNode: (input) => mutations.removeCanvasNode(input),
    create: (input) => mutations.createTable(input),
    update: (input) => mutations.updateTable(input),
  };
}

// ---------------------------------------------------------------------------
// The registry — the SAME descriptors the server binds, folded into one map
// ---------------------------------------------------------------------------

/**
 * The wired descriptors as one array. The `as unknown as` erasure mirrors the
 * exact idiom `CANVAS_CAPABILITIES` / `TABLE_CAPABILITIES` use at their own
 * source: the registry keys on `Capability<never, never, TCtx, TScope>` (IO
 * erased to `never`), and the two arrays carry different `TCtx`/`TScope` that both
 * accept `ClientCapabilityCtx` (contravariant ctx) and widen into
 * `ClientCapabilityScope` (covariant scope). Safety is restored at the boundary:
 * the resolver re-parses args against `capability.input` before `execute`.
 *
 * The daemon-only ids (`fs.*`, `terminal.exec`, `git`, `browser.*`, `dir.*`,
 * `desktop.*`) are deliberately ABSENT — an unregistered id can never bind, so
 * the boundary renders nothing for it (fail closed, INV-5).
 */
const CLIENT_CAPABILITIES = [
  ...CANVAS_CAPABILITIES,
  ...TABLE_CAPABILITIES,
] as unknown as readonly Capability<never, never, ClientCapabilityCtx, ClientCapabilityScope>[];

/**
 * Build the client-executable capability registry (an immutable id→capability
 * map). Duplicate ids would throw at construction — the five wired ids are
 * disjoint, so it never does.
 */
export function createClientCapabilityRegistry(): CapabilityRegistry<
  ClientCapabilityCtx,
  ClientCapabilityScope
> {
  return createCapabilityRegistry<ClientCapabilityCtx, ClientCapabilityScope>(CLIENT_CAPABILITIES);
}

/**
 * Assemble the full `CapabilityInvoker` the boundary's runtime seam consumes: the
 * client registry plus the `ctx` its capabilities execute against. The concrete
 * `CapabilityRegistry<ClientCapabilityCtx, …>` assigns into the seam's
 * `CapabilityRegistry<never>` (its `TCtx` is contravariant, so `never` accepts any
 * host ctx — the exact assignability the boundary's `CapabilityInvoker` doc
 * describes), and `ctx` is threaded back verbatim at invoke time.
 */
export function buildClientCapabilityInvoker(
  mutations: ClientCapabilityMutations,
): CapabilityInvoker {
  const store = createClientCapabilityStore(mutations);
  return {
    registry: createClientCapabilityRegistry(),
    ctx: { store } satisfies ClientCapabilityCtx,
  };
}
