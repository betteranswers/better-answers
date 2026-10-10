import { z } from "zod";

import { TRUST_TIERS } from "@better-answers/core/answering";
import { overrideConceptSensitivity, writeConcept } from "@better-answers/core/concepts";
import { actorIdOfPerson, type UserPrincipal } from "@better-answers/core/kernel";
import { head, initRepository, type GitDoor } from "@better-answers/core/store/git";
import { AUDIENCES, conceptFrontmatter, SENSITIVITIES } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { inOneTransaction, seedPassages } from "./harness-sources.ts";
import { actingIn, openTestGit, type TestApp } from "./harness.ts";

const SUITE_VERIFIER = "process:better-answers-browser-suite";

type SourceKeys = {
  readonly title?: string | undefined;
  readonly label?: string | undefined;
  readonly passages?: readonly string[] | undefined;
  readonly sensitivity?: string | undefined;
  readonly concept?: string | undefined;
  readonly at?: string | undefined;
};

type Broken = readonly [field: keyof SourceKeys, rule: string];

const given = (source: SourceKeys, fields: readonly (keyof SourceKeys)[]) =>
  fields.filter((field) => source[field] !== undefined);

const conceptRules = (source: SourceKeys): readonly Broken[] =>
  given(source, ["title", "label", "passages", "sensitivity", "at"]).map((field) => [
    field,
    "a source naming a concept carries nothing else",
  ]);

const placeRules = (source: SourceKeys): readonly Broken[] => [
  ...(source.passages === undefined
    ? []
    : [["at", "a place in a source opens nothing, so it comes with no passage"] as const]),
  ...given(source, ["label", "sensitivity"]).map((field): Broken => [
    field,
    "only a document's passages take this",
  ]),
];

const documentRules = (source: SourceKeys): readonly Broken[] =>
  source.passages === undefined
    ? [["passages", "a source names a document's passages, a concept or a place"]]
    : [];

/** One form alone, so a spec's mistake is refused by its field and never dropped unread. */
const rulesBroken = (source: SourceKeys): readonly Broken[] => {
  if (source.concept !== undefined) return conceptRules(source);
  const untitled: readonly Broken[] =
    source.title === undefined ? [["title", "a document or a place names its source"]] : [];
  return [...untitled, ...(source.at === undefined ? documentRules(source) : placeRules(source))];
};

/** A document's passages, a concept seeded before this one, or a place such as `p.4` that opens nothing. */
const aSource = z
  .strictObject({
    title: z.string().min(1).optional(),
    /** The file's own words for a document, where they are not its title. */
    label: z.string().min(1).optional(),
    passages: z.array(z.string().min(1)).min(1).optional(),
    /** Its connected source's own, where the document is held closer than the concept citing it. */
    sensitivity: z.enum(SENSITIVITIES).optional(),
    concept: z.string().min(1).optional(),
    at: z.string().min(1).optional(),
  })
  .superRefine((source, context) => {
    for (const [field, rule] of rulesBroken(source)) {
      context.addIssue({ code: "custom", path: [field], message: rule });
    }
  });

const aConcept = z.object({
  title: z.string().min(1),
  kind: z.string().min(1).default("Answer"),
  body: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).default("Internal"),
  audience: z.enum(AUDIENCES).default("everyone"),
  groupMemberIds: z.array(z.string().min(1)).default([]),
  trust: z.enum(TRUST_TIERS).default("unverified"),
  linksTo: z.array(z.string().min(1)).default([]),
  sources: z.array(aSource).default([]),
  /** Further keys of the file's own, such as `tags` or `verified`. */
  frontmatter: conceptFrontmatter.default({}),
});

type AskedConcept = z.output<typeof aConcept>;

