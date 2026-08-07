# Build context: repo root (matches the monorepo CI convention — same as
# apps/email-listener/Dockerfile). @polytoken/worker is an npm-workspaces package
# (npm, NOT pnpm — CLAUDE.md) with NO workspace dependencies (graphile-worker + pg
# only), so the build needs exactly: the root package.json + package-lock.json (the
# single lockfile npm workspaces maintain) and apps/worker itself.

# --- Build stage ---
FROM node:22-slim AS builder

WORKDIR /build

# Install from the root lockfile, filtered to the worker workspace. Copying ONLY the
# root manifests + the worker manifest keeps this layer cacheable across src-only
# changes. The partial workspace tree is fine: the other `workspaces` entries
# ("packages/*", "apps/web", ...) are globs that simply match nothing when absent
# (verified under npm 10.9.4 — node:22-slim's bundled npm — and npm 11).
# --ignore-scripts: no dep in the worker's tree needs a lifecycle script (pg and
# graphile-worker are pure JS; verified the entrypoint resolves without them).
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
RUN npm ci --workspace=@polytoken/worker --ignore-scripts --no-audit --no-fund

# Plain tsc build per apps/worker/package.json ("build": "tsc") → apps/worker/dist
# (index.js + install-schema.js + tasks.js; src/**/__tests__/** excluded by tsconfig).
COPY apps/worker/tsconfig.json apps/worker/tsconfig.json
COPY apps/worker/src apps/worker/src
RUN npm run build -w @polytoken/worker

# Re-resolve prod-only deps for the runtime copy. npm ci wipes node_modules first,
# so typescript/vitest/@types never reach the runtime stage (~69 packages remain).
RUN npm ci --workspace=@polytoken/worker --omit=dev --ignore-scripts --no-audit --no-fund

# --- Runtime stage ---
FROM node:22-slim

# Security: apply outstanding OS patches (mirrors apps/email-listener/Dockerfile;
# the deploy workflow's Trivy gate blocks CRITICAL/HIGH regardless).
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

# Security: strip the bundled npm CLI from the runtime image — nothing here runs
# npm (CMD is plain node), and npm's own vendored deps (tar, brace-expansion)
# are what trip the Trivy CRITICAL/HIGH gate on node base images.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

# Hoisted prod deps live at /app/node_modules; dist/*.js resolve them by walking up
# the directory tree (verified via a dry entrypoint run against exactly this layout).
COPY --from=builder --chown=node:node /build/node_modules ./node_modules
COPY --from=builder --chown=node:node /build/apps/worker/dist ./apps/worker/dist
COPY --from=builder --chown=node:node /build/apps/worker/package.json ./apps/worker/package.json

# Security: run as the image's built-in unprivileged user (uid 1000, no sudo).
USER node

ENV NODE_ENV=production

# No HEALTHCHECK on purpose: the worker exposes no HTTP surface (it LISTENs on
# Postgres and POSTs to the co-located listener over localhost), and ECS on Fargate
# ignores image HEALTHCHECKs anyway — the task-definition healthCheck is the
# authority, and the runbook (docs/DURABLE-WORKER-RUNBOOK.md §P4) prescribes the
# worker container as `essential = false` with process-liveness only. A fatal boot
# logs `worker_fatal` and exits 1, which surfaces in ECS events/CloudWatch.

# The one-shot schema installer (runbook §P2) ships in this same image — run it with
# a command override: ["node", "apps/worker/dist/install-schema.js"].
CMD ["node", "apps/worker/dist/index.js"]
