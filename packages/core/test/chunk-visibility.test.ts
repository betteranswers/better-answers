import { describe, expect, it } from "vitest";

import type { z } from "zod";

import { ulid } from "@better-answers/schema";

import type { Sensitivity } from "../src/access/index.ts";
import { find, open } from "../src/answering/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import {
  narrowBinding,
  narrowBindingInput,
  narrowDocuments,
  narrowDocumentsInput,
  passageAt,
  previewChunks,
  previewChunksInput,
  publishBinding,
  publishBindingInput,
} from "../src/sources/index.ts";
import { seededBy, visibilitySuite } from "./sourced-concept.ts";
import { answered } from "./suite-postgres.ts";
import { inputOf } from "./suite-input.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const PUBLISHED = new Date("2026-09-11T09:00:00.000Z");
const RUN_FINISHED_AT = new Date("2026-09-11T08:30:00.000Z");
const NOW = new Date("2026-09-11T12:00:00.000Z");

// Every document below answers this query, so an absent hit is the read predicate and never an
// unmatched term.
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

const aBinding = (workspaceId: string, said: Partial<Visibility> = {}): Promise<string> =>
  seededBy(db(), async (seed) => {
    const held = { ...PUBLISHED_AND_INTERNAL, ...said };
    const row = await seed.sourceBinding({
      workspaceId,
      ...held,
      audienceGroups: held.audienceGroups === null ? null : [...held.audienceGroups],
    });
    return row.id;
  });

const aDocument = (
  workspaceId: string,
  bindingId: string,
  said: { readonly title: string; readonly sensitivity?: Sensitivity | null },
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const row = await seed.sourceDocument({
      workspaceId,
      bindingId,
      title: said.title,
      sensitivity: said.sensitivity ?? null,
    });
    return row.id;
  });

type Landing = {
  readonly bindingId: string;
  readonly documentId: string;
  readonly text: string;
};

const wireOf = (documentId: string, text: string): string => `${documentId}/chars:0-${text.length}`;

const chunkRowOf = (workspaceId: string, where: Landing, copying: Visibility) => ({
  workspaceId,
  bindingId: where.bindingId,
  sourceDocumentId: where.documentId,
  content: where.text,
  locator: wireOf(where.documentId, where.text),
  ordinal: 0,
  charStart: 0,
  charEnd: where.text.length,
  publishedAt: copying.publishedAt,
  sensitivity: copying.sensitivity,
  audience: copying.audience,
  audienceGroups: copying.audienceGroups === null ? null : [...copying.audienceGroups],
});

const landed = (workspaceId: string, where: Landing, copying: Visibility): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.chunk(chunkRowOf(workspaceId, where, copying));
  });

