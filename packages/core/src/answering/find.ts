import type { ConceptIri, CorpusCounts, MatchStrength } from "@better-answers/schema";

import {
  type Frontmatter,
  conceptCountsOf,
  findConcepts,
  trustOf,
  trustWords,
  type OpenedConcept,
} from "../concepts/index.ts";
import {
  admit,
  ANY_ROLE,
  declareAction,
  err,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import {
  findPassagesWithOpening,
  passageCountsOf,
  type PassageMatchWithOpening,
} from "../sources/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { findInput, type FindInput } from "./boundary.ts";
import { cursorOf, type FindPosition, type FindRun } from "./cursor.ts";
import type { FindResult, FindMatch, ConceptMatch, DocumentMatch } from "./results.ts";

const tagsOf = (frontmatter: Frontmatter): readonly string[] => {
  const tags = frontmatter["tags"];
  return Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
};

type Positioned<Match> = { readonly match: Match; readonly position: FindPosition };

type RunReader<Match> = (
  limit: number,
  after: FindPosition | undefined,
) => Promise<Result<readonly Positioned<Match>[]>>;

type Search = {
  readonly principal: UserPrincipal;
  readonly tx: Tx;
  readonly query: string;
};

type Counted = () => Promise<Result<CorpusCounts>>;

const countedOnce = (
  runs: readonly FindRun[],
  after: FindPosition | undefined,
  count: Counted,
): Counted => {
  let held: Promise<Result<CorpusCounts>> | undefined;
  return () => {
    held ??=
      after !== undefined && runs.includes(after.run) ? Promise.resolve(ok(after.counts)) : count();
    return held;
  };
};

const conceptRun =
  (
    { principal, tx, query }: Search,
    run: MatchStrength,
    counted: Counted,
  ): RunReader<OpenedConcept> =>
  async (limit, after) => {
    const counts = await counted();
    if (!counts.ok) return err(counts.error);
    const found = await findConcepts(principal, tx, {
      query,
      strength: run,
      limit,
      after: after?.run === run ? after.bound : undefined,
      counts: counts.value,
    });
    if (!found.ok) return err(found.error);
    return ok(
      found.value.map(({ concept, bound }) => ({
        match: concept,
        position: { run, bound, counts: counts.value },
      })),
    );
  };

const passageRun =
  ({ principal, tx, query }: Search, counted: Counted): RunReader<PassageMatchWithOpening> =>
  async (limit, after) => {
    const counts = await counted();
    if (!counts.ok) return err(counts.error);
    const found = await findPassagesWithOpening(principal, tx, {
      query,
      limit,
      after: after?.run === "passages" ? after.bound : undefined,
      counts: counts.value,
    });
    if (!found.ok) return err(found.error);
    return ok(
      found.value.map(({ passage, bound }) => ({
        match: passage,
        position: { run: "passages" as const, bound, counts: counts.value },
      })),
    );
  };

type Page<Match> = { readonly matches: readonly Match[]; readonly next: FindPosition | undefined };

const pageOf = async <Match>(
  runs: readonly (readonly [FindRun, RunReader<Match>])[],
  limit: number,
  after: FindPosition | undefined,
): Promise<Result<Page<Match>>> => {
  const read: Positioned<Match>[] = [];
  const from = after === undefined ? 0 : runs.findIndex(([run]) => run === after.run);
  for (const [, reader] of runs.slice(from)) {
    if (read.length > limit) break;
    // oxlint-disable-next-line eslint/no-await-in-loop -- each run is asked only for what the runs before it left of the page
    const more = await reader(limit + 1 - read.length, after);
    if (!more.ok) return err(more.error);
    read.push(...more.value);
  }
  const page = read.slice(0, limit);
  return ok({
    matches: page.map(({ match }) => match),
    next: read.length > limit ? page.at(-1)?.position : undefined,
  });
};

const mappedRun =
  <From, To>(reader: RunReader<From>, to: (from: From) => To): RunReader<To> =>
  async (limit, after) => {
    const read = await reader(limit, after);
    if (!read.ok) return err(read.error);
    return ok(read.value.map(({ match, position }) => ({ match: to(match), position })));
  };

const findAction = declareAction({
  admits: ANY_ROLE,
  input: findInput,
  refuses: ["role-forbids"],
});

export type FindRefusal = RefusalOf<typeof findAction> | Error;

/**
 * Concepts holding at least half the query's words, then passages, then concepts holding fewer.
 * `now` decides which concepts are past their shelf life.
 */
export const find = async (
  principal: UserPrincipal,
  tx: Tx,
  input: FindInput,
  now: Date,
): Promise<Result<FindResult, FindRefusal>> => {
  const admitted = admit(findAction, principal, input);
  if (!admitted.ok) return err(admitted.error);

  const search = { principal: admitted.value, tx, query: input.query };
  const toConcept = (concept: OpenedConcept) => conceptMatchOf(concept, now);
  const concepts = countedOnce(["strong", "weak"], input.cursor, () =>
    conceptCountsOf(search.principal, tx, search.query),
  );
  const passages = countedOnce(["passages"], input.cursor, () =>
    passageCountsOf(search.principal, tx, search.query),
  );
  const page = await pageOf<FindMatch>(
    [
      ["strong", mappedRun(conceptRun(search, "strong", concepts), toConcept)],
      ["passages", mappedRun(passageRun(search, passages), documentMatchOf)],
      ["weak", mappedRun(conceptRun(search, "weak", concepts), toConcept)],
    ],
    input.limit,
    input.cursor,
  );
  if (!page.ok) return err(page.error);
  const { matches, next } = page.value;
  const found: FindResult = { query: input.query, matches };
  return ok(next === undefined ? found : { ...found, nextCursor: cursorOf(next) });
};

const conceptMatchOf = (concept: OpenedConcept, now: Date): ConceptMatch<ConceptIri> => {
  const trust = trustOf(concept, now);
  return {
    layer: "bundles",
    iri: concept.iri,
    kind: concept.kind,
    title: concept.title,
    trust,
    trustWords: trustWords(trust),
    collection: concept.collection,
    tags: tagsOf(concept.frontmatter),
  };
};

const documentMatchOf = (match: PassageMatchWithOpening): DocumentMatch => ({
  layer: "sources",
  kind: "document",
  title: match.title,
  locator: match.locator,
  sensitivity: match.sensitivity,
  openingLine: match.openingLine,
});
