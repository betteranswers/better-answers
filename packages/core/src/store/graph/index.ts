/**
 * The graph door: the AGE query and the delta builder.
 *
 * Emits `access`'s Cypher predicate on **every element of every path**, not on the
 * endpoints alone — a traversal that filters only where it starts and ends leaks the
 * middle (ADR 0023).
 */
export {};