/** A source may name only a concept the same seed writes before it. */
export const conceptsSeeding = z
  .object({
    workspaceId: z.string().min(1),
    userId: z.string().min(1),
    concepts: z.array(aConcept).min(1),
  })
  .superRefine((asked, context) => {
    for (const [at, concept] of asked.concepts.entries()) {
      const earlier = new Set(asked.concepts.slice(0, at).map((seeded) => seeded.title));
      for (const [place, source] of concept.sources.entries()) {
        if (source.concept === undefined || earlier.has(source.concept)) continue;
        context.addIssue({
          code: "custom",
          path: ["concepts", at, "sources", place, "concept"],
          message: "a source names a concept seeded before it in the same seed",
        });
      }
    }
  })
  // A link too names only a concept before it, and one seed gives a title to one concept.
  .superRefine((asked, context) => {
    for (const [at, concept] of asked.concepts.entries()) {
      const earlier = new Set(asked.concepts.slice(0, at).map((seeded) => seeded.title));
      if (earlier.has(concept.title)) {
        context.addIssue({
          code: "custom",
          path: ["concepts", at, "title"],
          message: "a seed gives each title to one concept",
        });
      }
      for (const [place, title] of concept.linksTo.entries()) {
        if (earlier.has(title)) continue;
        context.addIssue({
          code: "custom",
          path: ["concepts", at, "linksTo", place],
          message: "a concept links to one seeded before it in the same seed",
        });
      }
    }
  });

/** `document` only where the source is a passage, which the write records as evidence. */
type Citation = {
  readonly id: string;
  readonly title: string;
  readonly resource: string;
  readonly locator?: string;
  readonly document?: { readonly documentId: string; readonly title: string };
};

type SeededConcept = {
  readonly iri: string;
  readonly title: string;
  readonly path: string;
  readonly documents: readonly { readonly documentId: string; readonly title: string }[];
};

type Writer = {
  readonly principal: UserPrincipal;
  readonly author: { readonly name: string; readonly email: string };
  readonly git: GitDoor;
};

const shortNameOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");

/** Every concept sits directly under `knowledge/`, so a link names the file alone. */
const fileOf = (title: string): string => `${shortNameOf(title)}.md`;

type AskedSource = AskedConcept["sources"][number];

type AskedDocument = {
  readonly title: string;
  readonly label?: string | undefined;
  readonly passages: readonly string[];
  readonly sensitivity?: Sensitivity | undefined;
};

type Sensitivity = AskedConcept["sensitivity"];

type Seeding = {
  readonly seed: ReturnType<typeof testData>;
  readonly workspaceId: string;
  readonly concept: AskedConcept;
  readonly earlier: readonly SeededConcept[];
  /** The published connected source the concept's documents at one sensitivity are held in. */
  readonly connectedSourceAt: (sensitivity: Sensitivity) => Promise<string>;
};

/** One connected source for each sensitivity asked for, made when its first document is. */
const connectedSourcesOf = (
  seed: Seeding["seed"],
  workspaceId: string,
  concept: AskedConcept,
): Seeding["connectedSourceAt"] => {
  const made = new Map<Sensitivity, string>();
  return async (sensitivity) => {
    const held = made.get(sensitivity);
    if (held !== undefined) return held;
    const own = sensitivity === concept.sensitivity;
    const connectedSource = await seed.connectedSource({
      workspaceId,
      name: own ? `${concept.title} sources` : `${concept.title} ${sensitivity} sources`,
      sensitivity,
      publishedAt: new Date(),
      state: "published",
    });
    made.set(sensitivity, connectedSource.id);
    return connectedSource.id;
  };
};

type Unnumbered = Omit<Citation, "id">;

/** Each passage is cited apart, by its document and its span in it. */
const passagesCited = async (
  seeding: Seeding,
  source: AskedDocument,
): Promise<readonly Unnumbered[]> => {
  const { seed, workspaceId, concept } = seeding;
  const connectedSourceId = await seeding.connectedSourceAt(
    source.sensitivity ?? concept.sensitivity,
  );
  const document = await seed.sourceDocument({
    workspaceId,
    connectedSourceId,
    title: source.title,
    sourceSystemId: source.title,
  });
  const spans = await seedPassages(
    seed,
    workspaceId,
    connectedSourceId,
    document.id,
    source.passages,
  );
  const label = source.label ?? source.title;
  return spans.map((span) => ({
    title: label,
    resource: label,
    locator: `${document.id}/${span}`,
    document: { documentId: document.id, title: source.title },
  }));
};

