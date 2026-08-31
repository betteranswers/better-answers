/**
 * The four doors, one per shared store (ADR 0005), and the only place in the platform
 * where a connection is constructed.
 *
 * ADR 0029 rule 2 — `store` imports only `kernel`. And the rule with teeth on size:
 * **a store file may not import another store file**. A line ceiling rides along as a
 * warning, because a ceiling alone is a proxy that splitting a file games.
 *
 * This entry point exists for the **composition root** — `apps/api`'s bootstrap, which
 * has to build the handles and hand them to the slices. A request handler reaches a
 * store through the slice that owns the act, never through this export.
 */
export {};
