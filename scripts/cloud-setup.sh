#!/usr/bin/env bash
set -euo pipefail
REPO=/home/user/better-answers
export PATH="/root/.local/bin:$PATH"
T=$SECONDS
took() { echo "setup: $1 took $((SECONDS - T))s (total ${SECONDS}s)"; T=$SECONDS; }

# Node: the newest release of the major .node-version names, as CI's setup-node reads it
MAJOR=$(cat "$REPO/.node-version")
V=$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c "import json,sys;print(next(r['version'] for r in json.load(sys.stdin) if r['version'].startswith('v$MAJOR.')))")
curl -fsSL "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz" | tar -xJ -C /opt
ln -sfn "/opt/node-$V-linux-x64" /opt/node24
mkdir -p /root/.local/bin
for b in node npm npx corepack; do ln -sf "/opt/node24/bin/$b" /root/.local/bin/; done
took node

apt-get install -y gh
took gh

# git-filter-repo at the version apps/api/Dockerfile pins, read rather than restated
GFR=$(sed -n 's/^ARG GIT_FILTER_REPO_VERSION=//p' "$REPO/apps/api/Dockerfile")
uv tool install "git-filter-repo==$GFR"
took git-filter-repo

docker info >/dev/null 2>&1 || (nohup dockerd >/var/log/dockerd.log 2>&1 &)

# pnpm at the version package.json pins; the install also installs the git hooks
cd "$REPO"
corepack enable --install-directory /root/.local/bin
pnpm install --frozen-lockfile
took "pnpm install"

export HF_HOME=/root/.cache/huggingface
cd "$REPO/apps/worker"
uv sync --frozen
took "uv sync"
uv run --frozen python -c 'from better_answers_worker.redaction.weights import fetch; fetch()' \
  || echo "setup: WARNING the detector's weights did not download; only the detector's tests will fail" >&2
took weights

cd "$REPO"
npx -y gitnexus@latest analyze || echo "setup: WARNING gitnexus analyze failed; run it by hand" >&2
took "gitnexus analyze"

# Compound Engineering: a cloud session never adds the marketplaces .claude/settings.json lists,
# and the CLI takes no ref, so this installs the marketplace's newest release, not the pinned one
if command -v claude >/dev/null 2>&1 \
  && claude plugin marketplace add EveryInc/compound-engineering-plugin \
  && claude plugin install compound-engineering@compound-engineering-plugin; then
  took "compound engineering"
else
  echo "setup: WARNING Compound Engineering did not install; run /plugin install by hand" >&2
fi