/** The seed's schema has already refused a title no earlier concept carries. */
const conceptCited = (seeding: Seeding, title: string): readonly Unnumbered[] =>
  seeding.earlier
    .filter((seeded) => seeded.title === title)
    .slice(0, 1)
    .map((named) => ({ title, resource: named.iri }));

/** The schema holds a source to one form, so the two empty answers here are never reached. */
const cited = async (seeding: Seeding, source: AskedSource): Promise<readonly Unnumbered[]> => {
  const { title, passages, concept, at } = source;
  if (concept !== undefined) return conceptCited(seeding, concept);
  if (title === undefined) return [];
  if (passages !== undefined) return passagesCited(seeding, { ...source, title, passages });
  return at === undefined ? [] : [{ title, resource: title, locator: at }];
};

/** The concept's sources in the order asked, each with the id its citation mark names. */
const citationsOf = async (
  app: TestApp,
  workspaceId: string,
  concept: AskedConcept,
  earlier: readonly SeededConcept[],
): Promise<readonly Citation[]> => {
  if (concept.sources.length === 0) return [];
  return inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const seeding = {
      seed,
      workspaceId,
      concept,
      earlier,
      connectedSourceAt: connectedSourcesOf(seed, workspaceId, concept),
    };
    const citations: Citation[] = [];
    for (const source of concept.sources) {
      for (const one of await cited(seeding, source)) {
        citations.push({ id: `source-${String(citations.length + 1)}`, ...one });
      }
    }
    return citations;
  });
};

/** A mark per source after the body's words, unless the body places it, then each concept it links. */
const bodyOf = (
  concept: AskedConcept,
  citations: readonly Citation[],
  links: readonly SeededConcept[],
): string => {
  const marks = citations
    .map((citation) => `[^${citation.id}]`)
    .filter((mark) => !concept.body.includes(mark))
    .join("");
  const named = links.map((link) => `[${link.title}](${fileOf(link.title)})`);
  const related = named.length === 0 ? "" : `\n\nSee also ${named.join(", ")}.`;
  return `${concept.body}${marks}${related}\n`;
};

const linkedFrom = (
  concept: AskedConcept,
  earlier: readonly SeededConcept[],
): readonly SeededConcept[] =>
  concept.linksTo.map((title) => {
    const target = earlier.find((seeded) => seeded.title === title);
    if (target === undefined)
      throw new Error(`${concept.title} links to ${title}, not seeded before it`);
    return target;
  });

const conceptWritten = async (
  app: TestApp,
  writer: Writer,
  concept: AskedConcept,
  earlier: readonly SeededConcept[],
) => {
  const { principal, git } = writer;
  const citations = await citationsOf(app, principal.workspaceId, concept, earlier);
  const path = `knowledge/${fileOf(concept.title)}`;
  const written = await writeConcept(
    principal,
    { git, postgres: app.doors.postgres, clock: app.doors.clock },
    {
      mergeKey: `${shortNameOf(concept.kind)}:${shortNameOf(concept.title)}`,
      path,
      kind: concept.kind,
      title: concept.title,
      frontmatter: {
        ...concept.frontmatter,
        title: concept.title,
        type: concept.kind,
        sources: citations.map(({ id, title, resource, locator }) =>
          locator === undefined ? { id, title, resource } : { id, title, resource, locator },
        ),
      },
      body: bodyOf(concept, citations, linkedFrom(concept, earlier)),
      message: `Record ${concept.title}`,
      author: writer.author,
      expects: { head: await head(principal, git) },
      status: "stable",
      sensitivity: concept.sensitivity,
      evidence: citations.flatMap(({ document, resource, locator }) =>
        document === undefined || locator === undefined
          ? []
          : [{ sourceDocumentId: document.documentId, locator, resource }],
      ),
    },
  );
  if (!written.ok) throw new Error(`${concept.title} was refused: ${String(written.error)}`);
  return { ...written.value, path, citations };
};

