import { posix } from "node:path";

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

const rulesBroken = (source: SourceKeys): readonly Broken[] => {
  if (source.concept !== undefined) return conceptRules(source);
  const untitled: readonly Broken[] =
    source.title === undefined ? [["title", "a document or a place names its source"]] : [];
  return [...untitled, ...(source.at === undefined ? documentRules(source) : placeRules(source))];
};

const aSource = z
  .strictObject({
    title: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    passages: z.array(z.string().min(1)).min(1).optional(),
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
  collection: z.string().min(1).optional(),
  kind: z.string().min(1).default("Answer"),
  body: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).default("Internal"),
  audience: z.enum(AUDIENCES).default("everyone"),
  groupMemberIds: z.array(z.string().min(1)).default([]),
  trust: z.enum(TRUST_TIERS).default("unverified"),
  linksTo: z.array(z.string().min(1)).default([]),
  sources: z.array(aSource).default([]),
  frontmatter: conceptFrontmatter.default({}),
});

type AskedConcept = z.output<typeof aConcept>;

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

const pathOf = ({ title, collection }: Pick<AskedConcept, "title" | "collection">): string =>
  ["knowledge", ...(collection === undefined ? [] : [collection]), `${shortNameOf(title)}.md`].join(
    "/",
  );

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
  readonly connectedSourceAt: (sensitivity: Sensitivity) => Promise<string>;
};

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

const bodyOf = (
  concept: AskedConcept,
  citations: readonly Citation[],
  links: readonly SeededConcept[],
): string => {
  const marks = citations
    .map((citation) => `[^${citation.id}]`)
    .filter((mark) => !concept.body.includes(mark))
    .join("");
  const folder = posix.dirname(pathOf(concept));
  const named = links.map((link) => `[${link.title}](${posix.relative(folder, link.path)})`);
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
  const path = pathOf(concept);
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

const heldCloser = (concept: AskedConcept, source: AskedSource): boolean =>
  source.sensitivity !== undefined && source.sensitivity !== concept.sensitivity;

const citesCloserHeldEvidence = (concept: AskedConcept): boolean =>
  concept.sources.some((source) => heldCloser(concept, source));

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

type Asked = z.output<typeof conceptsSeeding>;

type Refusal = { readonly path: readonly (string | number)[]; readonly message: string };

const heldAhead = async (app: TestApp, asked: Asked) => {
  const { superuser } = app.database;
  const { workspaceId, concepts } = asked;
  const files = await superuser.query<{ held: string }>(
    "SELECT path AS held FROM concept_index WHERE workspace_id = $1 AND path = ANY($2)",
    [workspaceId, concepts.map(pathOf)],
  );
  const members = await superuser.query<{ held: string }>(
    "SELECT user_id AS held FROM member WHERE workspace_id = $1",
    [workspaceId],
  );
  return {
    files: new Set(files.rows.map((row) => row.held)),
    members: new Set(members.rows.map((row) => row.held)),
  };
};

/** A title two concepts of one seed share is the schema's to refuse, from the body alone. */
const titlesHeld = (asked: Asked, held: ReadonlySet<string>): readonly Refusal[] =>
  asked.concepts.flatMap((concept, at) => {
    const file = pathOf(concept);
    return held.has(file)
      ? [{ path: ["concepts", at, "title"], message: `the workspace already holds ${file}` }]
      : [];
  });

const strangersToTheWorkspace = (asked: Asked, members: ReadonlySet<string>): readonly Refusal[] =>
  asked.concepts.flatMap((concept, at) =>
    (concept.audience === "groups" ? concept.groupMemberIds : []).flatMap((memberId, nth) =>
      members.has(memberId)
        ? []
        : [
            {
              path: ["concepts", at, "groupMemberIds", nth],
              message:
                "a group holds members of its workspace alone, which group_member_member_fk holds",
            },
          ],
    ),
  );

const overridesAsked = (asked: Asked): readonly Refusal[] =>
  asked.concepts.flatMap((concept, at) => {
    if (concept.audience === "groups") {
      return [
        {
          path: ["concepts", at, "audience"],
          message:
            "narrowing a concept to a group is an Admin's override, and the writer is no Admin",
        },
      ];
    }
    return concept.sources.flatMap((source, nth) =>
      heldCloser(concept, source)
        ? [
            {
              path: ["concepts", at, "sources", nth, "sensitivity"],
              message:
                "sharing a concept that cites a document held at another sensitivity is an Admin's override, and the writer is no Admin",
            },
          ]
        : [],
    );
  });

const writerRefused = (asked: Asked, writer: UserPrincipal): readonly Refusal[] => {
  if (writer.role === "Admin") return [];
  if (writer.role === "Editor") return overridesAsked(asked);
  return [{ path: ["userId"], message: "a concept is written by an Editor or an Admin" }];
};

/**
 * The slice commits each concept as written, so no transaction spans the seed.
 * @throws as a schema's `parse` does, for the 400.
 */
const refusedBeforeAnyWrite = async (
  app: TestApp,
  asked: Asked,
  writer: UserPrincipal,
): Promise<void> => {
  const held = await heldAhead(app, asked);
  const refusals = [
    ...writerRefused(asked, writer),
    ...titlesHeld(asked, held.files),
    ...strangersToTheWorkspace(asked, held.members),
  ];
  if (refusals.length === 0) return;
  throw new z.ZodRealError(
    refusals.map(({ path, message }) => ({ code: "custom", path: [...path], message })),
  );
};

export const seedConcepts = async (
  app: TestApp,
  asked: Asked,
): Promise<{ readonly concepts: readonly SeededConcept[] }> => {
  const { workspaceId, userId } = asked;
  const git = openTestGit(app);
  const principal = await actingIn(app, { workspaceId, userId }, async (resolved) => resolved);
  await refusedBeforeAnyWrite(app, asked, principal);
  await initRepository(git, workspaceId);
  const writer = { principal, author: await authorOf(app, userId), git };
  const concepts: SeededConcept[] = [];
  for (const concept of asked.concepts) {
    concepts.push(await seedConcept(app, writer, concept, concepts));
  }
  return { concepts };
};
