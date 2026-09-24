#!/usr/bin/env bash
set -euo pipefail

# A fixed ULID: every ops command refuses a workspace id that is not one, and DRILL_WORKSPACE names this one.
workspace=01M2SYNTHET1CAAAAAAAAAAAAA
[ "${1:-}" != "--workspace-id" ] || { printf '%s\n' "${workspace}"; exit 0; }

dsn="${1:-${STAGING_DATABASE_URL:-}}"
[ -n "${dsn}" ] || {
  printf 'usage: seed-synthetic.sh <owner DSN>, or STAGING_DATABASE_URL set as the drill sets it; seed-synthetic.sh --workspace-id prints the id alone\n' >&2
  exit 64
}
cases="$(cat "$(dirname "$0")/../contracts/document-chunk/cases.json")"

# Staging must never hold an invented person, nor the sort code this redacted case withholds: that is the seam's input, which no row holds.
PGCLIENTENCODING=UTF8 psql "${dsn}" -v ON_ERROR_STOP=1 -qAt -v cases="${cases}" -v workspace="${workspace}" <<'SQL'
BEGIN;
INSERT INTO workspace (id, name, slug)
  VALUES (:'workspace', 'Synthetic fixture', 'synthetic')
  ON CONFLICT (slug) DO NOTHING;
SELECT set_config('app.workspace_id', :'workspace', true) \g /dev/null
-- Quoted by format: a ULID is upper case, so the partition's name is too.
SELECT create_workspace_partition(:'workspace')
 WHERE to_regclass(format('"index".%I', 'chunk_' || :'workspace')) IS NULL \g /dev/null
CREATE TEMPORARY TABLE fixture ON COMMIT DROP AS SELECT :'cases'::jsonb -> 'document' AS d;
INSERT INTO source_binding (workspace_id, id, name, connector, state)
  SELECT :'workspace', d ->> 'binding_id', 'Synthetic invoice', 'upload', 'indexed' FROM fixture
  ON CONFLICT (workspace_id, id) DO NOTHING;
INSERT INTO source_document
    (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key,
     outcome)
  SELECT :'workspace', d ->> 'source_document_id', d ->> 'binding_id', 'invoice-2026-041.md',
         'invoice-2026-041.md', d ->> 'media_type', octet_length(d ->> 'normalised_text'),
         'uploads/' || lower(d ->> 'binding_id') || '/original', 'converted'
    FROM fixture
  ON CONFLICT (workspace_id, id) DO NOTHING;
INSERT INTO "index".chunk
    (workspace_id, id, binding_id, source_document_id, ordinal, char_start, char_end, locator,
     content)
  SELECT :'workspace', c ->> 'id', d ->> 'binding_id', d ->> 'source_document_id',
         (c ->> 'ordinal')::int, (c ->> 'char_start')::int, (c ->> 'char_end')::int,
         c ->> 'locator', c ->> 'content'
    FROM fixture, jsonb_array_elements(d -> 'chunks') AS c
  ON CONFLICT DO NOTHING;
SELECT format('synthetic fixture present: workspace %s, slug synthetic, %s binding, %s document, %s chunks',
              :'workspace',
              (SELECT count(*) FROM source_binding WHERE workspace_id = :'workspace'),
              (SELECT count(*) FROM source_document WHERE workspace_id = :'workspace'),
              (SELECT count(*) FROM "index".chunk WHERE workspace_id = :'workspace'));
COMMIT;
SQL
