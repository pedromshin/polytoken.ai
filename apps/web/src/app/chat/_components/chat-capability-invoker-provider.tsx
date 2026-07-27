"use client";

/**
 * chat-capability-invoker-provider.tsx — the HOST that supplies the chat tree's
 * live `CapabilityInvoker` (Stream #2, REG-04). It closes the runtime seam
 * `capability-binding-boundary.tsx` ships: with no provider the boundary fails
 * closed and renders nothing; mounted here — INSIDE the app's tRPC provider, so
 * `api.*` is reachable — it wires the client-executable registry to its real
 * server mutations.
 *
 * It reads the imperative tRPC client via `api.useUtils().client` (the vanilla
 * client the React provider already holds) and forwards each wired capability to
 * its mutation. `useMemo` keys on that client so the invoker is stable across
 * re-renders — the confirm card never re-binds mid-turn.
 *
 * Purely additive: this mounts a context provider around its children. It calls
 * nothing on render (no `execute`); invocation stays behind the human confirm
 * card the boundary owns. A tree with this provider but no agent-emitted binding
 * renders byte-identically to one without it.
 */

import * as React from "react";

import { api } from "~/trpc/react";

import { CapabilityInvokerProvider } from "./capability-binding-boundary";
import {
  buildClientCapabilityInvoker,
  type ClientCapabilityMutations,
} from "./client-capability-registry";

export function ChatCapabilityInvokerProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  // `useUtils().client` is the typed vanilla tRPC client (TRPCClient<AppRouter>) —
  // the imperative escape hatch for calling a mutation outside a component's
  // render (the capability executors run inside the resolver's async invoke, not
  // as hooks).
  const { client } = api.useUtils();

  const invoker = React.useMemo(() => {
    const mutations: ClientCapabilityMutations = {
      addCanvasNode: (input) => client.chat.addCanvasNode.mutate(input),
      connectCanvasNodes: (input) => client.chat.connectCanvasNodes.mutate(input),
      removeCanvasNode: (input) => client.chat.removeCanvasNode.mutate(input),
      createTable: (input) => client.spreadsheets.create.mutate(input),
      updateTable: (input) => client.spreadsheets.update.mutate(input),
    };
    return buildClientCapabilityInvoker(mutations);
  }, [client]);

  return <CapabilityInvokerProvider value={invoker}>{children}</CapabilityInvokerProvider>;
}
