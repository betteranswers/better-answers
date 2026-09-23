export const A_MEMBER =
  "INSERT INTO member (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, now())";

export const AN_INVITATION = `INSERT INTO invitation (id, workspace_id, email, role, expires_at, inviter_id)
       VALUES ($1, $2, 'x@example.invalid', $3, now(), $4)`;

export const A_LEDGER_ROW = `INSERT INTO audit_event (id, workspace_id, act, actor, subject_id, detail)
       VALUES ($1, $2, $3, $4, $5, '{}')`;

export const THE_FAMILY_AND_SUBJECT_IT_LANDS_IN = "RETURNING family, subject_kind";

export const THE_DETAIL_EDITED = `ON CONFLICT (id) DO UPDATE SET detail = '{"edited": true}'`;

export const A_LEDGER_ROW_WITH_ITS_FAMILY = `INSERT INTO audit_event (id, workspace_id, act, family, actor, subject_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6, '{}')`;

export const A_GROUP = `INSERT INTO "group" (id, workspace_id, name, origin) VALUES ($1, $2, $3, 'admin-curated')`;

export const A_GROUP_MEMBERSHIP =
  "INSERT INTO group_member (workspace_id, group_id, user_id) VALUES ($1, $2, $3)";

export const AN_ACCESS_REQUEST =
  "INSERT INTO access_request (id, workspace_id, requester_id, reason) VALUES ($1, $2, $3, 'let me in')";

export const A_DECIDED_ACCESS_REQUEST = `INSERT INTO access_request
         (id, workspace_id, requester_id, reason, status, decided_at, decided_by, invitation_id)
       VALUES ($1, $2, $3, 'why', $4, $5, $6, $7)`;

export const A_CONCEPT_IDENTITY =
  "INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, 'policy:theirs')";

export const A_CONCEPT_VERIFICATION = `INSERT INTO concept_verification (id, workspace_id, iri, actor, content_hash)
       VALUES ($1, $2, $3, 'process:better-answers-test', $4)`;

export const A_CONCEPT_VERIFICATION_OF_ORIGIN = `INSERT INTO concept_verification
         (id, workspace_id, iri, actor, origin, content_hash)
       VALUES ($1, $2, $3, 'process:better-answers-test', $4, $5)`;

export const A_CONCEPT_INDEX_ROW = `INSERT INTO concept_index
         (workspace_id, iri, path, kind, title, frontmatter, body, content_hash, commit_sha,
          audience, status, sensitivity, published_at)
       VALUES ($1, $2, $3, 'Policy', 'Expenses', '{}'::jsonb, 'body', $4, $5,
               'everyone', $6, $7, $8)`;

export const A_BUNDLE_COMMIT = `INSERT INTO bundle_commit (workspace_id, sha, audit_event_id, actor)
       VALUES ($1, $2, $3, 'process:better-answers-reconciler')`;

export const A_BUNDLE_COMMIT_WITH_A_PARENT = `INSERT INTO bundle_commit (workspace_id, sha, parent_sha, audit_event_id, actor)
       VALUES ($1, $2, $3, $4, 'process:better-answers-reconciler')`;

export const A_GRAPH_NODE =
  "INSERT INTO graph_node (workspace_id, gen, uid, label) VALUES ($1, $2, $3, $4)";

export const A_GRAPH_NODE_OF_KIND =
  "INSERT INTO graph_node (workspace_id, gen, uid, label, kind) VALUES ($1, $2, $3, $4, $5)";

export const A_GRAPH_NODE_CLASSED =
  "INSERT INTO graph_node (workspace_id, gen, uid, label, sensitivity) VALUES ($1, $2, $3, $4, $5)";

export const AN_EDGE = `INSERT INTO graph_edge (workspace_id, gen, uid, label, from_uid, to_uid)
       VALUES ($1, $2, $3, $4, $5, $6)`;

export const AN_EDGE_CARRYING_A_SENTENCE = `INSERT INTO graph_edge
         (workspace_id, gen, uid, label, from_uid, to_uid, sentence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`;

export const A_GRAPH_GENERATION =
  "INSERT INTO graph_generation (workspace_id, live_gen) VALUES ($1, $2)";

export const THE_GENERATION_ROW_HELD =
  "ON CONFLICT (workspace_id) DO UPDATE SET live_gen = graph_generation.live_gen";

export const A_SUGGESTION =
  "INSERT INTO suggestion (workspace_id, id, set_id, kind, proposer) VALUES ($1, $2, $3, $4, $5)";