/** The Admin's own override, to a group holding `groupMemberIds`: a write alone leaves a new concept everyone's. */
const narrowedToAGroup = async (
  app: TestApp,
  writer: Writer,
  concept: AskedConcept,
  iri: string,
) => {
  const { workspaceId, userId } = writer.principal;
  const group = await inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const made = await seed.group({ workspaceId, name: `${concept.title} readers` });
    for (const memberId of concept.groupMemberIds) {
      await seed.groupMember({ workspaceId, groupId: made.id, userId: memberId });
    }
    return made;
  });
  await actingIn(app, { workspaceId, userId }, (principal, tx) =>
    overrideConceptSensitivity(principal, tx, {
      iri,
      sensitivity: concept.sensitivity,
      audience: "groups",
      audienceGroups: [group.id],
    }),
  );
};

/** The Admin's own override, to everyone at the concept's sensitivity: shared beyond its evidence. */
const sharedPastItsEvidence = async (
  app: TestApp,
  writer: Writer,
  concept: AskedConcept,
  iri: string,
) => {
  const { workspaceId, userId } = writer.principal;
  await actingIn(app, { workspaceId, userId }, (principal, tx) =>
    overrideConceptSensitivity(principal, tx, {
      iri,
      sensitivity: concept.sensitivity,
      audience: "everyone",
    }),
  );
};

const citesCloserHeldEvidence = (concept: AskedConcept): boolean =>
  concept.sources.some(
    (source) => source.sensitivity !== undefined && source.sensitivity !== concept.sensitivity,
  );

const verified = async (
  app: TestApp,
  writer: Writer,
  concept: AskedConcept,
  written: { readonly iri: string; readonly contentHash: string },
) => {
  const actor =
    concept.trust === "human-reviewed" ? actorIdOfPerson(writer.principal.userId) : SUITE_VERIFIER;
  await inOneTransaction(app, (client) =>
    testData(client).conceptVerification({
      workspaceId: writer.principal.workspaceId,
      iri: written.iri,
      actor,
      contentHash: written.contentHash,
    }),
  );
};

const seedConcept = async (
  app: TestApp,
  writer: Writer,
  concept: AskedConcept,
  earlier: readonly SeededConcept[],
): Promise<SeededConcept> => {
  const written = await conceptWritten(app, writer, concept, earlier);
  if (concept.audience === "groups") await narrowedToAGroup(app, writer, concept, written.iri);
  else if (citesCloserHeldEvidence(concept)) {
    await sharedPastItsEvidence(app, writer, concept, written.iri);
  }
  if (concept.trust !== "unverified") await verified(app, writer, concept, written);
  const documents = new Map(
    written.citations.flatMap(({ document }) =>
      document === undefined ? [] : [[document.documentId, document.title] as const],
    ),
  );
  return {
    iri: written.iri,
    title: concept.title,
    path: written.path,
    documents: [...documents].map(([documentId, title]) => ({ documentId, title })),
  };
};

const authorOf = async (app: TestApp, userId: string): Promise<Writer["author"]> => {
  const found = await app.database.superuser.query<Writer["author"]>(
    'SELECT name, email FROM "user" WHERE id = $1',
    [userId],
  );
  const author = found.rows[0];
  if (author === undefined) throw new Error(`the harness holds no person ${userId}`);
  return author;
};

/**
 * Concepts written through the slice's own write under the member `userId` names, an Admin, in order:
 * a concept links only to one before it.
 */
export const seedConcepts = async (
  app: TestApp,
  asked: z.output<typeof conceptsSeeding>,
): Promise<{ readonly concepts: readonly SeededConcept[] }> => {
  const { workspaceId, userId } = asked;
  const git = openTestGit(app);
  await initRepository(git, workspaceId);
  const writer = {
    principal: await actingIn(app, { workspaceId, userId }, async (principal) => principal),
    author: await authorOf(app, userId),
    git,
  };
  const concepts: SeededConcept[] = [];
  for (const concept of asked.concepts) {
    concepts.push(await seedConcept(app, writer, concept, concepts));
  }
  return { concepts };
};
