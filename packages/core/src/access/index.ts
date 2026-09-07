import type { UserPrincipal } from "../kernel/index.ts";

/**
 * The read predicate — published · sensitivity · audience — defined once as data.
 *
 * ADR 0029 rule 2 — `access` imports only `kernel`.
 *
 * **One definition, one SQL renderer, and no second.** This module once promised a graph
 * (Cypher) renderer beside the SQL one, with a corpus holding the two to identical
 * inclusion sets — that died with the engine: the graph is plain Postgres tables carrying
 * the same three columns as every other readable unit (ADR 0032 superseding ADR 0023's
 * engine), so the one renderer below serves `concept_index`, every `index.chunk` row and
 * the graph's nodes and edges alike, and the graph door's traversal templates interpolate
 * it on every element of every path (T-053). A predicate written twice is a predicate that
 * drifts, which is why the second renderer's death is a simplification and not a gap.
 *
 * Tested against columns on the readable unit — `concept_index`, `composition`, every
 * `index.chunk` row and the graph tables carry `published_at`, `sensitivity` and
 * `audience` — never against three fields of a source binding, because a concept and a
 * composition have no binding (ADR 0023).
 */

/**
 * The class only Admins and named members reach (`CONTEXT.md`, *sensitivity*). It is the
 * one word this module tests for, because the other two classes are readable by any member
 * of the workspace the row is already scoped to.
 */
const RESTRICTED = "Restricted";

/** The audience that means everybody in the workspace (`CONTEXT.md`, *audience*). */
const EVERYONE = "everyone";

/**
 * The SQL a read appends to reach only what this caller may see. Three clauses, one per
 * column, and each **fails closed**:
 *
 * - **published** — a unit with no `published_at` has not entered the company's knowledge
 *   yet and is nobody's to read.
 * - **sensitivity** — *Restricted* reaches Admins and named members; naming members is a
 *   binding-management surface that does not exist (T-055), so today it reaches Admins, and
 *   the day it names members this clause gains the second arm rather than a second copy.
 * - **audience** — *everyone*, or a named-group list this caller's groups overlap. The
 *   group list is `audience_groups` and is T-055's column; until it is there, an audience
 *   that is not *everyone* reaches nobody, which is the fail-closed reading and not an
 *   omission.
 *
 * Rendered rather than composed from strings by the caller, so the three clauses exist in
 * one place; `roleParameter` is the caller's own placeholder number for `principal.role`,
 * because a role interpolated into SQL would be the injection this repository never writes.
 */
export const readableClause = (alias: string, roleParameter: number): string =>
  `${alias}.published_at IS NOT NULL
     AND (${alias}.sensitivity <> '${RESTRICTED}' OR $${roleParameter} = 'Admin')
     AND ${alias}.audience = '${EVERYONE}'`;

/**
 * What the clause's one placeholder is filled with. A function rather than a field read at
 * the call site, because the two have to move together: the day the predicate's third arm
 * takes the caller's group ids as well, every call site keeps working and only this pair
 * changes. A caller that read `principal.role` itself would be a second place to remember.
 */
export const readableParameter = (principal: UserPrincipal): string => principal.role;
