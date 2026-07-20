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
};

export default config;
