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
cases="$(cat "$(dirname "$0")/../contracts/document-passage/cases.json")"

# Staging must never hold an invented person, nor the sort code this redacted case withholds: that is the seam's input, which no row holds.
PGCLIENTENCODING=UTF8 psql "${dsn}" -v ON_ERROR_STOP=1 -qAt -v cases="${cases}" -v workspace="${workspace}" <<'SQL'
BEGIN;
INSERT INTO workspace (id, name, short_name)
  VALUES (:'workspace', 'Synthetic fixture', 'synthetic')
  ON CONFLICT (short_name) DO NOTHING;
SELECT set_config('app.workspace_id', :'workspace', true) \g /dev/null
-- Quoted by format: a ULID is upper case, so the partition's name is too.
SELECT create_workspace_partition(:'workspace')
 WHERE to_regclass(format('"index".%I', 'passage_' || :'workspace')) IS NULL \g /dev/null
CREATE TEMPORARY TABLE fixture ON COMMIT DROP AS SELECT :'cases'::jsonb -> 'document' AS d;
INSERT INTO connected_source (workspace_id, id, name, connector, state)
  SELECT :'workspace', d ->> 'connected_source_id', 'Synthetic invoice', 'upload', 'indexed' FROM fixture
  ON CONFLICT (workspace_id, id) DO NOTHING;
INSERT INTO source_document
    (workspace_id, id, connected_source_id, source_system_id, title, media_type, byte_size,
     original_key, outcome)
  SELECT :'workspace', d ->> 'source_document_id', d ->> 'connected_source_id', 'invoice-2026-041.md',
         'invoice-2026-041.md', d ->> 'media_type', octet_length(d ->> 'normalised_text'),
         'uploads/' || lower(d ->> 'connected_source_id') || '/' || lower(d ->> 'source_document_id')
           || '/original', 'converted'
    FROM fixture
  ON CONFLICT (workspace_id, id) DO NOTHING;
INSERT INTO "index".passage
    (workspace_id, id, connected_source_id, source_document_id, ordinal, char_start, char_end, locator,
     content)
  SELECT :'workspace', c ->> 'id', d ->> 'connected_source_id', d ->> 'source_document_id',
         (c ->> 'ordinal')::int, (c ->> 'char_start')::int, (c ->> 'char_end')::int,
         c ->> 'locator', c ->> 'content'
    FROM fixture, jsonb_array_elements(d -> 'passages') AS c
  ON CONFLICT DO NOTHING;
-- Rows alone: no repository holds this commit or these files, so an audit or a map rebuild names each concept's file missing.
\set commit 0000000000000000000000000000000000000000
INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor)
  VALUES (:'workspace', :'commit', '01M2SYNTHET1CC0MM1TAAAAAAA',
          'process:better-answers-synthetic-seed')
  ON CONFLICT DO NOTHING;
-- The invoice answer cites a passage of the unpublished document, so it is Restricted as a write would derive it.
CREATE TEMPORARY TABLE concept ON COMMIT DROP AS
  SELECT 'https://better-answers.com/c/' || c.ulid AS iri, c.*
    FROM fixture, LATERAL (VALUES
      ('01M2SYNTHET1CC0NCEPTAAAAA1', 'answer:invoice-payment-terms', 'knowledge/invoice-payment-terms.md',
       'Answer', 'Invoice payment terms', 'Restricted',
       E'A synthetic fixture answer: an invoice is due on receipt.[^invoice]\n\nSee also [Order delivery times](order-delivery-times.md).\n',
       jsonb_build_array(jsonb_build_object('id', 'invoice', 'title', 'invoice-2026-041.md',
                                            'resource', 'invoice-2026-041.md',
                                            'locator', d -> 'passages' -> 0 ->> 'locator'))),
      ('01M2SYNTHET1CC0NCEPTAAAAA2', 'answer:order-delivery-times', 'knowledge/order-delivery-times.md',
       'Answer', 'Order delivery times', 'Internal',
       E'A synthetic fixture answer: delivery follows within ten working days of a signed order.[^terms]\n\nSee also [Invoice payment terms](invoice-payment-terms.md) and [Bid library](bid-library.md).\n',
       jsonb_build_array(jsonb_build_object('id', 'terms', 'title', 'Synthetic order terms',
                                            'resource', 'synthetic-order-terms.md'))),
      ('01M2SYNTHET1CC0NCEPTAAAAA3', 'note:bid-library', 'knowledge/bid-library.md',
       'Note', 'Bid library', 'Public',
       E'A synthetic fixture note: the bid library holds the invoices and order terms this workspace answers from.\n\nSee also [Order delivery times](order-delivery-times.md).\n',
       '[]'::jsonb)
    ) AS c(ulid, merge_key, path, kind, title, sensitivity, body, sources);
INSERT INTO concept_identity (workspace_id, iri, merge_key)
  SELECT :'workspace', iri, merge_key FROM concept
  ON CONFLICT DO NOTHING;
INSERT INTO concept_index
    (workspace_id, iri, path, kind, title, frontmatter, body, content_hash, commit_sha, status, published_at,
     sensitivity, audience)
  SELECT :'workspace', iri, path, kind, title,
         jsonb_build_object('iri', iri, 'title', title, 'type', kind, 'status', 'stable', 'sources', sources),
         body, encode(sha256(convert_to(body, 'UTF8')), 'hex'), :'commit',
         'stable', now(), sensitivity, 'everyone'
    FROM concept
  ON CONFLICT DO NOTHING;
-- A source with a locator is a passage of the fixture's document; one without names nothing the platform holds.
CREATE TEMPORARY TABLE cited ON COMMIT DROP AS
  SELECT iri, d ->> 'source_document_id' AS document_id, s ->> 'locator' AS locator, s ->> 'resource' AS resource
    FROM concept, fixture, jsonb_array_elements(sources) AS s
   WHERE s ? 'locator';
INSERT INTO evidence (workspace_id, source_document_id, locator, resource)
  SELECT :'workspace', document_id, locator, resource FROM cited
  ON CONFLICT DO NOTHING;
INSERT INTO concept_evidence (workspace_id, iri, source_document_id, locator)
  SELECT :'workspace', iri, document_id, locator FROM cited
  ON CONFLICT DO NOTHING;
SELECT format('synthetic fixture present: workspace %s, short name synthetic, %s connected source, %s document, %s passages, %s concepts',
              :'workspace',
              (SELECT count(*) FROM connected_source WHERE workspace_id = :'workspace'),
              (SELECT count(*) FROM source_document WHERE workspace_id = :'workspace'),
              (SELECT count(*) FROM "index".passage WHERE workspace_id = :'workspace'),
              (SELECT count(*) FROM concept_index WHERE workspace_id = :'workspace'));
COMMIT;
SQL
