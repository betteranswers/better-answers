#!/usr/bin/env bash
# Usage: doctor.sh <port>
set -uo pipefail

port="${1:?usage: doctor.sh <port>}"
root="$(cd "$(dirname "$0")/../../../.." && pwd)"
state="${VERIFY_HOME:-/tmp/better-answers-verify}/$port"
origin="http://localhost:$port"

refuse() {
  echo "not worth driving: $1"
  exit 1
}

for tool in lsof curl node; do
  command -v "$tool" >/dev/null || refuse "$tool is not on PATH"
done
command -v agent-browser >/dev/null \
  || refuse "agent-browser is not on PATH. Install it with npm install -g agent-browser && agent-browser install"
[[ -f "$state/server.pid" ]] || refuse "this skill launched nothing on port $port; run launch.sh $port"
pid="$(cat "$state/server.pid")"
kill -0 "$pid" 2>/dev/null \
  || refuse "server pid $pid has exited; the last lines of $state/server.log, which may predate the exit: $(tail -n 3 "$state/server.log" | tr '\n' ' ')"
listener="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
[[ "$listener" == "$pid" ]] \
  || refuse "port $port is held by pid ${listener:-nobody}, not by pid $pid, which launch.sh started"
health="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$origin/health" || true)"
[[ "$health" == "200" ]] || refuse "$origin/health answered ${health:-nothing}, not 200"
harness="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$origin/__harness/emails?to=doctor@example.test" || true)"
[[ "$harness" == "200" ]] || refuse "$origin/__harness answered ${harness:-nothing}, so the harness is not mounted"
built="$root/apps/web/dist/index.html"
[[ -f "$built" ]] || refuse "apps/web has no build; run cleanup.sh $port, then launch.sh $port"
page="$(find "$root/apps/web/src" "$root/apps/web/index.html" "$root/apps/web/public" "$root/apps/web/vite.config.ts" \
  "$root/packages/schema/src" "$root/packages/design-system/tokens" "$root/packages/design-system/assets" \
  "$root/packages/design-system/styles.css" \
  -type f -newer "$built" 2>/dev/null | head -n 1)"
[[ -z "$page" ]] \
  || refuse "$page changed after the SPA was built; run cleanup.sh $port, then launch.sh $port"
server="$(find "$root/apps/api/src" "$root/apps/api/tests/serve.ts" "$root/apps/api/tests/support" \
  "$root/packages/core/src" "$root/packages/core/test/support" "$root/packages/core/test/fixtures" "$root/packages/schema/src" \
  -type f -newer "$state/server.pid" 2>/dev/null | head -n 1)"
[[ -z "$server" ]] \
  || refuse "$server changed after the server started; run cleanup.sh $port, then launch.sh $port --no-build"

echo "worth driving: $origin, pid $pid"
