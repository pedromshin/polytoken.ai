import type { Metadata } from "next";
import { Archivo } from "next/font/google";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@polytoken/ui/sidebar";
import { Toaster } from "@polytoken/ui/sonner";

import { AppSidebar } from "~/components/app-sidebar";
import { BrandMark } from "~/components/brand-mark";
import { ThemeProvider } from "~/components/theme-provider";
import { TRPCReactProvider } from "~/trpc/react";
import "./globals.css";

/**
 * D-58-01 / 59-02-PLAN.md Task 1, interfaces §B: self-host Archivo (400/600
 * only -- the only two weights direction-final.html uses), exposed as a CSS
 * variable that globals.css's `--font-sans` consumes. `next/font/google`
 * fetches this ONCE at build time and self-hosts it thereafter -- no
 * runtime request to Google, no CLS (T-59-03's mitigation). Per the plan's
 * hard fallback rule: if `npm run build` cannot fetch it (no network -- the
 * overnight reality this repo plans around), this import is REMOVED and
 * `--font-sans`'s literal "Archivo"-first stack in globals.css is left
 * unchanged -- the identity does not depend on the webfont; a red build
 * must never depend on one.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Your inbox — Polytoken",
  description: "Inbound email viewer",
};

/**
 * Root app shell (D-20/D-21). The whole app renders inside a persistent frosted
 * left rail. Provider nesting preserves the original ordering — TRPCReactProvider
 * stays outermost over the UI tree, the Toaster stays a sibling of the shell —
 * while ThemeProvider (next-themes) + SidebarProvider wrap the content. `{children}`
 * paints in the SidebarInset content slot (the editor keeps its full-viewport canvas
 * inside this slot). `suppressHydrationWarning` is required by next-themes, which
 * writes the resolved theme class onto <html> after hydration.
 *
 * Below `md`, a `md:hidden` bar directly above `{children}` (53-01-PLAN.md
 * Task 2, 53-UI-SPEC.md Component Inventory §1) mounts a `SidebarTrigger` —
 * closing a found gap where no trigger existed anywhere in the app, leaving
 * a signed-in phone user with no way to open the app nav. Desktop (`>=md`)
 * stays byte-identical to before this bar was added.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={archivo.variable} suppressHydrationWarning>
      <body>
        <TRPCReactProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/50 bg-background px-2 md:hidden">
                  <SidebarTrigger className="size-11" />
                  <BrandMark
                    variant="glyph"
                    size="size-5"
                    className="text-primary"
                  />
                  <span className="text-sm font-semibold text-foreground">
                    Polytoken
                  </span>
                </div>
                {children}
              </SidebarInset>
            </SidebarProvider>
          </ThemeProvider>
        </TRPCReactProvider>
        <Toaster />
      </body>
    </html>
  );
}
