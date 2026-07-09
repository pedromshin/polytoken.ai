"use client";

import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  FlaskConical,
  Inbox,
  MessageSquare,
  Moon,
  Share2,
  Shapes,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Badge } from "@polytoken/ui/badge";
import { Button } from "@polytoken/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@polytoken/ui/sidebar";

import { SignOutButton } from "~/components/sign-out-button";

/** A navigable destination rendered as a next/link in the rail. */
interface LiveNavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** A future destination rendered as a disabled "Soon" affordance. */
interface SoonNavItem {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly soon: true;
}

// D-20 nav order: Inbox · Entity Types · Entities · Knowledge · Studio · Chat (all live).
const LIVE_NAV_ITEMS: ReadonlyArray<LiveNavItem> = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/entity-types", label: "Entity Types", icon: Shapes },
  { href: "/entities", label: "Entities", icon: Boxes },
  { href: "/knowledge", label: "Knowledge", icon: Share2 }, // ← promoted Phase 11
  { href: "/studio", label: "Studio", icon: FlaskConical }, // ← Phase 15: repointed to /studio landing (D-14)
  { href: "/chat", label: "Chat", icon: MessageSquare }, // ← Phase 22 (D-11): single Chat nav item
];

const SOON_NAV_ITEMS: ReadonlyArray<SoonNavItem> = []; // Knowledge removed

/** Active when the path is the route itself or nested beneath it. */
function isActiveRoute(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Theme toggle (D-21). The mounted gate prevents a hydration mismatch — on the
 * server `resolvedTheme` is undefined, so we render a neutral, non-throwing
 * placeholder until the client knows the active theme.
 */
function ThemeToggle(): React.ReactElement {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="h-11 w-full justify-start gap-2 text-muted-foreground hover:bg-muted"
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {/* Render both icons until mounted to avoid an SSR/client glyph mismatch. */}
      {mounted ? (
        isDark ? (
          <Sun className="size-4" aria-hidden />
        ) : (
          <Moon className="size-4" aria-hidden />
        )
      ) : (
        <Sun className="size-4 opacity-0" aria-hidden />
      )}
      <span className="text-sm">{isDark ? "Light mode" : "Dark mode"}</span>
    </Button>
  );
}

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
      className="border-r border-border/50 bg-background/70 backdrop-blur-md"
    >
      <SidebarHeader>
        <div className="flex h-11 items-center gap-2 px-2">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            P
          </span>
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
                      ? "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary"
                      : "text-muted-foreground hover:bg-muted"
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
