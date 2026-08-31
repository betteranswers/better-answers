/**
 * Slice: **runs** — the worker control plane as the app sees it. Enqueue, run and
 * heartbeat views, cancel flags.
 *
 * Thin over the SQL protocol functions both tiers call; owns no semantics of its own.
 * The protocol itself is the app↔worker contract, which is `T-020`, not this module.
 */
export {};
