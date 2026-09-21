import {
  AUDIENCE_EVERYONE,
  AUDIENCE_GROUPS,
  boundarySchemas,
  type SENSITIVITIES,
} from "@better-answers/schema";

import type { GroupId, Role, UserPrincipal } from "../kernel/index.ts";

export type Sensitivity = (typeof SENSITIVITIES)[number];

export type Audience =
  | { readonly audience: typeof AUDIENCE_EVERYONE; readonly audienceGroups: null }
  | { readonly audience: typeof AUDIENCE_GROUPS; readonly audienceGroups: readonly GroupId[] };

export type Visibility = { readonly sensitivity: Sensitivity } & Audience;

const RESTRICTED = "Restricted" satisfies Sensitivity;

const EVERYONE = { audience: AUDIENCE_EVERYONE, audienceGroups: null } as const;

export const RESTRICTED_TO_ADMINS: Visibility = { sensitivity: RESTRICTED, ...EVERYONE };

export const readableClause = (alias: string, roleParameter: number): string =>
  `${alias}.published_at IS NOT NULL
     AND ${sensitivityAndAudienceClause(alias, roleParameter)}`;

export const sensitivityAndAudienceClause = (alias: string, roleParameter: number): string =>
  `(${alias}.sensitivity <> '${RESTRICTED}' OR $${roleParameter} = 'Admin')
     AND (${alias}.audience = '${AUDIENCE_EVERYONE}' OR ${alias}.audience_groups && $${roleParameter + 1}::text[])`;

export const readableParameters = (
  principal: UserPrincipal,
): readonly [Role, readonly GroupId[]] => [principal.role, principal.groups];

const RANK = { Public: 2, Internal: 1, Restricted: 0 } as const satisfies Record<
  Sensitivity,
  number
>;

export const narrower = (one: Sensitivity, other: Sensitivity): Sensitivity =>
  RANK[one] <= RANK[other] ? one : other;

const audienceIntersection = (audiences: readonly Audience[]): Audience | "nobody" => {
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

// oxlint-disable-next-line anti-slop/no-known-value-widening -- kinds are open (ADR 0026): a concept arrives with whatever folded kind its file carries, so the floor is looked up by any string and the open dictionary is the decision, not an omission.
const KIND_FLOOR: Readonly<Record<string, Sensitivity>> = { Person: RESTRICTED };

export type Derivation = {
  readonly kind?: string | undefined;
  readonly from: readonly Visibility[];

  readonly fallback: Visibility;
  readonly override?: Visibility | undefined;
};

const combined = (from: readonly Visibility[]): Visibility | undefined => {
  const [first, ...rest] = from.map((unit) => unit.sensitivity);
  if (first === undefined) return undefined;
  const sensitivity = rest.reduce(narrower, first);
  const audience = audienceIntersection(from);
  return audience === "nobody" ? RESTRICTED_TO_ADMINS : { sensitivity, ...audience };
};

export const derivedVisibility = (derivation: Derivation): Visibility => {
  if (derivation.override !== undefined) return derivation.override;
  const inherited = combined(derivation.from) ?? derivation.fallback;
  const floor = derivation.kind === undefined ? undefined : KIND_FLOOR[derivation.kind];
  return floor === undefined
    ? inherited
    : { ...inherited, sensitivity: narrower(inherited.sensitivity, floor) };
};

export const widens = (from: Visibility, to: Visibility): boolean => {
  if (RANK[to.sensitivity] > RANK[from.sensitivity]) return true;
  if (from.audienceGroups === null) return false;
  if (to.audienceGroups === null) return true;
  return to.audienceGroups.some((id) => !from.audienceGroups.includes(id));
};

export type VisibilityRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audience_groups: readonly string[] | null;
};

const VISIBILITY = boundarySchemas.conceptIndex.select.pick({
  sensitivity: true,
  audience: true,
  audienceGroups: true,
});

export const visibilityOf = (row: VisibilityRow): Visibility => {
  const parsed = VISIBILITY.parse({
    sensitivity: row.sensitivity,
    audience: row.audience,
    audienceGroups: row.audience_groups,
  });
  const visibility = visibilityFrom(parsed);
  if (visibility === undefined) {
    throw new Error("a readable unit's audience word and its group list disagree");
  }
  return visibility;
};

export const visibilityFrom = (fields: {
  readonly sensitivity: string;
  readonly audience: string;
  readonly audienceGroups?: readonly string[] | null | undefined;
}): Visibility | undefined => {
  const parsed = VISIBILITY.safeParse({
    sensitivity: fields.sensitivity,
    audience: fields.audience,
    audienceGroups: fields.audienceGroups ?? null,
  });
  if (!parsed.success) return undefined;
  const { sensitivity, audience, audienceGroups } = parsed.data;
  if (audience === AUDIENCE_GROUPS && audienceGroups !== null) {
    return { sensitivity, audience: AUDIENCE_GROUPS, audienceGroups };
  }
  if (audience === AUDIENCE_EVERYONE && audienceGroups === null) {
    return { sensitivity, ...EVERYONE };
  }
  return undefined;
};