export const A_DECIDED_SUGGESTION = `INSERT INTO suggestion
         (workspace_id, id, set_id, kind, proposer, status, decider, decided_at, reason, target_iri)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

export const A_CONCEPT_WRITE_REQUEST = `INSERT INTO concept_write_request
         (workspace_id, suggestion_id, merge_key, path, concept_kind, title, frontmatter, body)
       VALUES ($1, $2, 'policy:big', 'knowledge/big.md', 'Policy', 'Big', '{}'::jsonb, $3)`;

export const ONE_CALL_AGAINST_A_TOKEN = `INSERT INTO mcp_call_counter (workspace_id, token_id, window_start, count)
       VALUES ($1, 'jti-1', now(), 1)`;

export const A_SOURCE_BINDING =
  "INSERT INTO source_binding (workspace_id, id, name, connector) VALUES ($1, $2, $3, 'upload')";

export const A_SOURCE_BINDING_CLASSED = `INSERT INTO source_binding (workspace_id, id, name, connector, sensitivity, audience)
       VALUES ($1, $2, $3, 'upload', 'Restricted', 'everyone')`;

export const A_SOURCE_DOCUMENT = `INSERT INTO source_document
         (workspace_id, id, binding_id, source_system_id, title, media_type, byte_size, original_key)
       VALUES ($1, $2, $3, $4, $5, 'text/markdown', $6, 'documents/x/original')`;

export const A_COMPOSITION_INCLUDE = `INSERT INTO composition_include (workspace_id, composition_id, id, ordinal, iri)
       VALUES ($1, $2, 'i9', 9, $3)`;

export const A_CONCEPT_CLASS_OVERRIDE = `INSERT INTO concept_class_override
         (workspace_id, iri, sensitivity, audience, actor, audit_event_id)
       VALUES ($1, $2, $3, 'everyone', $4, $5)`;

export const A_CITATION = `INSERT INTO concept_evidence (workspace_id, iri, source_document_id, locator)
       VALUES ($1, $2, $3, 'p.99')`;

export const A_FINDING = `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                            char_start, char_end, score, rule_version, detector_pin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

export const REFRESH_THE_READING = `ON CONFLICT (workspace_id, document_id, rule_id, char_start, char_end)
  DO UPDATE SET category = EXCLUDED.category,
                tier = CASE WHEN finding.restored_at IS NULL THEN EXCLUDED.tier ELSE finding.tier END,
                score = EXCLUDED.score,
                rule_version = EXCLUDED.rule_version,
                detector_pin = EXCLUDED.detector_pin
  WHERE (finding.category, finding.score, finding.rule_version, finding.detector_pin)
        IS DISTINCT FROM
        (EXCLUDED.category, EXCLUDED.score, EXCLUDED.rule_version, EXCLUDED.detector_pin)
     OR (finding.restored_at IS NULL AND finding.tier IS DISTINCT FROM EXCLUDED.tier)`;

export const A_FINDING_BORN_REVIEWED = `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                review_state, reviewed_by, reviewed_at)
           VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                   30, 38, 0.9, 'r1', 'd1', 'kept-in-text', 'process:better-answers-test', now())`;

export const A_FINDING_BORN_RESTORED = `INSERT INTO finding (workspace_id, id, document_id, category, tier, rule_id,
                                char_start, char_end, score, rule_version, detector_pin,
                                restored_at, restored_by, restore_reason)
           VALUES ($1, $2, $3, 'bank-details', 'always', 'sort-code-with-account-number',
                   40, 48, 0.9, 'r1', 'd1', now(), 'process:better-answers-test', 'let it stand')`;

export const A_SUBJECT_REQUEST = `INSERT INTO subject_request (workspace_id, id, kind, identifiers, received_at,
                                        clock_started_at, due_at)
           VALUES ($1, $2, 'erasure', '{"emails": [], "names": [], "other": []}'::jsonb,
                   now(), now(), now() + interval '1 month')`;

export const AN_ERASURE_ROUTINE = `INSERT INTO erasure_request (workspace_id, id, subject_request_id, pseudonym,
                                        locked_at, anchored_at, beyond_use_hourly_at,
                                        beyond_use_daily_at, beyond_use_weekly_at,
                                        beyond_use_monthly_at)
           VALUES ($1, $2, $3, $4, now(), now(), now() + interval '2 days',
                   now() + interval '30 days', now() + interval '8 weeks',
                   now() + interval '6 months')`;

export const A_SUPPRESSION = `INSERT INTO suppression (workspace_id, erasure_request_id, document_id, identifiers)
                      VALUES ($1, $2, $3, $4::jsonb)`;

export const A_MIGRATION_STAMP =
  "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('x', 1)";

export const A_CONTRACT_STAMP =
  "INSERT INTO contract_stamp (only_row, digest) VALUES (true, 'a-contract-nobody-deployed')";
