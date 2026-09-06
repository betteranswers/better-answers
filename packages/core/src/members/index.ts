/**
 * Slice: **members** — who is in a workspace, and who they are grouped with. Owns `group`
 * and `group_member` (`groups.ts`, T-060) and, when T-061 lands, `access_request`; it also
 * writes the People acts over `member` and the invitation an approved request mints, which
 * the table-ownership map records as another owner's tables.
 *
 * The entry point is this file (ADR 0029 rule 4: a slice is reached through its
 * `index.ts`), and the acts it names are what T-027's screens and procedures are wired to.
 */
export * from "./groups.ts";
export * from "./requests.ts";
