"use client";

import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@polytoken/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@polytoken/ui/sidebar";

import { BrandMark } from "~/components/brand-mark";
import { isActiveRoute, LIVE_NAV_ITEMS } from "~/components/nav-items";
import { SignOutButton } from "~/components/sign-out-button";
import { ThemeToggle } from "~/components/theme-toggle";

/** A future destination rendered as a disabled "Soon" affordance. */
interface SoonNavItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly soon: true;
}

// Nav data lives in nav-items.ts (MOBL-02) — the ONE registry this rail, the
// mobile tab bar, and the "More" sheet all read. Add destinations THERE.
const SOON_NAV_ITEMS: ReadonlyArray<SoonNavItem> = []; // Knowledge removed

/**
 * AppSidebar (D-20/D-21) — the persistent frosted left rail wrapping the whole
 * app. Inbox + Entity Types are live next/link destinations; Entities +
 * Knowledge are disabled "Soon" placeholders until Phases 10/11. The single
 * teal `primary` accent marks the active route; no second hue is introduced.
 */
export function AppSidebar(): React.ReactElement {
  const pathname = usePathname();

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-border/50 bg-background/95"
    >
      <SidebarHeader>
        <div className="flex h-11 items-center gap-2 px-2">
          <BrandMark
            variant="glyph"
            size="size-6"
            className="shrink-0 text-primary"
          />
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            Polytoken
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu className="px-2">
          {LIVE_NAV_ITEMS.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={item.label}
                  className={
                    active
                      ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  }
                >
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}

          {SOON_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.label}>
                <div
                  aria-disabled
                  className="flex cursor-not-allowed items-center gap-2 rounded-md p-2 text-sm text-muted-foreground/50"
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1 truncate group-data-[collapsible=icon]:hidden">
                    {item.label}
                  </span>
                  <Badge
                    variant="secondary"
                    className="group-data-[collapsible=icon]:hidden"
                  >
                    Soon
                  </Badge>
                </div>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        <ThemeToggle />
        <SignOutButton />
      </SidebarFooter>
    </Sidebar>
  );
}
