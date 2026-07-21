import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,

  /**
   * `next dev` and `next build` both default to `.next`. A verification build run while a dev
   * server is live overwrites its chunks: the server keeps its in-memory module graph and serves
   * HTML whose client JS never executes — silently, with the build reporting success. Setting
   * NEXT_DIST_DIR gives such builds their own directory. See package.json's `build:local`.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  /** Pin the monorepo root so Next ignores the stray parent lockfile. */
  outputFileTracingRoot: path.join(__dirname, "../../"),

  /** Hot-reload local workspace packages without a separate build step. */
  transpilePackages: [
    "@polytoken/api-client",
    // Exposes raw TS (`./src/index.ts`) — the /sessions surface imports its frozen schemas.
    "@polytoken/daemon-protocol",
    "@polytoken/db",
    "@polytoken/ui",
  ],

  /** Linting / typechecking run as separate tasks. */
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },

  /**
   * Resolve NodeNext-style `.js` specifiers in our source-first workspace packages to their real
   * `.ts` files. `@polytoken/daemon-protocol` exports raw `./src/index.ts`, whose internal ESM
   * imports carry `.js` extensions (required for the daemon's own NodeNext build). `tsc` maps
   * `.js`→`.ts` transparently, but Next's webpack does not by default — so the first web page to
   * import daemon-protocol for RUNTIME values (the /sessions surface: zod schemas + frame codecs)
   * broke `next build` with "Can't resolve './tools.js'". `transpilePackages` transpiles the TS but
   * does not add this resolution rule; `extensionAlias` does. Order: prefer `.ts`/`.tsx`, fall back
   * to a real `.js` so node_modules `.js` imports still resolve.
   */
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return webpackConfig;
  },
};

export default config;
