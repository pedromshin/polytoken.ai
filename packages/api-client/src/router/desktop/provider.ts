/**
 * desktop/provider.ts — the control-plane binding of the E5 `DesktopProvider` port.
 *
 * The capability substrate (packages/capabilities/src/desktop.ts) declares the PORT; this is where
 * the control plane binds a concrete implementation. Per AWS-ARCHITECTURE.md the real
 * implementation is EC2 + Amazon DCV via the AWS SDK.
 *
 * ## Fails closed until EXPLICITLY enabled (RFC §5.3 / safety)
 *
 * A desktop provisioning call creates a BILLED VM — an irreversible, money-spending action. So the
 * provider is `failClosedDesktopProvider` (every verb rejects) UNTIL the operator explicitly opts
 * in AND supplies the credentials + budget config. There is no "default on": absence of config is a
 * refusal, never a silent spawn. The AWS binding below is intentionally a documented SEAM, not a
 * live spawner — building an untested EC2 spawner that runs on ambient credentials is exactly what
 * this guard exists to prevent. Wiring it is gated on the user's explicit budget go-ahead.
 */
import { failClosedDesktopProvider, type DesktopProvider } from "@polytoken/capabilities";

/**
 * getDesktopProvider — resolve the provider the desktop router executes through.
 *
 * SEAM (AWS-ARCHITECTURE.md, gated on the user's budget go-ahead): when
 * `env.DESKTOP_PROVISIONING_ENABLED === "true"` AND a scoped IAM role + region + budget ceilings are
 * configured, return a real `awsDesktopProvider(config)` (EC2 RunInstances + cloud-init DCV,
 * hibernate = Stop+EBS, destroy = TerminateInstances). Provider credentials are read ONLY here in
 * the control plane and never leave it (never on the row, never on the desktop — RFC §6). Until then
 * this returns the fails-closed floor so no code path can spawn a machine.
 */
export function getDesktopProvider(): DesktopProvider {
  // Deliberately unconditional today: no ambient-credential spawn path exists. Flip this to the
  // AWS binding only alongside the budget-ceiling enforcement and the operator opt-in flag.
  return failClosedDesktopProvider;
}
