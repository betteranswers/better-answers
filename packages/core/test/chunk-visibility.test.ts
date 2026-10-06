import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { ulid } from "@better-answers/schema";

import type { Sensitivity } from "../src/access/index.ts";
import { find, open } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  narrowConnectedSource,
  narrowConnectedSourceInput,
  narrowDocuments,
  narrowDocumentsInput,
  passageAt,
  previewChunks,
  previewChunksInput,
  publishConnectedSource,
  publishConnectedSourceInput,
} from "../src/sources/index.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { answered } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");
const RUN_FINISHED_AT = new Date("2026-09-11T08:30:00.000Z");
const NOW = new Date("2026-09-11T12:00:00.000Z");

/**
 * Every document below answers this query, so an absent hit is the read predicate and never an
 * unmatched term.
 */
const QUERY = "holiday policy";

const HANDBOOK = "The holiday policy grants twenty-eight days.";
const ANNEX = "The holiday policy annex covers part-time staff.";
const MINUTES = "The holiday policy was approved by the board.";

const LEADING = "The holiday policy ";
const TRAILING = "grants twenty-eight days.";
const SECOND_ROW = "The holiday policy also covers part-time staff.";

type Visibility = {
  readonly publishedAt: Date | null;
  readonly sensitivity: Sensitivity;
  readonly audience: string;
  readonly audienceGroups: readonly string[] | null;
};

const PUBLISHED_AND_INTERNAL: Visibility = {
  publishedAt: PUBLISHED,
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
};

const aConnectedSource = (workspaceId: string, said: Partial<Visibility> = {}): Promise<string> =>
  seededBy(db(), async (seed) => {
    const held = { ...PUBLISHED_AND_INTERNAL, ...said };
    const row = await seed.connectedSource({
      workspaceId,
      ...held,
      audienceGroups: held.audienceGroups === null ? null : [...held.audienceGroups],
    });
    return row.id;
  });

const aDocument = (
  workspaceId: string,
  connectedSourceId: string,
  said: { readonly title: string; readonly sensitivity?: Sensitivity | null },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.sourceDocument({
      workspaceId,
      connectedSourceId,
      title: said.title,
      sensitivity: said.sensitivity ?? null,
    });
    return row.id;
  });

type Landing = {
  readonly connectedSourceId: string;
  readonly documentId: string;
  readonly text: string;
};

const wireOf = (documentId: string, text: string): string => `${documentId}/chars:0-${text.length}`;

const landed = (workspaceId: string, where: Landing): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.chunk({
      workspaceId,
      connectedSourceId: where.connectedSourceId,
      sourceDocumentId: where.documentId,
      content: where.text,
      locator: wireOf(where.documentId, where.text),
      ordinal: 0,
      charStart: 0,
      charEnd: where.text.length,
    });
  });

const landedBeside = (
  workspaceId: string,
  first: Landing,
  connectedSourceId: string,
  text: string,
): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.chunk({
      workspaceId,
      connectedSourceId,
      sourceDocumentId: first.documentId,
      content: text,
      locator: `${first.documentId}/chars:${first.text.length}-${first.text.length + text.length}`,
      ordinal: 1,
      charStart: first.text.length,
      charEnd: first.text.length + text.length,
    });
  });

const aFinishedRun = (workspaceId: string, connectedSourceId: string): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.job({
      workspaceId,
      kind: "index",
      subjectId: connectedSourceId,
      reason: "connected",
      status: "done",
      enqueuedAt: RUN_FINISHED_AT,
      attempts: 1,
      claimedBy: "worker-1",
      claimedAt: RUN_FINISHED_AT,
      finishedAt: RUN_FINISHED_AT,
      outcome: { chunks: 1 },
    });
  });

/**
 * Every act refuses a widening, so the restoring half of each pair can only be written onto
 * the source row itself.
 */
const theConnectedSourceRowNowSays = async (
  workspaceId: string,
  connectedSourceId: string,
  said: Partial<Visibility>,
): Promise<void> => {
  const held = { ...PUBLISHED_AND_INTERNAL, ...said };
  await db().pool.query(
    `UPDATE connected_source
        SET published_at = $3, sensitivity = $4, audience = $5, audience_groups = $6
      WHERE workspace_id = $1 AND id = $2`,
    [
      workspaceId,
      connectedSourceId,
      held.publishedAt,
      held.sensitivity,
      held.audience,
      held.audienceGroups === null ? null : [...held.audienceGroups],
    ],
  );
};

