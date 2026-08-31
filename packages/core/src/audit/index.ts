/**
 * The one append-only ledger: the typed event vocabulary and one write function.
 *
 * ADR 0029 rule 3 — imports `kernel`, `access` and `store`; never a slice, never `llm`.
 * One write function rather than one per slice is what keeps the vocabulary typed and
 * the ledger a single source of truth.
 */
export {};
