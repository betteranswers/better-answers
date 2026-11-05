import { find, findInput, open, openInput, type OpenResult } from "@better-answers/core/answering";
import {
  allKnowledgeInput,
  briefCopy,
  briefCopyInput,
  collectionOwnerNamed,
  copyOfferOf,
  collectionsAndOwners,
  conceptToEdit,
  conceptToEditInput,
  exportBundleInput,
  exportBundleSnapshot,
  exportGuideInput,
  exportGuideSnapshot,
  exportRecords,
  exportRecordsInput,
  kindConceptsInput,
  nameOwner,
  nameOwnerInput,
  nameOwnerOfEach,
  nameOwnerOfEachInput,
  readAllKnowledge,
  readKindConcepts,
  readKinds,
  readKnowledgeTree,
  readSectionTrusts,
  recordCopy,
  recordCopyInput,
  saveConcept,
  saveConceptInput,
  standingOnConcept,
  trustWords,
  type CopyOffer,
} from "@better-answers/core/concepts";
import {
  includeAvailable,
  includeAvailableInput,
  readActionThreshold,
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

import { KNOWLEDGE_EXPORT_PERSON_RULE, MCP_TOKEN_RULE } from "../auth/constants.ts";
import { doorTold, type Doors } from "../doors.ts";
import {
  answeredBy,
  crossing,
  given,
  mutationProcedure,
  ownTransactionCeiling,
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
  readonly sections: readonly (Omit<SectionRead, "citedIris"> & {
    readonly trustWords: string;
    readonly copy: CopyOffer;
  })[];
};

const guideAnswered = async (
  ctx: { readonly principal: UserPrincipal; readonly tx: Tx; readonly clock: Clock },
  asked: GuideAsked,
): Promise<Result<GuideAnswered, GuideReadRefusal | typeof NOT_FOUND>> => {
  const read = await readGuide(ctx.principal, ctx.tx, asked);
  if (!read.ok) return read;
  const guide = read.value;
  if (guide === undefined) return err(NOT_FOUND);

  const trust = await readSectionTrusts(
    ctx.principal,
    ctx.tx,
    guide.sections.map((section) => section.citedIris),
    ctx.clock.now(),
  );
  if (!trust.ok) return trust;
  const threshold = await readActionThreshold(ctx.principal, ctx.tx, asked.guideId);
  if (!threshold.ok) return threshold;
  const owner = await attempt(() => collectionOwnerNamed(ctx.principal, ctx.tx, guide.collection));
  if (!owner.ok) return owner;

  return ok({
    ...guide,
    owner: owner.value,
    sections: guide.sections.map(({ citedIris: _cited, ...section }, at) => {
      const held = trust.value[at];
      if (held === undefined) throw new Error(`no trust was read for section ${section.sectionId}`);
      return {
        ...section,
        trustWords: trustWords(held),
        copy: copyOfferOf(held, threshold.value),
      };
    }),
  });
};

type GuideDoors = Parameters<typeof includeAvailable>[1];

const writingGuide = <Value, Refused>(
  doors: Doors,
  write: (guide: GuideDoors) => Promise<Result<Value, Refused | Error>>,
): Promise<Result<Value, Refused | Error>> => {
  const bundle = doorTold(doors.git, "no bundle store is configured");
  if (!bundle.ok) return Promise.resolve(err(new Error(bundle.error)));
  return write({ git: bundle.value, postgres: doors.postgres, clock: doors.clock });
};

const asBase64 = <Held extends { readonly zip: Uint8Array }>({
  zip,
  ...rest
}: Held): Omit<Held, "zip"> & { readonly base64: string } => ({
  ...rest,
  base64: Buffer.from(zip).toString("base64"),
});

const exportingFrom = ownTransactionCeiling(KNOWLEDGE_EXPORT_PERSON_RULE);

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
      given(input, (asked) =>
        writingGuide(ctx.doors, (doors) => saveBrief(ctx.principal, doors, asked)),
      ),
    ),
  ),
  includeAvailable: ownTransactionProcedure
    .input(parsedBy(includeAvailableInput))
    .mutation(({ ctx, input }) =>
      crossing(
        ctx,
        includeAvailable.name,
        given(input, (asked) =>
          writingGuide(ctx.doors, (doors) => includeAvailable(ctx.principal, doors, asked)),
        ),
      ),
    ),
  briefCopy: knowledgeReadProcedure.input(parsedBy(briefCopyInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      briefCopy.name,
      given(input, (asked) => briefCopy(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  recordCopy: mutationProcedure.input(parsedBy(recordCopyInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      recordCopy.name,
      given(input, (asked) => recordCopy(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  collections: queryProcedure.query(({ ctx }) =>
    crossing(ctx, collectionsAndOwners.name, collectionsAndOwners(ctx.principal, ctx.tx)),
  ),
  nameOwner: mutationProcedure.input(parsedBy(nameOwnerInput)).mutation(answeredBy(nameOwner)),
  allKnowledge: queryProcedure.input(parsedBy(allKnowledgeInput)).query(({ ctx, input }) =>
    crossing(
      ctx,
      readAllKnowledge.name,
      given(input, (asked) => readAllKnowledge(ctx.principal, ctx.tx, asked, ctx.clock.now())),
    ),
  ),
  kinds: queryProcedure.query(({ ctx }) =>
    crossing(ctx, readKinds.name, readKinds(ctx.principal, ctx.tx)),
  ),
  setOwners: mutationProcedure
    .input(parsedBy(nameOwnerOfEachInput))
    .mutation(answeredBy(nameOwnerOfEach)),
  exportBundle: exportingFrom.input(parsedBy(exportBundleInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      exportBundleSnapshot.name,
      given(input, async () => {
        const bundle = doorTold(ctx.doors.git, "no bundle store is configured");
        if (!bundle.ok) return err(new Error(bundle.error));
        const exported = await exportBundleSnapshot(
          ctx.principal,
          { git: bundle.value, postgres: ctx.doors.postgres },
          { at: ctx.clock.now() },
        );
        return exported.ok ? ok(asBase64(exported.value)) : exported;
      }),
    ),
  ),
  exportRecords: exportingFrom.input(parsedBy(exportRecordsInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      exportRecords.name,
      given(input, async () => {
        const exported = await exportRecords(ctx.principal, ctx.doors.postgres, {
          at: ctx.clock.now(),
        });
        return exported.ok ? ok(asBase64(exported.value)) : exported;
      }),
    ),
  ),
  exportGuide: exportingFrom.input(parsedBy(exportGuideInput)).mutation(({ ctx, input }) =>
    crossing(
      ctx,
      exportGuideSnapshot.name,
      given(input, (asked) =>
        exportGuideSnapshot(ctx.principal, ctx.doors.postgres, { ...asked, at: ctx.clock.now() }),
      ),
    ),
  ),
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
