/**
 * nav-items.ts — the ONE navigation registry (mobile-first shell, MOBL-02).
 *
 * One mapping, not two (brand-guide §3 "one mapping, not two"): the desktop
 * sidebar rail, the mobile bottom tab bar, and the mobile "More" sheet all
 * read THIS list. Before this module, `app-sidebar.tsx` owned a private copy —
 * adding a destination meant the phone silently never got it.
 *
 * The split below is the mobile IA decision (D-20 order preserved within each
 * group):
 *   - `MOBILE_TAB_ITEMS` — the four highest-frequency destinations, one thumb
 *     tap from anywhere. Chosen by usage gravity: Inbox (the product's front
 *     door), Chat (the other daily surface), Knowledge, Files.
 *   - `MOBILE_MORE_ITEMS` — everything else, one tap away behind the fifth
 *     "More" tab. Nothing is desktop-only: full capability parity, different
 *     click budget.
 *
 * `isActiveRoute` moved here with the list so active-state logic can't drift
 * between the rail and the tab bar either.
 */

import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Boxes,
  FileText,
  FlaskConical,
  FolderOpen,
  Inbox,
  MessageSquare,
  Share2,
  Shapes,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";

/** A navigable destination rendered as a next/link in the rail/tab bar. */
export interface LiveNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

// D-20 nav order: Inbox · Entity Types · Entities · Knowledge · Studio · Chat (all live).
export const LIVE_NAV_ITEMS: ReadonlyArray<LiveNavItem> = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/entity-types", label: "Entity Types", icon: Shapes },
  { href: "/entities", label: "Entities", icon: Boxes },
  { href: "/knowledge", label: "Knowledge", icon: Share2 },
  { href: "/studio", label: "Studio", icon: FlaskConical },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FolderOpen },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/references", label: "References", icon: Bookmark },
  { href: "/sessions", label: "Sessions", icon: SquareTerminal },
  { href: "/capabilities", label: "Capabilities", icon: ShieldCheck },
];

/** The four thumb-reach destinations on the mobile bottom tab bar. */
export const MOBILE_TAB_ITEMS: ReadonlyArray<LiveNavItem> = [
  LIVE_NAV_ITEMS[0]!, // Inbox
  LIVE_NAV_ITEMS[5]!, // Chat
  LIVE_NAV_ITEMS[3]!, // Knowledge
  LIVE_NAV_ITEMS[6]!, // Files
];

/** Everything else — full parity, one tap behind the "More" tab. */
export const MOBILE_MORE_ITEMS: ReadonlyArray<LiveNavItem> =
  LIVE_NAV_ITEMS.filter((item) => !MOBILE_TAB_ITEMS.includes(item));

/** Active when the path is the route itself or nested beneath it. */
export function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * True when the current path is one of the "More" destinations — the fifth
 * tab lights up as the active tab for every destination it shelters, so the
 * bar never shows "nowhere" while the user is somewhere.
 */
export function isMoreActive(pathname: string): boolean {
  return MOBILE_MORE_ITEMS.some((item) => isActiveRoute(pathname, item.href));
}
