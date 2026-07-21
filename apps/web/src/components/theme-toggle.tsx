"use client";

/**
 * theme-toggle.tsx — the theme toggle (D-21), extracted from app-sidebar so
 * the mobile "More" sheet and the desktop sidebar footer share ONE control
 * (one mapping, not two). Behaviour unchanged from the original: the mounted
 * gate prevents a hydration mismatch — on the server `resolvedTheme` is
 * undefined, so we render a neutral, non-throwing placeholder until the
 * client knows the active theme.
 */

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@polytoken/ui/button";

export function ThemeToggle(): React.ReactElement {
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
      className="h-11 w-full justify-start gap-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 pointer-coarse:touch-target"
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
