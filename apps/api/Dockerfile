# `deploy/platform.compose.yaml` runs this image twice. The `migrate` service runs `pnpm migrate`,
# and the `api` service runs `CMD`. The runtime stage keeps pnpm, the root manifest, and
# `pnpm-workspace.yaml` because `pnpm migrate` is a root script.
#
# Node 24 strips types as it loads, so no stage compiles `apps/api`. `erasableSyntaxOnly` in
# `tsconfig.base.json` keeps the source strippable.
#
# The base is Debian, not Alpine, because the lockfile's platform binaries and this tier's tests
# resolve against glibc. It is Debian 13 because Debian 12 has moved to its long-term-support
# team, which patches fewer packages.
FROM node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c AS base

# `corepack install` reads the pnpm version from the root manifest's `packageManager` field, so
# this file does not pin pnpm. The cache is world-readable because the runtime runs as `node`.
#
# pnpm 12 fetches its native binary on its first run. `pnpm --version` is that first run, as root,
# so the binary lands in the cache before the cache becomes read-only. `--pm-on-fail=ignore`
# stops pnpm 12 from writing a root-owned `pnpm-lock.yaml` under /app that the runtime cannot read.
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json ./
RUN corepack enable && corepack install && pnpm --pm-on-fail=ignore --version \
 && chmod -R a+rX "$COREPACK_HOME"

# This stage copies only the workspace manifests, so a source edit does not invalidate the
# install layer. pnpm checks the lockfile against all six projects in `pnpm-workspace.yaml`, so
# all six manifests are copied, although the runtime needs four.
FROM base AS manifests
# Every workspace tsconfig extends `tsconfig.base.json`, and vite reads it at build time. The
# runtime stage builds on `base`, not on this stage, because type stripping reads no tsconfig.
COPY pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
# `pnpm install` refuses to start without the patch files that `patchedDependencies` in
# `pnpm-workspace.yaml` names.
COPY patches/ patches/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/design-system/package.json packages/design-system/
COPY packages/devtools/package.json packages/devtools/
COPY packages/schema/package.json packages/schema/

# The SPA build needs the dev dependencies, so it runs in a stage the runtime does not inherit.
FROM manifests AS web
RUN pnpm install --frozen-lockfile
COPY packages/design-system/ packages/design-system/
# The SPA imports its id minter from the schema package.
COPY packages/schema/src packages/schema/src
COPY apps/web/ apps/web/
RUN pnpm --filter @better-answers/web run build

# This stage uses a filtered install, not `pnpm deploy`. `pnpm deploy` copies the workspace
# packages into `node_modules`, their `exports` maps point at TypeScript source, and Node does
# not strip types inside `node_modules`. The `...` suffix selects the api and its workspace
# dependencies: core, schema, and design-system.
#
# `--prod` still installs the optional peers that any workspace brings, so `better-auth`'s
# peers on drizzle-kit, vitest, and react would ship with their build tools. An `overrides`
# removal leaves an optional peer in place, and Renovate locks with `--ignore-pnpmfile`, so
# neither the lockfile nor a pnpmfile hook can drop them. The script below deletes every store
# entry that the api's dependencies and required peers do not reach. Every optional peer the api
# loads is also reached through its dependencies, so no deleted package is loaded.
# The script keeps required peers. `tests/images/image.test.ts` fails on a kept peer, and a
# person must then declare it or override it away.
FROM manifests AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @better-answers/api...
RUN node --input-type=module <<'JS'
import { existsSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

const store = realpathSync("node_modules/.pnpm");
const entryOf = (directory) => path.relative(store, directory).split(path.sep)[0];
const namesIn = (modules) =>
  readdirSync(modules).flatMap((entry) =>
    entry.startsWith("@")
      ? readdirSync(path.join(modules, entry)).map((name) => `${entry}/${name}`)
      : [entry],
  );

const installed = ["apps", "packages"]
  .flatMap((parent) => readdirSync(parent).map((workspace) => `${parent}/${workspace}/node_modules`))
  .filter((modules) => existsSync(modules));
const reached = new Set();
const pending = installed.flatMap((modules) =>
  namesIn(modules).map((name) => realpathSync(`${modules}/${name}`)),
);
while (pending.length > 0) {
  const directory = pending.pop();
  if (reached.has(directory) || !directory.startsWith(`${store}${path.sep}`)) continue;
  reached.add(directory);
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  const peerMeta = manifest.peerDependenciesMeta ?? {};
  const names = [
    ...Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }),
    ...Object.keys(manifest.peerDependencies ?? {}).filter((name) => !peerMeta[name]?.optional),
  ];
  for (const name of names) {
    const link = path.join(store, entryOf(directory), "node_modules", name);
    if (existsSync(link)) pending.push(realpathSync(link));
  }
}