// Reading the binding is what makes the race real: both tiers still copy what they saw.
const landedCopyingItsBinding = (workspaceId: string, where: Landing): Promise<void> =>
  seededBy(db(), async (seed) => {
    const read = await db().pool.query<Visibility>(
      `SELECT published_at AS "publishedAt", sensitivity, audience,
              audience_groups AS "audienceGroups"
         FROM source_binding WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, where.bindingId],
    );
    const seen = read.rows[0];
    if (seen === undefined) throw new Error("the lander found no binding to copy");
    await seed.chunk(chunkRowOf(workspaceId, where, seen));
  });

const landedBeside = (
  workspaceId: string,
  first: Landing,
  bindingId: string,
  text: string,
): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.chunk({
      workspaceId,
      bindingId,
      sourceDocumentId: first.documentId,
      content: text,
      locator: `${first.documentId}/chars:${first.text.length}-${first.text.length + text.length}`,
      ordinal: 1,
      charStart: first.text.length,
      charEnd: first.text.length + text.length,
      publishedAt: PUBLISHED,
      sensitivity: "Internal",
      audience: "everyone",
      audienceGroups: null,
    });
  });

const aFinishedRun = (workspaceId: string, bindingId: string): Promise<void> =>
  seededBy(db(), async (seed) => {
    await seed.job({
      workspaceId,
      kind: "index",
      subjectId: bindingId,
      reason: "bound",
      status: "done",
      enqueuedAt: RUN_FINISHED_AT,
      attempts: 1,
      claimedBy: "worker-1",
      claimedAt: RUN_FINISHED_AT,
      finishedAt: RUN_FINISHED_AT,
      outcome: { chunks: 1 },
    });
  });

// Every act refuses a widening, so the restoring half of each pair can only be written onto
// the source row itself.
const theBindingRowNowSays = async (
  workspaceId: string,
  bindingId: string,
  said: Partial<Visibility>,
): Promise<void> => {
  const held = { ...PUBLISHED_AND_INTERNAL, ...said };
  await db().pool.query(
    `UPDATE source_binding
        SET published_at = $3, sensitivity = $4, audience = $5, audience_groups = $6
      WHERE workspace_id = $1 AND id = $2`,
    [
      workspaceId,
      bindingId,
      held.publishedAt,
      held.sensitivity,
      held.audience,
      held.audienceGroups === null ? null : [...held.audienceGroups],
    ],
  );
};

const theDocumentRowNowSays = async (
  workspaceId: string,
  documentId: string,
  sensitivity: Sensitivity | null,
): Promise<void> => {
  await db().pool.query(
    "UPDATE source_document SET sensitivity = $3 WHERE workspace_id = $1 AND id = $2",
    [workspaceId, documentId, sensitivity],
  );
};

const copiesUnder = async (
  workspaceId: string,
  documentId: string,
): Promise<readonly { readonly sensitivity: string }[]> => {
  const read = await db().pool.query<{ sensitivity: string }>(
    `SELECT sensitivity FROM "index".chunk
      WHERE workspace_id = $1 AND source_document_id = $2 ORDER BY ordinal`,
    [workspaceId, documentId],
  );
  return read.rows;
};

const aBindingHoldingOneDocument = async (
  workspaceId: string,
  said: { readonly title: string; readonly text: string; readonly binding?: Partial<Visibility> },
): Promise<Landing> => {
  const bindingId = await aBinding(workspaceId, said.binding);
  const documentId = await aDocument(workspaceId, bindingId, { title: said.title });
  return { bindingId, documentId, text: said.text };
};

const aSiblingUnder = async (
  workspaceId: string,
  where: Landing,
  said: { readonly title: string; readonly text: string },
): Promise<Landing> => ({
  bindingId: where.bindingId,
  documentId: await aDocument(workspaceId, where.bindingId, { title: said.title }),
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

const previewing = async (person: UserPrincipal, bindingId: string): Promise<readonly string[]> =>
  answered(
    await reading(person, async (reader, tx) => {
      const listed = await previewChunks(reader, tx, inputOf(previewChunksInput, { bindingId }));
      if (!listed.ok) throw new Error(`the preview was refused: ${String(listed.error)}`);
      return listed.value.map((chunk) => chunk.locator);
    }),
  );

const narrowedTo = (
  bindingId: string,
  sensitivity: Sensitivity,
): z.input<typeof narrowBindingInput> => ({
  bindingId,
  sensitivity,
  audience: "everyone",
  audienceGroups: null,
});

const narrowingTheBinding = (scenario: Scenario, bindingId: string, to: Sensitivity) =>
  reading(scenario.admin, (admin, tx) =>
    narrowBinding(admin, tx, inputOf(narrowBindingInput, narrowedTo(bindingId, to))),
  );

const narrowingTheDocument = (scenario: Scenario, bindingId: string, documentId: string) =>
  reading(scenario.admin, (admin, tx) =>
    narrowDocuments(
      admin,
      tx,
      inputOf(narrowDocumentsInput, {
        bindingId,
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

const publishingTheBinding = (scenario: Scenario, bindingId: string) =>
  reading(scenario.admin, (admin, tx) =>
    publishBinding(admin, tx, {
      ...inputOf(publishBindingInput, {
        bindingId,
        confirmations: {
          lawfulBasisRecorded: true,
          privacyInformationUpdated: true,
          dpiaReferenced: true,
        },
      }),
      publishedAt: PUBLISHED,
    }),
  );

describe("the answer a reader gets, as the Admin's acts move the source rows", () => {
  it("takes a binding's passages from a Viewer the instant the narrowing commits, and hands them back when the row widens again", async () => {
    const scenario = await arrange();
    const where = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const { bindingId } = where;
    await landed(scenario.workspaceId, where, PUBLISHED_AND_INTERNAL);

    const before = await reaches(scenario.viewer, where);
    answered(await narrowingTheBinding(scenario, bindingId, "Restricted"));
    const after = await reaches(scenario.viewer, where);
    await theBindingRowNowSays(scenario.workspaceId, bindingId, { sensitivity: "Internal" });
    const widened = await reaches(scenario.viewer, where);

    expect({ before, after, widened }).toEqual({
      before: REACHED,
      after: WITHHELD,
      widened: REACHED,
    });
  });

  it("takes every chunk of a narrowed document and leaves its sibling under the same binding alone, both ways", async () => {
    const scenario = await arrange();
    const theOne = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const theOther = await aSiblingUnder(scenario.workspaceId, theOne, {
      title: "The handbook annex",
      text: ANNEX,
    });
    await landed(scenario.workspaceId, theOne, PUBLISHED_AND_INTERNAL);
    await landedBeside(scenario.workspaceId, theOne, theOne.bindingId, SECOND_ROW);
    await landed(scenario.workspaceId, theOther, PUBLISHED_AND_INTERNAL);

    const before = await rowsFound(scenario.viewer, theOne.documentId);
    answered(await narrowingTheDocument(scenario, theOne.bindingId, theOne.documentId));
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

  it("hands an unpublished binding's passages to a Viewer the instant the publish commits, and takes them back when the row is unpublished again", async () => {
    const scenario = await arrange();
    const where = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The board's minutes",
      text: MINUTES,
      binding: { publishedAt: null },
    });
    const { bindingId } = where;
    await landed(scenario.workspaceId, where, { ...PUBLISHED_AND_INTERNAL, publishedAt: null });
    await aFinishedRun(scenario.workspaceId, bindingId);

    const before = await reaches(scenario.viewer, where);
    answered(await publishingTheBinding(scenario, bindingId));
    const after = await reaches(scenario.viewer, where);
    await theBindingRowNowSays(scenario.workspaceId, bindingId, { publishedAt: null });
    const unpublished = await reaches(scenario.viewer, where);

    expect({ before, after, unpublished }).toEqual({
      before: WITHHELD,
      after: REACHED,
      unpublished: WITHHELD,
    });
  });
});

type HeldNarrowing = { readonly commit: () => Promise<void> };

// The act's work does not return until `commit` is called, so its transaction stays open with
// the narrowing applied and uncommitted.
const aNarrowingHeldUncommitted = async (
  scenario: Scenario,
  bindingId: string,
): Promise<HeldNarrowing> => {
  const applied = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const asked = inputOf(narrowBindingInput, narrowedTo(bindingId, "Restricted"));
  const act = reading(scenario.admin, async (admin, tx) => {
    try {
      return await narrowBinding(admin, tx, asked);
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

describe("the race a narrowing in flight used to leave open", () => {
  it("reads rows landed against an uncommitted narrowing until it commits, and never after, with no other statement run", async () => {
    const scenario = await arrange();
    const where = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });

    const narrowing = await aNarrowingHeldUncommitted(scenario, where.bindingId);
    await landedCopyingItsBinding(scenario.workspaceId, where);
    const beforeTheCommit = await reaches(scenario.viewer, where);

    await narrowing.commit();

    const afterTheCommit = await reaches(scenario.viewer, where);

    expect({ beforeTheCommit, afterTheCommit }).toEqual({
      beforeTheCommit: REACHED,
      afterTheCommit: WITHHELD,
    });
  });

  it("withholds rows landed during the uncommitted narrowing on the same terms as rows landed long before it, the act having written neither", async () => {
    const scenario = await arrange();
    const theOld = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: HANDBOOK,
    });
    const theNew = await aSiblingUnder(scenario.workspaceId, theOld, {
      title: "The handbook annex",
      text: ANNEX,
    });
    await landed(scenario.workspaceId, theOld, PUBLISHED_AND_INTERNAL);

    const narrowing = await aNarrowingHeldUncommitted(scenario, theOld.bindingId);
    await landedCopyingItsBinding(scenario.workspaceId, theNew);
    await narrowing.commit();

    expect({
      landedLongBefore: await reaches(scenario.viewer, theOld),
      landedDuring: await reaches(scenario.viewer, theNew),
    }).toEqual({ landedLongBefore: WITHHELD, landedDuring: WITHHELD });

    // A read taken from the copies would hand the revoked class back for both rows.
    expect({
      landedLongBefore: await copiesUnder(scenario.workspaceId, theOld.documentId),
      landedDuring: await copiesUnder(scenario.workspaceId, theNew.documentId),
    }).toEqual({
      landedLongBefore: [{ sensitivity: "Internal" }],
      landedDuring: [{ sensitivity: "Internal" }],
    });
  });
});

describe("a passage whose rows do not all name one binding", () => {
  // The binding id has no foreign key, so one document's rows can name two bindings — which is
  // what keeps `passageAt`'s fold reachable.
  it("is opened at the narrower of the two bindings, and withheld whole from the reader either one refuses", async () => {
    const scenario = await arrange();
    const wide = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The staff handbook",
      text: LEADING,
    });
    const narrow = await aBinding(scenario.workspaceId, { sensitivity: "Restricted" });
    await landed(scenario.workspaceId, wide, PUBLISHED_AND_INTERNAL);
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

describe("a chunk whose binding row is absent", () => {
  // The chunk's binding id carries no foreign key, so only the read closes this shape.
  it("is read and listed by nobody, while a neighbour chunk under a live binding is read and listed", async () => {
    const scenario = await arrange();
    const absent = ulid();
    const neighbour = await aBindingHoldingOneDocument(scenario.workspaceId, {
      title: "The handbook annex",
      text: ANNEX,
    });
    const orphaned = {
      ...(await aSiblingUnder(scenario.workspaceId, neighbour, {
        title: "The staff handbook",
        text: HANDBOOK,
      })),
      bindingId: absent,
    };
    await landed(scenario.workspaceId, orphaned, PUBLISHED_AND_INTERNAL);
    await landed(scenario.workspaceId, neighbour, PUBLISHED_AND_INTERNAL);

    expect({
      orphanedPreview: await previewing(scenario.admin, absent),
      neighbourPreview: await previewing(scenario.admin, neighbour.bindingId),
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
