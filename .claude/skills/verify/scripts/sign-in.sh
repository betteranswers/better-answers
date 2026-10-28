#!/usr/bin/env bash
# Usage: sign-in.sh <port> <email> [path to open first, default /sign-in]
set -euo pipefail

port="${1:?usage: sign-in.sh <port> <email> [path]}"
email="${2:?usage: sign-in.sh <port> <email> [path]}"
start="${3:-/sign-in}"

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
origin="http://localhost:$port"
browse=(agent-browser --session "verify-$port")

field_of() {
  node -e 'const answer = JSON.parse(require("node:fs").readFileSync(0, "utf8")); console.log(answer[process.argv[1]] ?? "");' "$1"
}
path_now() {
  node -e 'console.log(new URL(process.argv[1]).pathname)' "$("${browse[@]}" get url)"
}

"${browse[@]}" open "$origin$start" >/dev/null
"${browse[@]}" find label "Email Address" fill "$email" >/dev/null
"${browse[@]}" find role button click --name "Send Code" >/dev/null

code=""
for _ in $(seq 20); do
  code="$("$here/harness.sh" "$port" GET "/codes?email=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$email")" 2>/dev/null | field_of code || true)"
  [[ -n "$code" ]] && break
  sleep 0.5
done
[[ -n "$code" ]] || { echo "sign-in: the captured transport holds no code for $email" >&2; exit 1; }
"${browse[@]}" find label "Verification Code" fill "$code" --exact >/dev/null
"${browse[@]}" wait --fn "location.pathname !== '/sign-in'" >/dev/null
"${browse[@]}" wait --fn "document.querySelector('h1') !== null" >/dev/null

if [[ "$(path_now)" =~ ^/(confirm|setup)$ ]]; then
  "${browse[@]}" wait --fn "[...document.querySelectorAll('a,button')].some((each) => ['Use a Recovery Code', 'Set Up an Authenticator Instead'].includes(each.textContent.trim()))" >/dev/null
  key="$("$here/harness.sh" "$port" POST /authenticators "{\"email\":\"$email\"}" | field_of key)"
  query="$(node -e 'console.log(new URL(process.argv[1]).search)' "$("${browse[@]}" get url)")"
  "${browse[@]}" open "$origin/confirm$query" >/dev/null
  totp="$(node --input-type=module -e "import { authenticatorCodeAt } from '$root/packages/schema/test/people/authenticator-code.ts'; console.log(authenticatorCodeAt(process.argv[1], new Date()));" "$key")"
  "${browse[@]}" find label "Authenticator Code" fill "$totp" --exact >/dev/null
  "${browse[@]}" wait --fn "!/^\\/(confirm|setup)$/.test(location.pathname)" >/dev/null
fi

echo "signed in as $email; the page is at $("${browse[@]}" get url)"
