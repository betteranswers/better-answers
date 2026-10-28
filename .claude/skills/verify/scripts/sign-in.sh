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
address="$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$email")"
client="198.19.$((RANDOM % 250)).$((RANDOM % 250))"

field_of() {
  node -e 'const read = require("node:fs").readFileSync(0, "utf8"); console.log(read === "" ? "" : (JSON.parse(read)[process.argv[1]] ?? ""));' "$1"
}
emails_sent() {
  "$here/harness.sh" "$port" GET "/emails?to=$address" | field_of sent
}
settled_off() {
  "${browse[@]}" wait --fn "!$1.test(location.pathname) && document.querySelector('h1') !== null && document.readyState === 'complete'" >/dev/null
}

"${browse[@]}" open "$origin/sign-in" >/dev/null
"${browse[@]}" cookies clear >/dev/null
"${browse[@]}" storage local clear >/dev/null
"${browse[@]}" storage session clear >/dev/null
"${browse[@]}" set headers "{\"cf-connecting-ip\":\"$client\"}" >/dev/null
"${browse[@]}" open "$origin$start" >/dev/null
"${browse[@]}" wait --fn "location.pathname === '/sign-in' && document.querySelector('input[type=email]') !== null" >/dev/null

before="$(emails_sent)"
"${browse[@]}" find label "Email Address" fill "$email" >/dev/null
"${browse[@]}" find role button click --name "Send Code" >/dev/null
for _ in $(seq 40); do
  [[ "$(emails_sent)" -gt "$before" ]] && break
  sleep 0.5
done
[[ "$(emails_sent)" -gt "$before" ]] || { echo "sign-in: no new email reached $email within 20 s" >&2; exit 1; }
"${browse[@]}" wait --fn "[...document.querySelectorAll('input')].some((input) => input.labels !== null && [...input.labels].some((label) => label.textContent.trim() === 'Verification Code'))" >/dev/null

code="$("$here/harness.sh" "$port" GET "/codes?email=$address" | field_of code)"
"${browse[@]}" find label "Verification Code" fill "$code" --exact >/dev/null
settled_off "/^\\/(sign-in)?$/"

pathname="$(node -e 'console.log(new URL(process.argv[1]).pathname)' "$("${browse[@]}" get url)")"
if [[ "$pathname" =~ ^/(confirm|setup)$ ]]; then
  "${browse[@]}" wait --fn "[...document.querySelectorAll('a,button')].some((each) => ['Use a Recovery Code', 'Set Up an Authenticator Instead'].includes(each.textContent.trim()))" >/dev/null
  key="$("$here/harness.sh" "$port" POST /authenticators "{\"email\":\"$email\"}" | field_of key)"
  query="$(node -e 'console.log(new URL(process.argv[1]).search)' "$("${browse[@]}" get url)")"
  "${browse[@]}" open "$origin/confirm$query" >/dev/null
  totp="$(cd "$root/apps/web" && node --input-type=module -e "import { authenticatorCodeAt } from '@better-answers/schema/testing/authenticator-code'; console.log(authenticatorCodeAt(process.argv[1], new Date()));" "$key")"
  "${browse[@]}" find label "Authenticator Code" fill "$totp" --exact >/dev/null
  settled_off "/^\\/(sign-in|confirm|setup)?$/"
fi

echo "signed in as $email from client address $client; the page is at $("${browse[@]}" get url)"
