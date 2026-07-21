import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

import { SidebarInset, SidebarProvider } from "@polytoken/ui/sidebar";
import { Toaster } from "@polytoken/ui/sonner";

import { AppSidebar } from "~/components/app-sidebar";
import { MobileTabBar } from "~/components/mobile-tab-bar";
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
 * Viewport (MOBL-01, mobile web app shell). `viewportFit: "cover"` lets the
 * app paint under notches/home indicators so the tab bar's own
 * env(safe-area-inset-bottom) padding is the thing that clears them —
 * without it, iOS letterboxes the app and the safe-area env() vars are all
 * zero. `interactiveWidget: "resizes-content"` keeps bottom-fixed chrome
 * (composer, tab bar) above the on-screen keyboard on Chrome Android.
 * themeColor projects the identity's `--shelf` page ground (oklch → hex,
 * same values as manifest.ts) onto the OS browser chrome per scheme.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8e6dc" },
    { media: "(prefers-color-scheme: dark)", color: "#191512" },
  ],
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
 * Below `md`, the app is a MOBILE WEB APP (MOBL-02): primary navigation is
 * the fixed bottom tab bar (`MobileTabBar` — four thumb-reach destinations +
 * a "More" sheet with full parity), which replaced the 53-01 hamburger top
 * bar; a bottom bar beats a burger for one-tap reach and glanceable place
 * (every top mobile app shell made this move). The content wrapper sets
 * `--app-tabbar-h` (3.5rem below `md`, 0 at `md+`) and pads its own bottom
 * by it, so scrolling surfaces never hide content under the fixed bar;
 * fixed-height surfaces subtract the same var in their height calc.
 * Desktop (`>=md`) keeps the sidebar rail and never mounts the tab bar.
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
                <div className="flex min-h-0 flex-1 flex-col pb-(--app-tabbar-h) [--app-tabbar-h:calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 md:[--app-tabbar-h:0px]">
                  {children}
                </div>
                <MobileTabBar />
              </SidebarInset>
            </SidebarProvider>
          </ThemeProvider>
        </TRPCReactProvider>
        <Toaster />
      </body>
    </html>
  );
}
