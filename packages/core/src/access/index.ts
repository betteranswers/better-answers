import {
  AUDIENCE_EVERYONE,
  AUDIENCE_GROUPS,
  boundarySchemas,
  type SENSITIVITIES,
} from "@better-answers/schema";

import type { GroupId, Role, UserPrincipal } from "../kernel/index.ts";

/**
 * The read predicate — published · sensitivity · audience — defined once as data, and the
 * rules that derive the columns it reads (ADR 0013, ADR 0023, ADR 0039).
 *
 * ADR 0029 rule 2 — `access` imports only `kernel` (and the boundary package, which is not
 * `core`, for the closed word sets it narrows to).
 *
 * **One definition, one SQL renderer, and no second.** This module once promised a graph
 * (Cypher) renderer beside the SQL one, with a corpus holding the two to identical
 * inclusion sets — that died with the engine: the graph is plain Postgres tables carrying
 * the same three columns as every other readable unit (ADR 0032 superseding ADR 0023's
 * engine), so the one renderer below serves `concept_index`, `composition`, every
 * `index.chunk` row and the graph's nodes and edges alike, and the graph door's traversal
 * templates interpolate it on every element of every path (T-053). A predicate written
 * twice is a predicate that drifts, which is why the second renderer's death is a
 * simplification and not a gap.
 *
 * Tested against columns on the readable unit — `concept_index`, `composition`, every
 * `index.chunk` row and the graph tables carry `published_at`, `sensitivity`, `audience`
 * and `audience_groups` — never against three fields of a source binding, because a
 * concept and a composition have no binding (ADR 0023).
 *
 * **The write side of the same question lives here too.** A concept's class is derived —
 * the most restrictive among the bindings of the evidence it cites, a composition's the
 * most restrictive among its includes — and an audience is combined by intersection with
 * *everyone* as the identity (ADR 0023, ADR 0039). What the predicate is applied against
 * and what decides the columns it reads are two halves of one answer to *who may see
 * this*, so the combining rules sit beside the renderer: a second home for either would be
 * a place for the two to drift. The slices that own the rows call these; nothing here
 * touches a store.
 */

/** A unit's confidentiality class (`CONTEXT.md`, *sensitivity*): the glossary's closed set. */
export type Sensitivity = (typeof SENSITIVITIES)[number];

/**
 * An audience as every readable unit holds it (ADR 0039): the word, and with *groups* the
 * ids of the named groups — at least one, because an empty list is not a representable
 * audience (the combining rule forces the unit Restricted instead of storing one).
 */
export type Audience =
  | { readonly audience: typeof AUDIENCE_EVERYONE; readonly audienceGroups: null }
  | { readonly audience: typeof AUDIENCE_GROUPS; readonly audienceGroups: readonly GroupId[] };

/** What the predicate reads off a unit beside `published_at`: its class and its audience. */
export type Visibility = { readonly sensitivity: Sensitivity } & Audience;

/**
 * The class only Admins and named members reach (`CONTEXT.md`, *sensitivity*). It is the
 * one word the predicate tests for, because the other two classes are readable by any
 * member of the workspace the row is already scoped to.
 */
const RESTRICTED = "Restricted" satisfies Sensitivity;

/** Everybody in the workspace — what a unit is born with, and the combining rule's identity. */
export const EVERYONE = { audience: AUDIENCE_EVERYONE, audienceGroups: null } as const;

/**
 * Admins and nobody else: the most restrictive visibility there is, and what an empty
 * intersection forces (ADR 0039) — never stored as an empty group list.
 */
export const RESTRICTED_TO_ADMINS: Visibility = { sensitivity: RESTRICTED, ...EVERYONE };

/**
 * The SQL a read appends to reach only what this caller may see. Three clauses, one per
 * column, and each **fails closed**:
 *
 * - **published** — a unit with no `published_at` has not entered the company's knowledge
 *   yet and is nobody's to read, Admins included.
 * - **sensitivity** — *Restricted* reaches Admins and named members; naming members on a
 *   binding is a management surface that does not exist (B7), so today it reaches Admins,
 *   and the day it names members this clause gains the second arm rather than a second copy.
 * - **audience** — *everyone*, or a named-group list this caller's groups overlap (`&&`).
 *   The overlap is tested against `audience_groups` and fails closed at every edge: an empty
 *   caller list overlaps nothing, a NULL list overlaps nothing, and a group deleted since
 *   the row was written is an id no caller holds — the content narrows, never widens (ADR
 *   0038). The clauses are conjoined, so an audience narrows a Restricted unit's Admins as
 *   it narrows an Internal unit's members: fewer readers on every term, never more.
 *
 * Rendered rather than composed from strings by the caller, so the three clauses exist in
 * one place. `at` is the caller's own placeholder number for the first of the **two**
 * parameters the clause reads — the role at `$at`, the group ids at `$at + 1` — because a
 * role or a group id interpolated into SQL would be the injection this repository never
 * writes; `readableParameters` is what fills them, in that order.
 */
export const readableClause = (alias: string, at: number): string =>
  `${alias}.published_at IS NOT NULL
     AND (${alias}.sensitivity <> '${RESTRICTED}' OR $${at} = 'Admin')
     AND (${alias}.audience = '${AUDIENCE_EVERYONE}' OR ${alias}.audience_groups && $${at + 1}::text[])`;

/**
 * What the clause's two placeholders are filled with, in the order the clause reads them:
 * the caller's role, then every group they are in here — re-read on this call by the
 * resolver, never carried on a credential (ADR 0009). A function rather than two field
 * reads at the call site, because the pair has to move with the clause: a caller that read
 * `principal.role` and `principal.groups` itself would be a second place to remember.
 */
