#!/usr/bin/env bash
# Usage: browse.sh <port> <agent-browser command and arguments>
set -euo pipefail

port="${1:?usage: browse.sh <port> <agent-browser command and arguments>}"
shift
exec agent-browser --session "verify-$port" "$@"
