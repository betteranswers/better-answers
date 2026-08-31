/**
 * Slice: **erasure** — erasure requests, suppression, replay on restore (ADRs 0020, 0022).
 *
 * The one slice permitted to import other slices' interfaces, because an erasure is by
 * nature an act over the whole estate. It sits at the top of the slice graph: nothing
 * imports `erasure` (ADR 0029 rule 4).
 */
export {};
