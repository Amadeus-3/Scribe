# syntax=docker/dockerfile:1
#
# Single multi-stage image for the Scribe monorepo. Both apps/web (next start)
# and apps/worker (tsx) run from the same `runtime` image; docker-compose picks
# the command per service. Production-style: deps are installed fresh for Linux,
# so host (macOS) binaries never leak in.

FROM node:25-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# openssl + ca-certificates are required by Prisma's query engine at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- deps: cached on manifests + lockfile only ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
# onlyBuiltDependencies (in root package.json) lets esbuild/Prisma/sharp build.
RUN pnpm install --frozen-lockfile

# ---- build: full source, generate Prisma client (Linux engine), build web ----
FROM deps AS build
COPY . .
RUN pnpm db:generate \
    && pnpm --filter @scribe/web build

# ---- runtime: shared by web + worker (command set in docker-compose) ----
FROM build AS runtime
ENV NODE_ENV=production
EXPOSE 3000 3100
