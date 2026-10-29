import { execFile } from "node:child_process";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import { TRUST_TIERS } from "@better-answers/core/answering";
import {
  foldKind,
  mergeKeyOf,
  nameOwner,
  nameOwnerInput,
  overrideConceptSensitivity,
  submitSuggestionSet,
  writeConcept,
} from "@better-answers/core/concepts";
import { actorIdOfPerson, type UserPrincipal } from "@better-answers/core/kernel";
import { head, initRepository, type GitDoor } from "@better-answers/core/store/git";
import { AUDIENCES, COLLECTION, conceptFrontmatter, SENSITIVITIES } from "@better-answers/schema";
import { conceptIndexRows, testData } from "@better-answers/schema/testing";

import { inOneTransaction, seedPassages } from "./harness-sources.ts";
import { actingIn, openTestGit, type TestApp } from "./harness.ts";

const SUITE_VERIFIER = "process:better-answers-browser-suite";

const execFileAsync = promisify(execFile);

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

const aConcept = z
  .object({
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
  })
  .superRefine((concept, context) => {
    if (concept.audience !== "groups") return;
    for (const [nth, memberId] of concept.groupMemberIds.entries()) {
      if (!concept.groupMemberIds.slice(0, nth).includes(memberId)) continue;
      context.addIssue({
        code: "custom",
        path: ["groupMemberIds", nth],
        message: "a group names each member once",
      });
    }
  });

type AskedConcept = z.output<typeof aConcept>;

const shortNameOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");

const pathOf = ({ title, collection }: Pick<AskedConcept, "title" | "collection">): string =>
  ["knowledge", ...(collection === undefined ? [] : [collection]), `${shortNameOf(title)}.md`].join(
    "/",
  );

const mergeKeyFor = ({ kind, title }: Pick<AskedConcept, "kind" | "title">): string =>
  mergeKeyOf(foldKind(kind), title);

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
      const before = asked.concepts.slice(0, at);
      const earlier = new Set(before.map((seeded) => seeded.title));
      const file = pathOf(concept);
      if (
        earlier.has(concept.title) ||
        before.some((seeded) => mergeKeyFor(seeded) === mergeKeyFor(concept))
      ) {
        context.addIssue({
          code: "custom",
          path: ["concepts", at, "title"],
          message: "a seed gives each title to one concept, whatever its case and spacing",
        });
      } else if (before.some((seeded) => pathOf(seeded) === file)) {
        context.addIssue({
          code: "custom",
          path: ["concepts", at, "title"],
          message: `a seed gives each file to one concept, and ${file} is named twice`,
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

const conceptCited = (seeding: Seeding, title: string): readonly Unnumbered[] =>
  seeding.earlier
    .filter((seeded) => seeded.title === title)
    .slice(0, 1)
    .map((named) => ({ title, resource: named.iri }));

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
      mergeKey: mergeKeyFor(concept),
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
    },
  );
  if (!written.ok) throw new Error(`${concept.title} was refused: ${String(written.error)}`);
  return { ...written.value, path, citations };
};

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

type Role = UserPrincipal["role"];

type Refusal = { readonly path: readonly (string | number)[]; readonly message: string };

const heldAhead = async (app: TestApp, asked: Asked) => {
  const { superuser } = app.database;
  const { workspaceId, concepts } = asked;
  const files = await superuser.query<{ held: string }>(
    "SELECT path AS held FROM concept_index WHERE workspace_id = $1 AND path = ANY($2)",
    [workspaceId, concepts.map(pathOf)],
  );
  const members = await superuser.query<{ held: string; role: Role }>(
    "SELECT user_id AS held, role FROM member WHERE workspace_id = $1",
    [workspaceId],
  );
  return {
    files: new Set(files.rows.map((row) => row.held)),
    members: new Map(members.rows.map((row) => [row.held, row.role])),
  };
};

