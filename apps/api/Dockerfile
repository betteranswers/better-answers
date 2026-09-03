# The app tier's image — ONE image, two commands.
#
# `deploy/platform.compose.yaml` runs this image twice: `migrate` overrides the command with
# `pnpm migrate` and runs to completion, then `api` runs this file's `CMD`. That is why pnpm
# is in the runtime stage and why the root manifest and `pnpm-workspace.yaml` ship with it:
# `pnpm migrate` is a root script that filters to this workspace, and a rollback is the
# previous digest of *this* image (`[OPS1]`, ADR 0022), so the two must never skew.
#
# The image also carries `apps/web`'s build. The app serves the SPA on the `app.` hostname
# (ADR 0006, amended 2026-09-02), and `apps/api/src/config.ts` reads it from `WEB_ROOT`,
# whose default resolves to `<repo>/apps/web/dist`. This image keeps the repository's own
# layout under `/app`, so that default is the correct path and the deploy unit sets no fifth
# variable to find the shell.
#
# Nothing is compiled: Node 24 strips types as it loads, and `erasableSyntaxOnly` in
# `tsconfig.base.json` is what keeps that true. The build stages exist for `apps/web` and for
# the production dependency tree, not for `apps/api`.
#
# Base image read from Docker Hub on 03/09/2026 (`[DEPS1]`): `node:24.20.0-bookworm-slim`,
# the current Node 24 line, pinned by the tag's manifest digest as well as its tag — the tag
# is the label a person reads, the digest is what actually ships. Debian rather than Alpine,
# because the lockfile's platform binaries and every test this tier has are resolved against
# glibc today; an image is the wrong place to change a libc.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base

# pnpm's version is the root manifest's `packageManager` field and nowhere else (`[DEPS2]`):
# `corepack install` with no argument reads it, so this image cannot carry a second pin that
# ages alone. The cache is world-readable because the runtime stage runs as `node`, not root.
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install && chmod -R a+rX "$COREPACK_HOME"

# Every workspace manifest, and nothing else, so a source edit does not invalidate the
# install layer. `pnpm-workspace.yaml` lists five projects; the lockfile is checked against
# all of them, so all five are copied even though the runtime needs three.
FROM base AS manifests
# `tsconfig.base.json` joins them because every workspace's tsconfig extends it and vite
# reads the chain at build time. Node needs none of it: type stripping reads no tsconfig,
# which is why the runtime stage below inherits from `base` and not from here.
COPY pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/design-system/package.json packages/design-system/
COPY packages/schema/package.json packages/schema/

# The SPA's build. It needs the dev dependency tree (vite, tailwind, esbuild's platform
# binary — `pnpm-workspace.yaml` allows that one build script), which is exactly why it
# happens in a stage the runtime never inherits from.
FROM manifests AS web
RUN pnpm install --frozen-lockfile
COPY packages/design-system/ packages/design-system/
COPY apps/web/ apps/web/
RUN pnpm --filter @better-answers/web run build

# The production dependency tree, installed from the same frozen lockfile.
#
# `pnpm install --prod --filter @better-answers/api...` rather than `pnpm deploy`: the api
# imports `@better-answers/core` and `@better-answers/schema` through their `exports` maps,
# which point at TypeScript source, and Node will not strip types inside `node_modules`. A
# `pnpm deploy` bundle copies those workspace packages *into* `node_modules`, so every
# `@better-answers/*` import would fail at load. A filtered install keeps them where they
# are — real directories under `/app/packages`, reached by the symlink pnpm writes — and the
# `...` suffix selects the api together with its workspace dependencies and nothing else.
#
# What this does NOT remove, and it is worth knowing: `better-auth` and `@trpc/server` declare
# optional peer dependencies on tooling (drizzle-kit, kysely, react, vitest, typescript), and
# pnpm materialises a resolved peer in the virtual store whether or not `--prod` links it. So
# `node_modules/.pnpm` holds some of those directories. None is reachable from the app: the
# resolution path from `/app/apps/api` is its own `node_modules`, then `/app/node_modules`,
# which holds `.pnpm` and nothing else — which is exactly the property `tests/image.test.ts`
# asserts, rather than asserting on a directory listing that would be a lie either way.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @better-answers/api...

FROM base AS runtime

# wget, because the deploy unit's healthcheck and this image's HEALTHCHECK must be the same
# probe (`deploy/platform.compose.yaml` § api) and node:*-slim carries neither wget nor curl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000

# The repository's own project list — one source for it, not a second copy that ages
# alone (`[DEPS2]`) — plus the one setting that is true of an image and false of a
# checkout. pnpm 11 verifies the dependency tree before `pnpm run` and repairs it by
# installing; this image has no lockfile, no registry credential and no writable /app, so
# that repair can only fail. The tree was built at image build time and is the artefact.
COPY pnpm-workspace.yaml ./
RUN printf '\n# Set by apps/api/Dockerfile: an image never installs.\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=prod-deps /app/packages/schema/node_modules ./packages/schema/node_modules

COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
# The lifted third-party snapshots `src/server.ts` imports (ADR 0005: parts are lifted, not
# depended on), with the notice each one ships under.
COPY apps/api/lifts apps/api/lifts
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/schema/package.json packages/schema/
COPY packages/schema/src packages/schema/src
# `migrationsFolder` (packages/schema/src/index.ts) is this directory; `pnpm migrate` reads it.
COPY packages/schema/migrations packages/schema/migrations
# Where `WEB_ROOT`'s default resolves to, so the SPA is served with no configuration.
COPY --from=web /app/apps/web/dist apps/web/dist

# uid 1000, which is the uid `init` in `deploy/stores.compose.yaml` chowns `/data/git` to;
# nothing here runs as root to own a volume (`[OPS1]`). `node` is that user in this base
# image, and `HOME` is set so pnpm's cache lands somewhere the process can write.
ENV HOME=/home/node
USER node

EXPOSE 3000

# The loopback, so the probe carries no public hostname. There is no fifth hostname variable
# to set: the app's fence holds the loopback (localhost, 127.0.0.1, ::1) as a fixed role
# carrying /health alone (T-030). Do not point this at a hostname — a probe that has to know
# the estate's DNS is a probe that breaks when the DNS changes. /health answers 503 until the
# authorization server is ready, which is what makes `worker`'s wait on `api` mean something
# (ADR 0007). This is the rationale for both copies of the probe: the `api` service in
# `deploy/platform.compose.yaml` runs the same command with the same thresholds, and points here.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/api/src/main.ts"]
