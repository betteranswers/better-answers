/**
 * The read predicate — published · sensitivity · audience — defined once as data.
 *
 * ADR 0029 rule 2 — `access` imports only `kernel`.
 *
 * The surface: the predicate as data, a SQL renderer, a Cypher renderer, and one shared
 * test corpus asserting both renderers produce identical inclusion sets. Two renderers
 * over one definition is the point; a predicate written twice is a predicate that drifts.
 *
 * Tested against columns on the readable unit — `concept_index`, `composition` and every
 * `index.chunk` row carry `published_at`, `sensitivity` and `audience` — never against
 * three fields of a source binding, because a concept and a composition have no binding
 * (ADR 0023).
 */
export {};