const titlesHeld = (asked: Asked, held: ReadonlySet<string>): readonly Refusal[] =>
  asked.concepts.flatMap((concept, at) => {
    const file = pathOf(concept);
    return held.has(file)
      ? [{ path: ["concepts", at, "title"], message: `the workspace already holds ${file}` }]
      : [];
  });

const strangersToTheWorkspace = (
  asked: Asked,
  members: ReadonlyMap<string, Role>,
): readonly Refusal[] =>
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

const writerRefused = (role: Role | undefined): readonly Refusal[] => {
  if (role === undefined) {
    return [{ path: ["userId"], message: "a seed's writer is a member of the workspace" }];
  }
  if (role === "Admin") return [];
  return [
    {
      path: ["userId"],
      message: "a concept is seeded by an Admin, since the seed names nobody its owner",
    },
  ];
};

const refusedWith = (refusals: readonly Refusal[]): z.ZodError =>
  new z.ZodRealError(
    refusals.map(({ path, message }) => ({ code: "custom", path: [...path], message })),
  );

const refuse = (refusals: readonly Refusal[]): void => {
  if (refusals.length === 0) return;
  throw refusedWith(refusals);
};

export const seedConcepts = async (
  app: TestApp,
  asked: Asked,
): Promise<{ readonly concepts: readonly SeededConcept[] }> => {
  const { workspaceId, userId } = asked;
  const git = openTestGit(app);
  const held = await heldAhead(app, asked);
  refuse([
    ...writerRefused(held.members.get(userId)),
    ...titlesHeld(asked, held.files),
    ...strangersToTheWorkspace(asked, held.members),
  ]);
  const principal = await actingIn(app, { workspaceId, userId }, async (resolved) => resolved);
  await initRepository(git, workspaceId);
  const writer = { principal, author: await authorOf(app, userId), git };
  const concepts: SeededConcept[] = [];
  for (const concept of asked.concepts) {
    concepts.push(await seedConcept(app, writer, concept, concepts));
  }
  return { concepts };
};

export const ownersNaming = z.strictObject({
  workspaceId: z.string(),
  userId: z.string(),
  owners: z.array(nameOwnerInput).min(1),
});

export const nameOwners = async (
  app: TestApp,
  asked: z.output<typeof ownersNaming>,
): Promise<{ readonly named: number }> => {
  const { workspaceId, userId } = asked;
  for (const [at, owner] of asked.owners.entries()) {
    const { named } = await actingIn(app, { workspaceId, userId }, async (principal, tx) => ({
      named: await nameOwner(principal, tx, owner),
    }));
    if (!named.ok) {
      refuse([{ path: ["owners", at], message: `naming this owner was refused: ${named.error}` }]);
    }
  }
  return { named: asked.owners.length };
};

const SEEDED_AT_MOST = 5_000;

export const conceptIndexSeeding = z.strictObject({
  workspaceId: z.string(),
  batches: z
    .array(
      z.strictObject({
        collection: z.string().regex(COLLECTION).nullable(),
        kind: z.string().trim().min(1),
        count: z.int().min(1).max(SEEDED_AT_MOST),
        title: z.string().trim().min(1).optional(),
        sensitivity: z.enum(SENSITIVITIES).optional(),
        audienceGroups: z.array(z.string()).min(1).optional(),
      }),
    )
    .min(1),
});

type IndexBatch = z.output<typeof conceptIndexSeeding>["batches"][number];

const seededPath = (batch: IndexBatch, slug: string): string =>
  batch.collection === null ? `knowledge/${slug}.md` : `knowledge/${batch.collection}/${slug}.md`;

const SEEDED_SENSITIVITY = "Internal" satisfies (typeof SENSITIVITIES)[number];

