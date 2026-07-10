import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        // D-48-04: tier-ladder — knowledge confidence (EXTRACTED/INFERRED),
        // never overloads primary/muted/accent. Flat keys (not DEFAULT/
        // foreground sub-objects) so both tiers coexist under one group.
        tier: {
          inferred: "hsl(var(--tier-inferred))",
          "inferred-foreground": "hsl(var(--tier-inferred-foreground))",
          extracted: "hsl(var(--tier-extracted))",
          "extracted-foreground": "hsl(var(--tier-extracted-foreground))",
        },
        // D-48-05: closed graph node-type palette — mirrors the `primary`
        // idiom (hsl(var(--x))) so bg-graph-entity/10, border-graph-entity/40,
        // text-graph-entity opacity modifiers resolve exactly like bg-primary/10.
        graph: {
          entity: "hsl(var(--graph-entity))",
          "entity-foreground": "hsl(var(--graph-entity-foreground))",
          "email-component": "hsl(var(--graph-email-component))",
          "email-component-foreground":
            "hsl(var(--graph-email-component-foreground))",
          email: "hsl(var(--graph-email))",
          "email-foreground": "hsl(var(--graph-email-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderColor: {
        DEFAULT: "hsl(var(--border))",
      },
      boxShadow: {
        "elevation-1": "var(--elevation-1)",
        "elevation-2": "var(--elevation-2)",
        "elevation-3": "var(--elevation-3)",
      },
    },
  },
} satisfies Config;
