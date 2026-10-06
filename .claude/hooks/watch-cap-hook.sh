#!/usr/bin/env bash
set -uo pipefail

SAID="$(bash "$(dirname "${BASH_SOURCE[0]}")/../../scripts/jdocmunch-watch-cap.sh" --check)" && exit 0
jq -n --arg said "$SAID" '{systemMessage: $said}'