const kept = new Set([...reached].map(entryOf));
for (const entry of readdirSync(store, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== "node_modules" && !kept.has(entry.name)) {
    rmSync(path.join(store, entry.name), { recursive: true });
  }
}
JS

FROM base AS runtime

# The HEALTHCHECK below runs wget and must match the probe in `deploy/platform.compose.yaml`.
# The slim base image has neither wget nor curl.
#
# The api is the only process that writes a workspace's git repository, so it needs git. The
# erasure routine rewrites history with `git filter-repo`, which needs Python.
#
# git-filter-repo comes from PyPI at an exact version, not from apt, so the image, the CI runner,
# and developer machines run the same tested version. `.github/actions/git-filter-repo` and
# `scripts/cloud-setup.sh` read the version from the `ARG` line below.
# `--break-system-packages` is safe because pip installs under /usr/local, which apt does not
# manage. pip is purged in the same layer, and `apps/api/tests/images/image.test.ts` checks
# that the tool survived the purge.
#
# The custom manager in `renovate.json` reads the `# renovate:` line only when it sits directly
# above the `ARG`.
# renovate: datasource=pypi depName=git-filter-repo
ARG GIT_FILTER_REPO_VERSION=2.47.0
# `apt-get install` leaves a package the base already has at the base's version, so
# `apt-get upgrade` applies its security updates.
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends wget git python3 python3-pip \
 && pip3 install --no-cache-dir --break-system-packages \
      "git-filter-repo==${GIT_FILTER_REPO_VERSION}" \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000

# This image runs pnpm through corepack and never calls npm or npx. Deleting npm removes its
# dependency tree from image scans. The build stages keep npm because they do not ship.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# This copies the repository's `pnpm-workspace.yaml` and appends two settings for the image. The
# has no lockfile, no registry credential, and no writable /app, so any pnpm install fails here.
# `verifyDepsBeforeRun: false` stops pnpm from reinstalling before `pnpm run`.
# `pmOnFail: ignore` stops pnpm 12 from resolving its own version from the registry before each
# command, which fails `pnpm migrate` after about 70 seconds of retries.
COPY pnpm-workspace.yaml ./
# pnpm commands read the patch paths in `pnpm-workspace.yaml`, so the files must exist even
# though nothing installs here.
COPY patches/ patches/
RUN printf '\n# Set by apps/api/Dockerfile: an image never installs, and corepack picks pnpm.\nverifyDepsBeforeRun: false\npmOnFail: ignore\n' >> pnpm-workspace.yaml

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/core/node_modules ./packages/core/node_modules
# `src/auth/page-style.ts` serves the design system's fonts to the api's pages.
# `tests/images/image.test.ts` follows this link.
COPY --from=prod-deps /app/packages/design-system/node_modules ./packages/design-system/node_modules
COPY --from=prod-deps /app/packages/schema/node_modules ./packages/schema/node_modules

COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
# `src/server.ts` imports these third-party snapshots. Each keeps its licence notice.
COPY apps/api/lifts apps/api/lifts
COPY packages/core/package.json packages/core/
COPY packages/core/src packages/core/src
# The api's pages inline the logo, the stylesheet, and the tokens the stylesheet imports.
COPY packages/design-system/package.json packages/design-system/styles.css packages/design-system/
COPY packages/design-system/assets packages/design-system/assets
COPY packages/design-system/tokens packages/design-system/tokens
COPY packages/schema/package.json packages/schema/
COPY packages/schema/src packages/schema/src
# `pnpm migrate` reads this directory. `migrationsFolder` in `packages/schema/src/index.ts` names it.
COPY packages/schema/migrations packages/schema/migrations
# The image keeps the repository layout under /app, so the default `WEB_ROOT` in
# `apps/api/src/config.ts` resolves to this path and the deploy unit sets no variable for it.
COPY --from=web /app/apps/web/dist apps/web/dist

# `init` in `deploy/stores.compose.yaml` chowns `/data/git` to uid 1000, which is the `node`
# user in this base image. `HOME` gives pnpm a writable cache directory.
ENV HOME=/home/node
USER node

EXPOSE 3000

# The probe uses the loopback, so it needs no public hostname. On the loopback the api answers
# /health and nothing else. /health returns 503 until the authorization server is ready, and the
# `worker` service's wait on `api` depends on that. The `api` service in
# `deploy/platform.compose.yaml` runs the same probe with the same thresholds, so change both together.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=12 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/api/src/main.ts"]
