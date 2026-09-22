#!/usr/bin/env bash
set -euo pipefail
: "${STAGING_DATABASE_URL:?the owner DSN of the staging database}"

psql "${STAGING_DATABASE_URL}" -v ON_ERROR_STOP=1 -qc "
  insert into workspace (id, name, slug)
  values ('ws_synthetic', 'Synthetic (staging fixture)', 'synthetic')
  on conflict (slug) do nothing;"
printf 'synthetic fixture present: workspace slug=synthetic\n'
