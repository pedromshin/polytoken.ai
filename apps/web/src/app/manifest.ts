/**
 * manifest.ts — the web-app manifest (MOBL-01, mobile web app shell).
 *
 * Served at /manifest.webmanifest by the App Router convention. Makes the
 * app installable on a phone home screen ("Add to Home Screen") with the
 * identity's own paper grounds as the OS-level chrome colours — the same
 * hex projections of the oklch ladder that `viewport.themeColor` in
 * layout.tsx uses (see the table there; light `--shelf` = #e8e6dc).
 *
 * `display: "standalone"` gives the installed app its own window without
 * browser chrome — the bottom tab bar (mobile-tab-bar.tsx) is the app's own
 * navigation, so it does not need the browser's. The icon reuses the
 * committed BrandMark geometry via the app/icon.svg favicon route (D-47-02)
 * — one mark, not a second drawing of it.
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Polytoken",
    short_name: "Polytoken",
    description:
      "Your mail, documents, and knowledge — every fact with a source.",
    start_url: "/",
    display: "standalone",
    background_color: "#e8e6dc",
    theme_color: "#e8e6dc",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