export const readableParameters = (
  principal: UserPrincipal,
): readonly [Role, readonly GroupId[]] => [principal.role, principal.groups];

/** Wider to narrower: the order *most restrictive* is measured along. */
const RANK = { Public: 2, Internal: 1, Restricted: 0 } as const satisfies Record<
  Sensitivity,
  number
>;

/** The narrower of two classes. */
export const narrower = (one: Sensitivity, other: Sensitivity): Sensitivity =>
  RANK[one] <= RANK[other] ? one : other;

/**
 * Audiences combine by **intersection**, with *everyone* as the identity (ADR 0039): a unit
 * for everyone narrowed by one for the HR group is for the HR group, and one for HR narrowed
 * by one for Sales is for nobody. `"nobody"` — the empty intersection — is a real state and
 * never a stored one: the caller forces the unit Restricted, so two disjoint audiences never
 * accidentally union into visibility and never leave an empty list the row's CHECK refuses.
 */
export const audienceIntersection = (audiences: readonly Audience[]): Audience | "nobody" => {
  let named: readonly GroupId[] | undefined;
  for (const each of audiences) {
    if (each.audienceGroups === null) continue;
    named =
      named === undefined
        ? each.audienceGroups
        : named.filter((id) => each.audienceGroups.includes(id));
  }
  if (named === undefined) return EVERYONE;
  const distinct = [...new Set(named)].toSorted();
  return distinct.length === 0 ? "nobody" : { audience: AUDIENCE_GROUPS, audienceGroups: distinct };
};

/**
 * The per-kind floor (ADR 0020, ADR 0023): a class inheritance can never widen past. A
 * `Person` concept starts Restricted whatever its evidence says, so a person's card never
 * leaks by derivation; only a recorded Admin override may widen it. Keyed by the folded
 * kind the index row carries.
 */
export const KIND_FLOOR: Readonly<Record<string, Sensitivity>> = { Person: RESTRICTED };

/**
 * What a unit's visibility is derived from: the units it rests on — the bindings of the
 * evidence a concept cites, the includes of a composition — the kind whose floor applies
 * (a concept's; a composition has none), what it holds when it rests on nothing, and the
 * recorded override that outranks all of it.
 */
export type Derivation = {
  readonly kind?: string | undefined;
  readonly from: readonly Visibility[];
  /** What a unit with nothing to derive from takes — its writer's word, or what it holds now. */
  readonly fallback: Visibility;
  readonly override?: Visibility | undefined;
};

/** The class and audience the units rested on combine to; nothing when there are none. */
const combined = (from: readonly Visibility[]): Visibility | undefined => {
  const [first, ...rest] = from.map((unit) => unit.sensitivity);
  if (first === undefined) return undefined;
  const sensitivity = rest.reduce(narrower, first);
  const audience = audienceIntersection(from);
  return audience === "nobody" ? RESTRICTED_TO_ADMINS : { sensitivity, ...audience };
};

/**
 * The one derivation (ADR 0023, ADR 0039), in the order its riders apply: a recorded
 * Admin override outranks everything, because it is the one act that may widen past the
 * floor — the state it creates is *shared beyond its evidence*, never a rider and never a
 * trust signal; otherwise the class is the most restrictive among what the unit rests on
 * and the audience their intersection, an empty intersection forcing Restricted; a unit
 * resting on nothing takes its fallback; and the per-kind floor narrows the result and
 * never widens it.
 */
export const derivedVisibility = (derivation: Derivation): Visibility => {
  if (derivation.override !== undefined) return derivation.override;
  const inherited = combined(derivation.from) ?? derivation.fallback;
  const floor = derivation.kind === undefined ? undefined : KIND_FLOOR[derivation.kind];
  return floor === undefined
    ? inherited
    : { ...inherited, sensitivity: narrower(inherited.sensitivity, floor) };
};

/**
 * Whether moving a unit from one visibility to another would let a reader in that the first
 * kept out — the narrowing act's refusal (ADR 0013's widening is a gated act of its own,
 * B7's). Wider on any term is wider: a looser class, *everyone* where groups were named, or
 * a group the old list did not hold.
 */
export const widens = (from: Visibility, to: Visibility): boolean => {
  if (RANK[to.sensitivity] > RANK[from.sensitivity]) return true;
  if (from.audienceGroups === null) return false;
  if (to.audienceGroups === null) return true;
  return to.audienceGroups.some((id) => !from.audienceGroups.includes(id));
};

/** The three columns as a row hands them back, whichever readable unit's row it is. */
export type VisibilityRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

/**
 * The pair as the boundary narrows it, on any readable unit's row: `concept_index`'s
 * refinements are every unit's (the boundary refines them once, as `readableUnit`), so one
 * reading serves a binding's row and a composition's alike.
 */
const VISIBILITY = boundarySchemas.conceptIndex.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

/**
 * A row's three columns read as a `Visibility`, through the boundary rather than asserted.
 * The word and the array disagreeing is a broken database — the row's own CHECK forbids
 * it — so the throw is the truthful answer, never a guess about which of the two to trust.
 */
export const visibilityOf = (row: VisibilityRow): Visibility => {
  const parsed = VISIBILITY.parse({
    sensitivity: row.sensitivity,
    audience: row.audience,
    audienceGroups: row.audience_groups,
  });
  if (parsed.audience === AUDIENCE_GROUPS && parsed.audienceGroups !== null) {
    return {
      sensitivity: parsed.sensitivity,
      audience: AUDIENCE_GROUPS,
      audienceGroups: parsed.audienceGroups,
    };
  }
  if (parsed.audience === AUDIENCE_EVERYONE && parsed.audienceGroups === null) {
    return { sensitivity: parsed.sensitivity, ...EVERYONE };
  }
  throw new Error("a readable unit's audience word and its group list disagree");
};
