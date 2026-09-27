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

/opt/node24/bin/npm i -g @frehilm/ordna-cli && ln -sf /opt/node24/bin/ordna /root/.local/bin/
apt-get install -y gh
took "ordna and gh"

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