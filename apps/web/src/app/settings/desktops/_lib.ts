/**
 * settings/desktops/_lib.ts — the pure, framework-free logic behind the ST-03
 * desktop-management pane (E5 / RFC §5 / §6). Kept out of the component so both
 * the tenancy filter and the confirm-gate are unit-testable without a DOM.
 *
 * Two concerns:
 *   1. OWNED-SCOPING (INV-8): the `desktop.list` procedure is already
 *      owner-scoped server-side, but the pane filters again defensively — a
 *      cross-user row must never render even if the transport were ever wrong.
 *      Fail-closed: with no verifiable current user, nothing is shown.
 *   2. CONFIRM-GATE AS DATA (INV-4): whether a lifecycle verb needs a confirm
 *      modal is READ from the capability descriptor's `reversibility`, never
 *      hard-coded in the button. `desktop.destroy` declares
 *      `reversibility: "irreversible"`; `desktop.hibernate` does not.
 */

import {
  desktopDestroyCapability,
  desktopHibernateCapability,
} from "@polytoken/capabilities";

/** The lifecycle states a desktop session can present. */
export type DesktopSessionStatus =
  | "provisioning"
  | "running"
  | "hibernated"
  | "destroyed";

/**
 * The row shape the pane renders — the subset of `desktop_sessions` the list
 * procedure returns that the UI reads. `createdAt` is a `Date` over superjson
 * transport; accepted as `Date | string` so the pure filter needs no transport
 * assumptions.
 */
export interface DesktopSessionView {
  readonly id: string;
  readonly userId: string;
  readonly label: string | null;
  readonly status: DesktopSessionStatus;
  readonly provider: string;
  readonly region: string;
  readonly shape: string;
  readonly hourlyRateCents: number;
  readonly maxLifetimeMinutes: number;
  readonly createdAt: Date | string;
  readonly providerInstanceId: string | null;
}

/**
 * selectOwnedDesktops — the tenancy floor: keep only rows whose `userId` is the
 * signed-in user's. Fail-closed — an absent user id or an absent list yields an
 * empty result (never "show everything"), so a cross-user row can never leak
 * into the pane.
 */
export function selectOwnedDesktops<T extends { userId: string }>(
  rows: readonly T[] | undefined | null,
  currentUserId: string | undefined | null,
): T[] {
  if (!rows || !currentUserId) return [];
  return rows.filter((row) => row.userId === currentUserId);
}

/** The two owner-driven lifecycle verbs the pane offers on a live desktop. */
export type DesktopPaneVerb = "hibernate" | "destroy";

/**
 * The reversibility of each pane verb, READ from the capability descriptor (not
 * restated) — INV-4: risk/reversibility are DATA declared once. `undefined`
 * means reversible.
 */
export const DESKTOP_VERB_REVERSIBILITY: Readonly<
  Record<DesktopPaneVerb, string | undefined>
> = {
  hibernate: desktopHibernateCapability.reversibility,
  destroy: desktopDestroyCapability.reversibility,
};

/**
 * verbRequiresConfirm — does this verb need a confirm modal before it fires?
 * True exactly when the capability declares `reversibility: "irreversible"`.
 * The button reads this; it does not decide it.
 */
export function verbRequiresConfirm(verb: DesktopPaneVerb): boolean {
  return DESKTOP_VERB_REVERSIBILITY[verb] === "irreversible";
}

/** A live desktop (money- or storage-costing) — everything but a destroyed VM. */
export function isLiveDesktop(status: DesktopSessionStatus): boolean {
  return status !== "destroyed";
}

/** A running desktop can be hibernated; a hibernated one cannot be re-hibernated. */
export function canHibernate(status: DesktopSessionStatus): boolean {
  return status === "running" || status === "provisioning";
}