export const seedConceptIndex = async (
  app: TestApp,
  asked: z.output<typeof conceptIndexSeeding>,
): Promise<{ readonly seeded: number }> => {
  const { workspaceId } = asked;
  const seeded = await inOneTransaction(app, async (client) => {
    const { sha: commitSha } = await testData(client).bundleCommit({ workspaceId });
    let rows = 0;
    for (const [at, batch] of asked.batches.entries()) {
      const width = String(batch.count).length;
      const places = Array.from({ length: batch.count }, (_unused, place) => place + 1);
      await conceptIndexRows(client, {
        workspaceId,
        commitSha,
        kind: batch.kind,
        sensitivity: batch.sensitivity ?? SEEDED_SENSITIVITY,
        audienceGroups: batch.audienceGroups ?? null,
        concepts: places.map((place) => ({
          path: seededPath(batch, `seeded-${commitSha.slice(0, 12)}-${at}-${place}`),
          title: `${batch.title ?? batch.kind} ${String(place).padStart(width, "0")}`,
        })),
      });
      rows += batch.count;
    }
    return rows;
  });
  await app.database.superuser.query("ANALYZE concept_identity, concept_index");
  return { seeded };
};

export const editSuggesting = z.strictObject({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  iri: z.string().min(1),
  title: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

type StandingFile = {
  readonly path: string;
  readonly kind: string;
  readonly title: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
  readonly content_hash: string;
  readonly merge_key: string;
};

const standingFileOf = async (
  app: TestApp,
  asked: { readonly workspaceId: string; readonly iri: string },
): Promise<StandingFile> => {
  const found = await app.database.superuser.query<StandingFile>(
    `SELECT c.path, c.kind, c.title, c.frontmatter, c.body, c.content_hash, i.merge_key
       FROM concept_index c
       JOIN concept_identity i ON i.workspace_id = c.workspace_id AND i.iri = c.iri
      WHERE c.workspace_id = $1 AND c.iri = $2`,
    [asked.workspaceId, asked.iri],
  );
  const standing = found.rows[0];
  if (standing === undefined) {
    throw refusedWith([{ path: ["iri"], message: "the workspace holds no concept at this IRI" }]);
  }
  return standing;
};

export const seedEditSuggestion = async (
  app: TestApp,
  asked: z.output<typeof editSuggesting>,
): Promise<{ readonly suggestionId: string; readonly setId: string }> => {
  const { workspaceId, userId } = asked;
  const standing = await standingFileOf(app, asked);
  const title = asked.title ?? standing.title;
  const principal = await actingIn(app, { workspaceId, userId }, async (resolved) => resolved);
  const submitted = await submitSuggestionSet(
    principal,
    { postgres: app.doors.postgres },
    {
      kind: "edit",
      requests: [
        {
          mergeKey: standing.merge_key,
          path: standing.path,
          conceptKind: standing.kind,
          title,
          frontmatter: conceptFrontmatter.parse({ ...standing.frontmatter, title }),
          body: asked.body ?? standing.body,
          baseContentHash: standing.content_hash,
        },
      ],
    },
  );
  if (!submitted.ok) {
    throw refusedWith([
      { path: ["userId"], message: `the suggestion was refused: ${String(submitted.error)}` },
    ]);
  }
  const [suggestionId] = submitted.value.suggestionIds;
  if (suggestionId === undefined) throw new Error("the set holds no suggestion");
  return { suggestionId, setId: submitted.value.setId };
};

const commitAuthorsAsking = z.strictObject({
  workspaceId: z.string().min(1),
  iri: z.string().min(1),
});

export const commitAuthorsOf = async (
  app: TestApp,
  asked: z.output<typeof commitAuthorsAsking>,
): Promise<{ readonly authors: readonly string[] }> => {
  const standing = await standingFileOf(app, asked);
  const { stdout } = await execFileAsync("git", [
    "--git-dir",
    join(openTestGit(app).root, `${asked.workspaceId}.git`),
    "log",
    "--format=%an <%ae>",
    "main",
    "--",
    standing.path,
  ]);
  return { authors: stdout.split("\n").filter((line) => line !== "") };
};
