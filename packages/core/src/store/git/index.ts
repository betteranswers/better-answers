/**
 * The git door: the governed write to the per-workspace bare repository (ADR 0024).
 *
 * RLS does not reach here, which is why Principal-first-argument is load-bearing rather
 * than decorative — the `Principal` is what carries workspace isolation to this store.
 */
export {};
