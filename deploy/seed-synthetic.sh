#!/usr/bin/env bash
# Better Answers — the synthetic fixture staging holds outside a drill (`[OPS1]`, ADR 0022, ADR 0024).
#
# Called by `restore-drill.sh` after the wipe, and by hand after a rehearsal, so staging never
# holds a client's data between drills and never stands empty either: the synthetic workspace is
# what ticket 61's prototype and a rehearsal run against. Idempotent — the slug is unique, so a
# second run changes nothing.
#
# What the fixture is today is what the schema holds today: one workspace. No person, no source,
# no concept — those rows land with their slices (T-006 onwards) and this file grows one insert
# per slice, each as free of personal data as this one. A fixture that invented a person would be
# the one thing staging must never hold.
#
# Env: STAGING_DATABASE_URL — the owner DSN of the staging database (the same the drill migrates with).
set -euo pipefail
: "${STAGING_DATABASE_URL:?the owner DSN of the staging database}"

psql "${STAGING_DATABASE_URL}" -v ON_ERROR_STOP=1 -qc "
  insert into workspace (id, name, slug)
  values ('ws_synthetic', 'Synthetic (staging fixture)', 'synthetic')
  on conflict (slug) do nothing;"
printf 'synthetic fixture present: workspace slug=synthetic\n'
