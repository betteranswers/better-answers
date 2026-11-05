import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import {
  collectionOwnerNamed,
  collectionsAndOwners,
  conceptToEdit,
  conceptToEditInput,
  kindConceptsInput,
  nameOwner,
  nameOwnerInput,
  readKindConcepts,
  readKnowledgeTree,
  readSectionTrustWords,
  saveConcept,
  saveConceptInput,
  standingOnConcept,
} from "@better-answers/core/concepts";
import {
  includeAvailable,
  includeAvailableInput,
  readGuide,
  readGuideInput,
  readGuides,
  saveBrief,
  saveBriefInput,
  type GuideRead,
  type GuideReadRefusal,
  type SectionRead,
} from "@better-answers/core/guides";
import {
  attempt,
  err,
  NOT_FOUND,
  ok,
  type Clock,
  type Result,
  type UserPrincipal,
} from "@better-answers/core/kernel";
import { passageAt } from "@better-answers/core/sources";
import type { Tx } from "@better-answers/core/store/postgres";

import { MCP_TOKEN_RULE } from "../auth/constants.ts";
import { doorTold } from "../doors.ts";
import {
  answeredBy,
  crossing,
  given,
  mutationProcedure,
  ownTransactionProcedure,
  parsedBy,
  queryCeiling,
  queryProcedure,
  router,
  type RoadCeiling,
} from "./base.ts";

type Found = Extract<OpenResult, { readonly found: true }>;

const foundOrRefused = <Refused>(
  opened: Result<OpenResult, Refused>,
): Result<Found, Refused | typeof NOT_FOUND> => {
  if (!opened.ok) return opened;
  return opened.value.found ? ok(opened.value) : err(NOT_FOUND);
};

type Opened = Found & { readonly standing?: Awaited<ReturnType<typeof standingOnConcept>> };

const openedWithStanding = async <Refused>(
  ctx: { readonly principal: UserPrincipal; readonly tx: Tx },
  found: Result<Found, Refused>,
  iri: string | undefined,
): Promise<Result<Opened, Refused | Error>> => {
  if (!found.ok || iri === undefined) return found;
  const standing = await attempt(() => standingOnConcept(ctx.principal, ctx.tx, iri));
  return standing.ok ? ok({ ...found.value, standing: standing.value }) : standing;
};

const passages = (principal: UserPrincipal, tx: Tx) => (locator: string) =>
  passageAt(principal, tx, locator);

type GuideAsked = Parameters<typeof readGuide>[2];

type GuideAnswered = Omit<GuideRead, "sections"> & {
  readonly owner: { readonly id: string; readonly name: string } | null;
  readonly sections: readonly (Omit<SectionRead, "citedIris"> & { readonly trustWords: string })[];
};

const guideAnswered = async (
  ctx: { readonly principal: UserPrincipal; readonly tx: Tx; readonly clock: Clock },
  asked: GuideAsked,
): Promise<Result<GuideAnswered, GuideReadRefusal | typeof NOT_FOUND>> => {
  const read = await readGuide(ctx.principal, ctx.tx, asked);
  if (!read.ok) return read;
  const guide = read.value;
  if (guide === undefined) return err(NOT_FOUND);

  const trust = await readSectionTrustWords(
    ctx.principal,
    ctx.tx,
    guide.sections.map((section) => section.citedIris),
    ctx.clock.now(),
  );
  if (!trust.ok) return trust;
  const owner = await attempt(() => collectionOwnerNamed(ctx.principal, ctx.tx, guide.collection));
  if (!owner.ok) return owner;

  return ok({
    ...guide,
    owner: owner.value,
    sections: guide.sections.map(({ citedIris: _cited, ...section }, at) => {
      const trustWords = trust.value[at];
      if (trustWords === undefined) throw new Error(`section ${section.sectionId} has no trust`);
      return { ...section, trustWords };
    }),
  });
};

export const KNOWLEDGE_CEILING: RoadCeiling = { budget: "knowledge", rule: MCP_TOKEN_RULE };

export const knowledgeReadProcedure = queryCeiling(KNOWLEDGE_CEILING);

export const knowledgeRouter = router({
  find: knowledgeReadProcedure.input(parsedBy(findInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      find.name,
      given(input, (asked) => find(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  open: knowledgeReadProcedure.input(parsedBy(openInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      open.name,
      given(input, async (asked) =>
        openedWithStanding(
          ctx,
          foundOrRefused(await open(ctx.principal, ctx.tx, asked, ctx.clock.now())),
          asked.iri,
        ),
      ),
    ),
  ),
  tree: knowledgeReadProcedure.query(({ ctx }) =>
    crossing(ctx, readKnowledgeTree.name, readKnowledgeTree(ctx.principal, ctx.tx)),
  ),
  kindConcepts: knowledgeReadProcedure.input(parsedBy(kindConceptsInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readKindConcepts.name,
      given(input, (asked) => readKindConcepts(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  guides: knowledgeReadProcedure.query(({ ctx }) =>
    crossing(ctx, readGuides.name, readGuides(ctx.principal, ctx.tx)),
  ),
  guide: knowledgeReadProcedure.input(parsedBy(readGuideInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readGuide.name,
      given(input, (asked) => guideAnswered(ctx, asked)),
    ),
  ),
  saveBrief: ownTransactionProcedure.input(parsedBy(saveBriefInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      saveBrief.name,
      given(input, (asked) => saveBrief(ctx.principal, ctx.doors.postgres, asked)),
    ),
  ),
  includeAvailable: ownTransactionProcedure
    .input(parsedBy(includeAvailableInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        includeAvailable.name,
        given(input, (asked) => {
          const bundle = doorTold(ctx.doors.git, "no bundle store is configured");
          if (!bundle.ok) return Promise.resolve(err(new Error(bundle.error)));
          return includeAvailable(
            ctx.principal,
            { git: bundle.value, postgres: ctx.doors.postgres, clock: ctx.doors.clock },
            asked,
          );
        }),
      ),
    ),
  collections: queryProcedure.query(({ ctx }) =>
    crossing(ctx, collectionsAndOwners.name, collectionsAndOwners(ctx.principal, ctx.tx)),
  ),
  nameOwner: mutationProcedure.input(parsedBy(nameOwnerInput)).mutation(answeredBy(nameOwner)),
  conceptToEdit: knowledgeReadProcedure
    .input(parsedBy(conceptToEditInput))
    .query(({ ctx, input }) =>
      crossing(
        ctx,
        conceptToEdit.name,
        given(input, (asked) =>
          conceptToEdit(ctx.principal, ctx.tx, asked, passages(ctx.principal, ctx.tx)),
        ),
      ),
    ),
  saveConcept: ownTransactionProcedure
    .input(parsedBy(saveConceptInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        saveConcept.name,
        given(input, (asked) => {
          const bundle = doorTold(ctx.doors.git, "no bundle store is configured");
          if (!bundle.ok) return Promise.resolve(err(new Error(bundle.error)));
          return saveConcept(
            ctx.principal,
            { git: bundle.value, postgres: ctx.doors.postgres, clock: ctx.doors.clock, passages },
            asked,
          );
        }),
      ),
    ),
});