/** The schema refuses a class wider than the Admin's narrowing, so the narrowing goes with it. */
const theDocumentRowNowSays = async (
  workspaceId: string,
  documentId: string,
  sensitivity: Sensitivity | null,
): Promise<void> => {
  await db().pool.query(
    `UPDATE source_document SET sensitivity = $3, narrowed_to = NULL
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, documentId, sensitivity],
  );
};

const aConnectedSourceHoldingOneDocument = async (
  workspaceId: string,
  said: {
    readonly title: string;
    readonly text: string;
    readonly connectedSource?: Partial<Visibility>;
  },
): Promise<Landing> => {
  const connectedSourceId = await aConnectedSource(workspaceId, said.connectedSource);
  const documentId = await aDocument(workspaceId, connectedSourceId, { title: said.title });
  return { connectedSourceId, documentId, text: said.text };
};

const aSiblingUnder = async (
  workspaceId: string,
  where: Landing,
  said: { readonly title: string; readonly text: string },
): Promise<Landing> => ({
  connectedSourceId: where.connectedSourceId,
  documentId: await aDocument(workspaceId, where.connectedSourceId, { title: said.title }),
  text: said.text,
});

type Reach = { readonly found: boolean; readonly opened: boolean };

const REACHED: Reach = { found: true, opened: true };
const WITHHELD: Reach = { found: false, opened: false };

const sourceHits = async (person: UserPrincipal): Promise<readonly string[]> =>
  answered(
    await reading(person, async (reader, tx) => {
      const found = await find(reader, tx, { query: QUERY, limit: 10 }, NOW);
      if (!found.ok) throw found.error;
      return found.value.hits.flatMap((hit) => (hit.layer === "sources" ? [hit.locator] : []));
    }),
  );

const rowsFound = async (person: UserPrincipal, documentId: string): Promise<number> =>
  (await sourceHits(person)).filter((locator) => locator.startsWith(`${documentId}/`)).length;

const reaches = async (person: UserPrincipal, where: Landing): Promise<Reach> => {
  const wire = wireOf(where.documentId, where.text);
  const found = (await sourceHits(person)).includes(wire);
  const opened = answered(
    await reading(person, async (reader, tx) => {
      const read = await open(reader, tx, { locator: wire }, NOW);
      if (!read.ok) throw read.error;
      return read.value;
    }),
  );
  return { found, opened: opened.found };
};

const opening = async (person: UserPrincipal, wire: string): Promise<unknown> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await passageAt(reader, tx, wire);
      return read.ok ? read.value : read.error;
    }),
  );

const previewing = async (
  person: UserPrincipal,
  connectedSourceId: string,
): Promise<readonly string[]> =>
  answered(
    await reading(person, async (reader, tx) => {
      const listed = await previewChunks(
        reader,
        tx,
        inputOf(previewChunksInput, { connectedSourceId }),
      );
      if (!listed.ok) throw new Error(`the preview was refused: ${String(listed.error)}`);
      return listed.value.map((chunk) => chunk.locator);
    }),
  );

const narrowedTo = (
  connectedSourceId: string,
  sensitivity: Sensitivity,
): z.input<typeof narrowConnectedSourceInput> => ({
  connectedSourceId,
  sensitivity,
  audience: "everyone",
  audienceGroups: null,
});

const narrowingTheConnectedSource = (
  scenario: Scenario,
  connectedSourceId: string,
  to: Sensitivity,
) =>
  reading(scenario.admin, (admin, tx) =>
    narrowConnectedSource(
      admin,
      tx,
      inputOf(narrowConnectedSourceInput, narrowedTo(connectedSourceId, to)),
    ),
  );

const narrowingTheDocument = (scenario: Scenario, connectedSourceId: string, documentId: string) =>
  reading(scenario.admin, (admin, tx) =>
    narrowDocuments(
      admin,
      tx,
      inputOf(narrowDocumentsInput, {
        connectedSourceId,
        findingGroups: [
          {
            documentId,
            category: "bank-details",
            ruleId: "sort-code-with-account-number",
            tier: "always",
          },
        ],
        sensitivity: "Restricted",
      }),
    ),
  );

const publishingTheConnectedSource = (scenario: Scenario, connectedSourceId: string) =>
  reading(scenario.admin, (admin, tx) =>
    publishConnectedSource(admin, tx, {
      ...inputOf(publishConnectedSourceInput, {
        connectedSourceId,
        confirmations: {
          lawfulBasisRecorded: true,
          privacyInformationUpdated: true,
          dpiaReferenced: true,
        },
      }),
      publishedAt: PUBLISHED,
    }),
  );

describe("a reader's answer as the Admin's acts move source rows", () => {
  it("withholds a source's passages when narrowed, restoring them once widened", async () => {
    const scenario = await arrange();
    const where = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const { connectedSourceId } = where;
    await landed(scenario.workspaceId, where);

    const before = await reaches(scenario.viewer, where);
    answered(await narrowingTheConnectedSource(scenario, connectedSourceId, "Restricted"));
    const after = await reaches(scenario.viewer, where);
    await theConnectedSourceRowNowSays(scenario.workspaceId, connectedSourceId, {
      sensitivity: "Internal",
    });
    const widened = await reaches(scenario.viewer, where);

    expect({ before, after, widened }).toEqual({
      before: REACHED,
      after: WITHHELD,
      widened: REACHED,
    });
  });

  it("withholds a narrowed document's chunks, sparing its sibling, both ways", async () => {
    const scenario = await arrange();
    const theOne = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const theOther = await aSiblingUnder(scenario.workspaceId, theOne, {
      title: "The handbook annex",
      text: ANNEX,
    });
    await landed(scenario.workspaceId, theOne);
    await landedBeside(scenario.workspaceId, theOne, theOne.connectedSourceId, SECOND_ROW);
    await landed(scenario.workspaceId, theOther);

    const before = await rowsFound(scenario.viewer, theOne.documentId);
    answered(await narrowingTheDocument(scenario, theOne.connectedSourceId, theOne.documentId));
    const after = await rowsFound(scenario.viewer, theOne.documentId);
    const siblingAfter = await reaches(scenario.viewer, theOther);
    await theDocumentRowNowSays(scenario.workspaceId, theOne.documentId, null);
    const widened = await rowsFound(scenario.viewer, theOne.documentId);

    expect({
      before,
      after,
      siblingAfter,
      widened,
      opened: await reaches(scenario.viewer, theOne),
    }).toEqual({
      before: 2,
      after: 0,
      siblingAfter: REACHED,
      widened: 2,
      opened: REACHED,
    });
  });

  it("reveals a source's passages when published, withholding them once unpublished", async () => {
    const scenario = await arrange();
    const where = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The board's minutes",
      text: MINUTES,
      connectedSource: { publishedAt: null },
    });
    const { connectedSourceId } = where;
    await landed(scenario.workspaceId, where);
    await aFinishedRun(scenario.workspaceId, connectedSourceId);

    const before = await reaches(scenario.viewer, where);
    answered(await publishingTheConnectedSource(scenario, connectedSourceId));
    const after = await reaches(scenario.viewer, where);
    await theConnectedSourceRowNowSays(scenario.workspaceId, connectedSourceId, {
      publishedAt: null,
    });
    const unpublished = await reaches(scenario.viewer, where);

    expect({ before, after, unpublished }).toEqual({
      before: WITHHELD,
      after: REACHED,
      unpublished: WITHHELD,
    });
  });
});

type JobRow = {
  readonly kind: string;
  readonly reason: string | null;
  readonly subject_id: string | null;
  readonly status: string;
};

const jobsOf = async (workspaceId: string): Promise<readonly JobRow[]> =>
  (
    await db().pool.query<JobRow>(
      "SELECT kind, reason, subject_id, status FROM job WHERE workspace_id = $1",
      [workspaceId],
    )
  ).rows;

describe("a narrowing queues no run", () => {
  it("adds no job when an Admin narrows sources or documents", async () => {
    const scenario = await arrange();
    const theConnectedSource = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const theOther = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The handbook annex",
      text: ANNEX,
    });
    await landed(scenario.workspaceId, theConnectedSource);
    await landed(scenario.workspaceId, theOther);
    // The run that had already been and gone, so an empty answer below is the act and not a
    // reader that sees nothing.
    await aFinishedRun(scenario.workspaceId, theOther.connectedSourceId);
    const theRunThatRan = {
      kind: "index",
      reason: "connected",
      subject_id: theOther.connectedSourceId,
      status: "done",
    };

    const before = await jobsOf(scenario.workspaceId);
    answered(
      await narrowingTheConnectedSource(
        scenario,
        theConnectedSource.connectedSourceId,
        "Restricted",
      ),
    );
    const afterTheConnectedSource = await jobsOf(scenario.workspaceId);
    answered(await narrowingTheDocument(scenario, theOther.connectedSourceId, theOther.documentId));
    const afterTheDocuments = await jobsOf(scenario.workspaceId);

    expect({ before, afterTheConnectedSource, afterTheDocuments }).toEqual({
      before: [theRunThatRan],
      afterTheConnectedSource: [theRunThatRan],
      afterTheDocuments: [theRunThatRan],
    });
  });
});

type HeldNarrowing = { readonly commit: () => Promise<void> };

/**
 * The act's work does not return until `commit` is called, so its transaction stays open with
 * the narrowing applied and uncommitted.
 */
const aNarrowingHeldUncommitted = async (
  scenario: Scenario,
  connectedSourceId: string,
): Promise<HeldNarrowing> => {
  const applied = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const asked = inputOf(narrowConnectedSourceInput, narrowedTo(connectedSourceId, "Restricted"));
  const act = reading(scenario.admin, async (admin, tx) => {
    try {
      return await narrowConnectedSource(admin, tx, asked);
    } finally {
      applied.resolve();
      await held.promise;
    }
  });
  await applied.promise;
  return {
    commit: async () => {
      held.resolve();
      answered(await act);
    },
  };
};

describe("the race with a narrowing in flight", () => {
  it("reads rows landed under an open narrowing until it commits", async () => {
    const scenario = await arrange();
    const where = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });

    const narrowing = await aNarrowingHeldUncommitted(scenario, where.connectedSourceId);
    await landed(scenario.workspaceId, where);
    const beforeTheCommit = await reaches(scenario.viewer, where);

    await narrowing.commit();

    const afterTheCommit = await reaches(scenario.viewer, where);

    expect({ beforeTheCommit, afterTheCommit }).toEqual({
      beforeTheCommit: REACHED,
      afterTheCommit: WITHHELD,
    });
  });

  it("withholds rows landed during a narrowing as those landed before", async () => {
    const scenario = await arrange();
    const theOld = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const theNew = await aSiblingUnder(scenario.workspaceId, theOld, {
      title: "The handbook annex",
      text: ANNEX,
    });
    await landed(scenario.workspaceId, theOld);

    const narrowing = await aNarrowingHeldUncommitted(scenario, theOld.connectedSourceId);
    await landed(scenario.workspaceId, theNew);
    await narrowing.commit();

    expect({
      landedLongBefore: await reaches(scenario.viewer, theOld),
      landedDuring: await reaches(scenario.viewer, theNew),
    }).toEqual({ landedLongBefore: WITHHELD, landedDuring: WITHHELD });
  });
});

describe("a passage whose rows do not all name one source", () => {
  // The connected source id has no foreign key, so one document's rows can name two connected sources — which is
  // what keeps `passageAt`'s fold reachable.
  it("is opened at the narrower source, withheld whole from Viewers", async () => {
    const scenario = await arrange();
    const wide = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: LEADING,
    });
    const narrow = await aConnectedSource(scenario.workspaceId, { sensitivity: "Restricted" });
    await landed(scenario.workspaceId, wide);
    await landedBeside(scenario.workspaceId, wide, narrow, TRAILING);
    const wire = `${wide.documentId}/chars:0-${LEADING.length + TRAILING.length}`;

    expect({
      admin: await opening(scenario.admin, wire),
      viewer: await opening(scenario.viewer, wire),
    }).toEqual({
      admin: {
        locator: wire,
        title: "The staff handbook",
        text: `${LEADING}${TRAILING}`,
        sensitivity: "Restricted",
      },
      viewer: "not-found",
    });
  });
});

describe("a chunk whose connected source row is absent", () => {
  // The chunk's connected source id carries no foreign key, so only the read closes this shape.
  it("is read and listed by nobody, unlike a live neighbour", async () => {
    const scenario = await arrange();
    const absent = ulid();
    const neighbour = await aConnectedSourceHoldingOneDocument(scenario.workspaceId, {
      title: "The handbook annex",
      text: ANNEX,
    });
    const orphaned = {
      ...(await aSiblingUnder(scenario.workspaceId, neighbour, {
        title: "The staff handbook",
        text: HANDBOOK,
      })),
      connectedSourceId: absent,
    };
    await landed(scenario.workspaceId, orphaned);
    await landed(scenario.workspaceId, neighbour);

    expect({
      orphanedPreview: await previewing(scenario.admin, absent),
      neighbourPreview: await previewing(scenario.admin, neighbour.connectedSourceId),
      orphanedReach: await reaches(scenario.viewer, orphaned),
      neighbourReach: await reaches(scenario.viewer, neighbour),
    }).toEqual({
      orphanedPreview: [],
      neighbourPreview: [wireOf(neighbour.documentId, neighbour.text)],
      orphanedReach: WITHHELD,
      neighbourReach: REACHED,
    });
  });
});
