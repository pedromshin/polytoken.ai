"use client";

/**
 * mobile-tab-bar.tsx — the mobile app shell's PRIMARY navigation (MOBL-02):
 * a fixed bottom tab bar below `md`, plus the "More" bottom sheet that
 * shelters every destination the four tabs don't carry. Desktop (`>=md`)
 * never mounts any of this — the sidebar rail remains the desktop nav.
 *
 * Design law compliance (D-58-01 / taste-references.md):
 *   - Law 1 (colour is earned): the bar is monochrome. Active = `text-ink`
 *     plus a 2px ink RULE across the top of the active cell — selection is
 *     ink, never a hue, and the indicator is the house "rule change"
 *     language, not a pill of accent colour. Inactive = `text-faded`.
 *   - No glass, no shadow: solid `bg-leaf` one step above the page, with a
 *     `border-t border-rule` seam (elevation is the ground ladder).
 *   - Touch floor: every cell is >=44px (h-14 = 56px) and additionally
 *     carries `pointer-coarse:touch-target` (D-48-07's WCAG floor).
 *   - Safe area: the bar pads itself with env(safe-area-inset-bottom) so the
 *     home indicator on notched phones never overlaps the fifth tab.
 *
 * The "More" sheet: full capability parity, one tap away. It lists the
 * remaining destinations as quiet rows (icon + label, row density steps),
 * then the theme toggle and sign-out — the two controls that live in the
 * desktop sidebar footer. The sheet closes on navigation.
 *
 * Nav data comes from `nav-items.ts` — the ONE registry the sidebar reads
 * too. Do not add a destination here; add it there.
 */

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { cn } from "@polytoken/ui";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@polytoken/ui/sheet";
import { Separator } from "@polytoken/ui/separator";

import { BrandMark } from "~/components/brand-mark";
import {
  isActiveRoute,
  isMoreActive,
  MOBILE_MORE_ITEMS,
  MOBILE_TAB_ITEMS,
} from "~/components/nav-items";
import { SignOutButton } from "~/components/sign-out-button";
import { ThemeToggle } from "~/components/theme-toggle";

/** One tab cell — the shared anatomy for the four links and the More button. */
function TabCell({
  active,
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span"> & { readonly active: boolean }) {
  return (
    <span
      className={cn(
        // The 2px top rule is the selection mark (ink, law 1). Inactive cells
        // carry a transparent rule of the same weight so nothing shifts.
        "relative flex h-14 min-w-0 flex-col items-center justify-center gap-1 border-t-2 pointer-coarse:touch-target",
        active
          ? "border-ink text-ink"
          : "border-transparent text-faded",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function MobileTabBar(): React.ReactElement | null {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreActive = isMoreActive(pathname);

  // No app nav on the unauthenticated door or on print output — the one
  // surface a signed-out phone sees, and the one surface meant for paper.
  if (pathname === "/login" || pathname.endsWith("/print")) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-leaf pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="grid grid-cols-5">
        {MOBILE_TAB_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className="focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ink"
            >
              <TabCell active={active}>
                <Icon className="size-5 shrink-0" aria-hidden />
                <span
                  className={cn(
                    "max-w-full truncate px-0.5 text-2xs",
                    active && "font-semibold",
                  )}
                >
                  {item.label}
                </span>
              </TabCell>
            </Link>
          );
        })}

        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="More destinations"
              aria-haspopup="dialog"
              className="focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ink"
            >
              <TabCell active={moreActive}>
                <Ellipsis className="size-5 shrink-0" aria-hidden />
                <span
                  className={cn(
                    "max-w-full truncate px-0.5 text-2xs",
                    moreActive && "font-semibold",
                  )}
                >
                  More
                </span>
              </TabCell>
            </button>
          </SheetTrigger>

          {/* Held-up paper, not a dark frosted modal: --bright sheet, --rule
              seam, zero shadow (taste §3 files-vault skinning rule). */}
          <SheetContent
            side="bottom"
            className="max-h-[80dvh] overflow-y-auto rounded-t-frame border-t border-rule bg-bright p-0 pb-[env(safe-area-inset-bottom)] shadow-none"
          >
            <SheetHeader className="border-b border-hair px-row-x py-row-y text-left">
              <SheetTitle className="flex items-center gap-2 text-base font-semibold text-ink">
                <BrandMark
                  variant="glyph"
                  size="size-5"
                  className="text-primary"
                />
                Polytoken
              </SheetTitle>
            </SheetHeader>

            <ul className="py-1">
              {MOBILE_MORE_ITEMS.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-row-x py-row-y text-sm pointer-coarse:touch-target focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ink",
                        active
                          ? "bg-ink-08 font-semibold text-ink"
                          : "text-faded active:bg-shade",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <Separator className="bg-hair" />

            <div className="flex flex-col gap-1 p-2">
              <ThemeToggle />
              <SignOutButton />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
