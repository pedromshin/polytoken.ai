/**
 * The ToolExecutor: `tool.request` → broker → capability.execute → `tool.result` (DMON-03).
 *
 * INV-2: the capability is resolved by **registry id lookup**, never a switch on tool name. Adding
 * a capability is a registry entry — no edit here.
 * INV-4: `risk` is read OFF THE DESCRIPTOR and handed to the broker. This function contains no
 * per-tool permission logic, and no capability implements a confirm flow of its own.
 *
 * There is NO bypass path: `execute` is unreachable except through an `allow` verdict.
 */
import { randomUUID } from "node:crypto";
import type { Risk, ToolErrorCode } from "@polytoken/daemon-protocol";

import type { PermissionBroker } from "../permissions/broker.js";
import type { HandlerCtx, Router } from "../server/router.js";
import { BROWSER_CAPABILITIES } from "./browser.js";
import { BUILTIN_CAPABILITIES, gitRiskFor } from "./capabilities.js";
import { DIR_CAPABILITIES } from "./dir.js";
import { createCapabilityRegistry, type CapabilityRegistry, type ExecCtx } from "./registry.js";

/**
 * The one registry the daemon runs on. Exported so the smoke script can describe it.
 * v2.0: browser.* and dir.* capabilities are REGISTRY ENTRIES (INV-2) — these spreads are the entire
 * wiring; no dispatch code below knows they exist.
 */
export const builtinRegistry: CapabilityRegistry = createCapabilityRegistry([
  ...BUILTIN_CAPABILITIES,
  ...BROWSER_CAPABILITIES,
  ...DIR_CAPABILITIES,
]);

/**
 * INV-4: risk is DATA. It comes from the descriptor; `git` is the one capability whose risk
 * depends on its input (status is a read, commit is a write), so it derives from the input via a
 * pure function that still lives with the capability — never at this call site.
 */
const riskFor = (id: string, descriptorRisk: Risk, input: unknown): Risk => {
  if (id !== "git") return descriptorRisk;
  const subcommand = (input as { subcommand: Parameters<typeof gitRiskFor>[0] }).subcommand;
  return gitRiskFor(subcommand);
};

const replyError = (ctx: HandlerCtx, code: ToolErrorCode, message: string): void => {
  ctx.client.send("tool.result", randomUUID(), {
    requestId: ctx.envelopeId,
    ok: false,
    output: { kind: "error", code, message },
  });
};

export const executeToolRequest = async (
  payload: { tool: string; args: unknown },
  ctx: HandlerCtx & { broker: PermissionBroker; registry?: CapabilityRegistry },
): Promise<void> => {
  const registry = ctx.registry ?? builtinRegistry;

  // ── Resolve by id (INV-2). No switch. ──
  const capability = registry.get(payload.tool);
  if (capability === undefined) {
    replyError(ctx, "not_implemented", `no capability is registered under id "${payload.tool}"`);
    return;
  }

  // Validate against the capability's OWN declared input schema — the same schema an LLM or genui
  // would read. The protocol already parsed the frame; this proves the descriptor agrees.
  const parsed = capability.input.safeParse(payload.args);
  if (!parsed.success) {
    replyError(
      ctx,
      "invalid_args",
      parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; "),
    );
    return;
  }
  const input = parsed.data;

  let scope: ReturnType<typeof capability.scope>;
  try {
    scope = capability.scope(input);
  } catch (error) {
    replyError(ctx, "invalid_args", (error as Error).message);
    return;
  }

  // ── The ONE permission model. Nothing executes before this returns "allow". ──
  const verdict = await ctx.broker.decide({
    capabilityId: capability.id,
    risk: riskFor(capability.id, capability.risk, input),
    scope: scope.scope,
    pathsToCheck: scope.pathsToCheck,
    args: input,
  });

  if (verdict.kind === "deny") {
    replyError(ctx, verdict.code, verdict.message);
    return;
  }

  // ── Execute. Reached ONLY on an allow verdict. ──
  const execCtx: ExecCtx = {
    maxOutputBytes: ctx.config.exec.maxOutputBytes,
    defaultTimeoutMs: ctx.config.exec.defaultTimeoutMs,
  };

  try {
    const output = await capability.execute(input as never, execCtx);

    await ctx.audit.record({
      event: "execution",
      capabilityId: capability.id,
      scope: scope.scope,
      // Structural redaction: numbers and flags only — never the file's contents (T-65-08).
      meta: { ok: true, bytes: JSON.stringify(output).length },
    });

    ctx.client.send("tool.result", randomUUID(), {
      requestId: ctx.envelopeId,
      ok: true,
      output,
    });
  } catch (error) {
    const message = (error as Error).message;
    await ctx.audit.record({
      event: "execution",
      capabilityId: capability.id,
      scope: scope.scope,
      meta: { ok: false },
    });

    const code: ToolErrorCode = capability.id === "fs.read" || capability.id.startsWith("fs.")
      ? "io_failure"
      : "exec_failure";
    replyError(ctx, code, message);
  }
};

/** Wire `tool.request` into the router. */
export const registerToolHandler = (router: Router, registry?: CapabilityRegistry): void => {
  router.register("tool.request", async (payload, ctx) => {
    await executeToolRequest(payload as { tool: string; args: unknown }, { ...ctx, registry });
  });
};
