import { z } from "zod";

import { TRUST_TIERS } from "@better-answers/core/answering";
import { overrideConceptSensitivity, writeConcept } from "@better-answers/core/concepts";
import { actorIdOfPerson, type UserPrincipal } from "@better-answers/core/kernel";
import { head, initRepository } from "@better-answers/core/store/git";
import { AUDIENCES, SENSITIVITIES } from "@better-answers/schema";
import { testData } from "@better-answers/schema/testing";

import { inOneTransaction, seedPassages } from "./harness-sources.ts";
import { actingIn, openTestGit, type TestApp } from "./harness.ts";

const SUITE_VERIFIER = "process:better-answers-browser-suite";

const aCitedDocument = z.object({
  title: z.string().min(1),
  passages: z.array(z.string().min(1)).min(1),
});

const aConcept = z.object({
  title: z.string().min(1),
  kind: z.string().min(1).default("Answer"),
  body: z.string().min(1),
  sensitivity: z.enum(SENSITIVITIES).default("Internal"),
  audience: z.enum(AUDIENCES).default("everyone"),
  readers: z.array(z.string().min(1)).default([]),
  trust: z.enum(TRUST_TIERS).default("unverified"),
  linksTo: z.array(z.string().min(1)).default([]),
  sources: z.array(aCitedDocument).default([]),
});

type AskedConcept = z.output<typeof aConcept>;

export const conceptsSeeding = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  concepts: z.array(aConcept).min(1),
});

type Citation = {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly locator: string;
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
};

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");

/** One published connected source per concept, at its sensitivity; each passage is cited apart. */
const citationsOf = async (
  app: TestApp,
  workspaceId: string,
  concept: AskedConcept,
): Promise<readonly Citation[]> => {
  if (concept.sources.length === 0) return [];
  return inOneTransaction(app, async (client) => {
    const seed = testData(client);
    const connectedSource = await seed.connectedSource({
      workspaceId,
      name: `${concept.title} sources`,
      sensitivity: concept.sensitivity,
      publishedAt: new Date(),
      state: "published",
    });
    const citations: Citation[] = [];
    for (const source of concept.sources) {
      const document = await seed.sourceDocument({
        workspaceId,
        connectedSourceId: connectedSource.id,
        title: source.title,
        sourceSystemId: source.title,
      });
      const locators = await seedPassages(
        seed,
        workspaceId,
        connectedSource.id,
        document.id,
        source.passages,
      );
      for (const locator of locators) {
        const id = `source-${String(citations.length + 1)}`;
        citations.push({ id, documentId: document.id, title: source.title, locator });
      }
    }
    return citations;
  });
};

/** A citation mark per source after the body's own words, then a link to each concept it names. */
const bodyOf = (
  concept: AskedConcept,
  citations: readonly Citation[],
  links: readonly SeededConcept[],
): string => {
  const marks = citations.map((citation) => `[^${citation.id}]`).join("");
  const named = links.map((link) => `[${link.title}](${slugOf(link.title)}.md)`);
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
  const { principal } = writer;
  const citations = await citationsOf(app, principal.workspaceId, concept);
  const path = `knowledge/${slugOf(concept.title)}.md`;
  const git = openTestGit(app);
  await initRepository(git, principal.workspaceId);
  const written = await writeConcept(
    principal,
    { git, postgres: app.doors.postgres, clock: app.doors.clock },
    {
      mergeKey: `${slugOf(concept.kind)}:${slugOf(concept.title)}`,
      path,
      kind: concept.kind,
      title: concept.title,
      frontmatter: {
        title: concept.title,
        type: concept.kind,
        sources: citations.map(({ id, title, locator }) => ({
          id,
          title,
          resource: title,
          locator,
        })),
      },
      body: bodyOf(concept, citations, linkedFrom(concept, earlier)),
      message: `Record ${concept.title}`,
      author: writer.author,
      expects: { head: await head(principal, git) },
      status: "stable",
      sensitivity: concept.sensitivity,
      evidence: citations.map(({ documentId, title, locator }) => ({
        sourceDocumentId: documentId,
        locator,
        resource: title,
      })),
    },
  );
  if (!written.ok) throw new Error(`${concept.title} was refused: ${String(written.error)}`);
  return { ...written.value, path, citations };
};

/** The Admin's own override, to a group holding `readers`: a write alone leaves a new concept everyone's. */
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
    for (const reader of concept.readers) {
      await seed.groupMember({ workspaceId, groupId: made.id, userId: reader });
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
  if (concept.trust !== "unverified") await verified(app, writer, concept, written);
  const documents = new Map(written.citations.map(({ documentId, title }) => [documentId, title]));
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
  const writer = {
    principal: await actingIn(app, { workspaceId, userId }, async (principal) => principal),
    author: await authorOf(app, userId),
  };
  const concepts: SeededConcept[] = [];
  for (const concept of asked.concepts) {
    concepts.push(await seedConcept(app, writer, concept, concepts));
  }
  return { concepts };
};
