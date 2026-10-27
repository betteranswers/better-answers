import { describe, expect, it } from "vitest";

import { walkFrom, walkFromEntries, walkTo, walkToEntries } from "@better-answers/core/store/map";
import { conceptIriOf, ulid, type ConceptIri } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { readableClause, readableParameters } from "../src/access/index.ts";
import {
  ASK_CAPS,
  open,
  renderAnswer,
  renderOpen,
  type AnswerResult,
  type RelatedConcept,
} from "../src/answering/index.ts";
import { conceptByIri, conceptsByIris } from "../src/concepts/index.ts";
import { footnotesOf } from "../src/guides/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { addToGroup, deleteGroup } from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  answerWritten,
  asked,
  conceptSeeded,
  REFUSED,
  withoutRecord,
  type WrittenAnswer,
} from "./asking.ts";
import {
  connectedSourceForGroups,
  connectedSourceHolding,
  conceptCiting,
  conceptForGroup,
  documentUnder,
  groupNamed,
  overriddenBy,
  restrictedAndInternal,
  rewriteCiting,
  seededBy,
  visibilityHeld,
  visibilitySuite,
  writeUpIncluding,
  type SourcedConcept,
  type Sourced,
} from "./sourced-concept.ts";
import { documentLanded } from "./suite-documents.ts";
import { answered } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const reaches = async (person: UserPrincipal, iri: ConceptIri): Promise<boolean> => {
  const read = await reading(person, (reader, tx) => conceptByIri(reader, tx, iri));
  if (!read.ok) throw read.error;
  return read.value !== undefined;
};

const asAdmin = <T>(scenario: Scenario, work: (admin: UserPrincipal, tx: Tx) => Promise<T>) =>
  reading(scenario.admin, work);

const passagesReadableBy = async (
  person: UserPrincipal,
  sourceDocumentId: string,
): Promise<readonly string[]> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await tx.query<{ id: string }>(
        `SELECT c.id FROM "index".readable_passage c
        WHERE c.workspace_id = $1 AND c.source_document_id = $2 AND ${readableClause("c", 3)}
        ORDER BY c.id`,
        [reader.workspaceId, sourceDocumentId, ...readableParameters(reader)],
      );
      return read.rows.map((row) => row.id);
    }),
  );

const passageOf = async (workspaceId: string, document: Sourced): Promise<string> => {
  const row = await seededBy(db(), (seed) =>
    seed.passage({
      workspaceId,
      connectedSourceId: document.connectedSourceId,
      sourceDocumentId: document.documentId,
      content: "The handbook's holiday policy.",
      locator: `${document.documentId}/chars:0-30`,
      ordinal: 0,
      charStart: 0,
      charEnd: 30,
    }),
  );
  return row.id;
};

describe("the audience arm of the read predicate", () => {
  it("withholds a group's unit until the Viewer joins the group", async () => {
    const scenario = await arrange();
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", []);

    expect(await reaches(scenario.viewer, written.iri)).toBe(false);

    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: hr, userId: scenario.viewer.userId }),
    );

    expect(await reaches(scenario.viewer, written.iri)).toBe(true);
  });

  it("withholds a deleted group's unit from everyone, the row unchanged", async () => {
    const scenario = await arrange();
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", [
      scenario.viewer,
      scenario.admin,
    ]);
    expect(await reaches(scenario.viewer, written.iri)).toBe(true);

    await asAdmin(scenario, (admin, tx) => deleteGroup(admin, tx, { groupId: hr }));

    expect(await reaches(scenario.viewer, written.iri)).toBe(false);
    expect(await reaches(scenario.admin, written.iri)).toBe(false);
    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, written.iri),
    ).toEqual({
      sensitivity: "Internal",
      audience: "groups",
      audience_groups: [hr],
    });
  });

  it("cannot hold groups without a list, or everyone with one", async () => {
    const scenario = await arrange();
    const written = await conceptCiting(scenario, scenario.editor, []);
    const rewrite = (audience: string, groups: string) =>
      db().pool.query(
        `UPDATE concept_index SET audience = $3, audience_groups = ${groups} WHERE workspace_id = $1 AND iri = $2`,
        [scenario.workspaceId, written.iri, audience],
      );

    await expect(rewrite("groups", "'{}'")).rejects.toThrow(/concept_index_audience_check/);
    await expect(rewrite("groups", "NULL")).rejects.toThrow(/concept_index_audience_check/);
    await expect(rewrite("groups", `ARRAY['${ulid()}', NULL]`)).rejects.toThrow(
      /concept_index_audience_check/,
    );
    await expect(rewrite("everyone", `ARRAY['${ulid()}']`)).rejects.toThrow(
      /concept_index_audience_check/,
    );
  });

  it("shows a Restricted unit to Admins alone, narrowed by audience", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.viewer]);
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const boardOnly = await connectedSourceForGroups(
      db(),
      scenario.workspaceId,
      [board],
      "Restricted",
    );
    const forAdmins = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const forBoardAdmins = await conceptCiting(scenario, scenario.editor, [boardOnly.documentId]);

    expect([
      await reaches(scenario.admin, forAdmins.iri),
      await reaches(scenario.editor, forAdmins.iri),
      await reaches(scenario.viewer, forAdmins.iri),
      await reaches(scenario.admin, forBoardAdmins.iri),
      await reaches(scenario.viewer, forBoardAdmins.iri),
    ]).toEqual([true, false, false, false, false]);

    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: board, userId: scenario.admin.userId }),
    );
    expect(await reaches(scenario.admin, forBoardAdmins.iri)).toBe(true);
  });

  it("reads a group's passage to a member, not an outsider", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", [scenario.viewer]);
    const toHr = await connectedSourceForGroups(db(), scenario.workspaceId, [hr]);
    const passage = await passageOf(scenario.workspaceId, toHr);

    expect({
      member: await passagesReadableBy(scenario.viewer, toHr.documentId),
      outsider: await passagesReadableBy(scenario.editor, toHr.documentId),
    }).toEqual({ member: [passage], outsider: [] });
  });
});

describe("the publish arm of the read predicate", () => {
  it("reads an unpublished source's passage to nobody, Admins included", async () => {
    const scenario = await arrange();
    const published = await connectedSourceHolding(db(), scenario.workspaceId);
    const unpublished = await connectedSourceHolding(db(), scenario.workspaceId, {
      publishedAt: null,
    });
    const shown = await passageOf(scenario.workspaceId, published);
    await passageOf(scenario.workspaceId, unpublished);

    expect({
      published: await passagesReadableBy(scenario.admin, published.documentId),
      admin: await passagesReadableBy(scenario.admin, unpublished.documentId),
      viewer: await passagesReadableBy(scenario.viewer, unpublished.documentId),
    }).toEqual({ published: [shown], admin: [], viewer: [] });
  });
});

describe("a source the reader may not read", () => {
  const opened = async (person: UserPrincipal, iri: ConceptIri) =>
    answered(
      await reading(person, (reader, tx) =>
        open(reader, tx, { iri }, new Date("2026-09-08T12:00:00.000Z")),
      ),
    );

  it("reaches a Viewer as the file's own words alone", async () => {
    const scenario = await arrange();
    const minutes = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes 2026",
      text: "Pay rises are set by the board in March.",
      sensitivity: "Restricted",
    });
    const written = await conceptCiting(scenario, scenario.editor, [], {
      sensitivity: "Internal",
      body: "Pay rises are set by the board.[^BM-1]",
      frontmatter: {
        type: "Note",
        sources: [
          {
            id: "BM-1",
            title: "The board's minutes",
            resource: "minutes",
            locator: minutes.locator,
          },
        ],
      },
    });
    await overriddenBy(db(), scenario, written.iri, "Internal");

    const viewer = await opened(scenario.viewer, written.iri);
    const admin = await opened(scenario.admin, written.iri);
    const seen = `${JSON.stringify(viewer)}\n${renderOpen(viewer)}`;

    expect(viewer.found && viewer.concept?.evidence).toEqual([
      { id: "BM-1", source: "The board's minutes" },
    ]);
    expect(seen).not.toContain(minutes.locator);
    expect(seen).not.toContain(minutes.documentId);
    expect(seen).not.toContain("Board minutes 2026");
    expect(JSON.stringify(admin)).toContain(minutes.locator);
  });
});

const entryLinkingToWithheld = async () => {
  const scenario = await arrange();
  const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
  const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
  const entry = await conceptCiting(scenario, scenario.editor, [internal.documentId], {
    body: `The board's note is [here](/${withheld.path}).`,
  });
  return { scenario, withheld, entry };
};

const withheldBesideVisible = async () => {
  const scenario = await arrange();
  const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
  const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
  const visible = await conceptCiting(scenario, scenario.editor, [internal.documentId]);
  return { scenario, withheld, visible };
};

describe("a Restricted-sourced concept, to a Viewer", () => {
  it("is invisible to either map walk, as if never mapped", async () => {
    const { scenario, withheld, entry } = await entryLinkingToWithheld();

    const outward = answered(
      await reading(scenario.viewer, (viewer, tx) => walkFrom(viewer, tx, entry.iri)),
    );
    const fromWithheld = answered(
      await reading(scenario.viewer, (viewer, tx) => walkFrom(viewer, tx, withheld.iri)),
    );
    const inward = answered(
      await reading(scenario.viewer, (viewer, tx) => walkTo(viewer, tx, withheld.iri)),
    );
    const absent = answered(
      await reading(scenario.viewer, (viewer, tx) => walkFrom(viewer, tx, conceptIriOf(ulid()))),
    );

    expect(outward.map((step) => [step.uid, step.depth])).toEqual([[entry.iri, 0]]);
    expect(fromWithheld).toEqual(absent);
    expect(inward).toEqual(absent);
    expect(absent).toEqual([]);

    const admin = answered(
      await reading(scenario.admin, (reader, tx) => walkFrom(reader, tx, entry.iri)),
    );
    expect(admin.map((step) => step.uid).toSorted()).toEqual([entry.iri, withheld.iri].toSorted());
  });

  it("adds nothing to a walk it is one entry of", async () => {
    const { scenario, withheld, entry } = await entryLinkingToWithheld();
    const entries = [withheld.iri, entry.iri];

    const outward = answered(
      await reading(scenario.viewer, (viewer, tx) => walkFromEntries(viewer, tx, entries)),
    );
    const inward = answered(
      await reading(scenario.viewer, (viewer, tx) => walkToEntries(viewer, tx, entries)),
    );

    expect(outward.map((step) => [step.uid, step.depth])).toEqual([[entry.iri, 0]]);
    expect(inward.map((step) => [step.uid, step.depth])).toEqual([[entry.iri, 0]]);

    const admin = answered(
      await reading(scenario.admin, (reader, tx) => walkFromEntries(reader, tx, entries)),
    );
    expect(admin.map((step) => [step.uid, step.depth]).toSorted()).toEqual(
      [
        [entry.iri, 0],
        [withheld.iri, 0],
      ].toSorted(),
    );
  });

  it("leaves no gap in footnotes and hides its narrowed write-up", async () => {
    const { scenario, withheld, visible } = await withheldBesideVisible();

    const { behind, narrowed } = await seededBy(db(), async (seed) => {
      const first = await seed.writeUp({ workspaceId: scenario.workspaceId });
      await seed.writeUpInclude({
        workspaceId: scenario.workspaceId,
        writeUpId: first.id,
        iri: withheld.iri,
        ordinal: 0,
        id: "i1",
      });
      await seed.writeUpInclude({
        workspaceId: scenario.workspaceId,
        writeUpId: first.id,
        iri: visible.iri,
        ordinal: 1,
        id: "i2",
      });
      const second = await seed.writeUp({
        workspaceId: scenario.workspaceId,
        sensitivity: "Restricted",
      });
      await seed.writeUpInclude({
        workspaceId: scenario.workspaceId,
        writeUpId: second.id,
        iri: withheld.iri,
        ordinal: 0,
        id: "i1",
      });
      return { behind: first.id, narrowed: second.id };
    });

    const viewerBehind = await reading(scenario.viewer, (viewer, tx) =>
      footnotesOf(viewer, tx, behind),
    );
    const viewerNarrowed = await reading(scenario.viewer, (viewer, tx) =>
      footnotesOf(viewer, tx, narrowed),
    );
    const absent = await reading(scenario.viewer, (viewer, tx) => footnotesOf(viewer, tx, ulid()));
    const adminBehind = await reading(scenario.admin, (admin, tx) =>
      footnotesOf(admin, tx, behind),
    );

    expect(viewerBehind).toEqual({
      ok: true,
      value: [{ label: "i2", iri: visible.iri, title: visible.title }],
    });

    expect(viewerNarrowed).toEqual({ ok: true, value: undefined });
    expect(absent).toEqual(viewerNarrowed);
    expect(adminBehind.ok && adminBehind.value?.map((footnote) => footnote.label)).toEqual([
      "i1",
      "i2",
    ]);
  });
});

describe("a re-write that moves only who may read a concept", () => {
  const heldBy = async (scenario: Scenario, iri: string, writeUp: string) => ({
    concept: await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, iri),
    writeUp: await visibilityHeld(db().pool, "write_up", scenario.workspaceId, writeUp),
  });

  const footnotesFor = (person: UserPrincipal, writeUp: string) =>
    reading(person, (reader, tx) => footnotesOf(reader, tx, writeUp));

  const footnoteTo = (written: SourcedConcept) => ({
    ok: true,
    value: [{ label: matching.any(String), iri: written.iri, title: written.title }],
  });

  it("takes the write-up along on an audience-only re-write", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", []);
    const toEveryone = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Internal",
    });
    const toHr = await connectedSourceForGroups(db(), scenario.workspaceId, [hr], "Internal");
    const written = await conceptCiting(scenario, scenario.editor, [toEveryone.documentId]);
    const writeUp = await writeUpIncluding(db(), scenario.workspaceId, [written.iri]);
    const atEveryone = { sensitivity: "Internal", audience: "everyone", audience_groups: null };
    expect(await heldBy(scenario, written.iri, writeUp)).toEqual({
      concept: atEveryone,
      writeUp: atEveryone,
    });
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual(footnoteTo(written));

    const rewritten = await rewriteCiting(scenario, scenario.editor, written, [toHr.documentId]);

    const atHr = { sensitivity: "Internal", audience: "groups", audience_groups: [hr] };
    expect(await heldBy(scenario, written.iri, writeUp)).toEqual({
      concept: atHr,
      writeUp: atHr,
    });
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual({ ok: true, value: undefined });
    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: hr, userId: scenario.viewer.userId }),
    );
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual(footnoteTo(written));
    expect(rewritten.ok).toBe(true);
  });

  it("takes the write-up along on a groups-only re-write", async () => {
    const scenario = await arrange();
    const bids = await groupNamed(db(), scenario, "Bids", [scenario.editor]);
    const legal = await groupNamed(db(), scenario, "Legal", [scenario.viewer]);
    const bidsAndLegal = [bids, legal].toSorted();
    const toBoth = await connectedSourceForGroups(
      db(),
      scenario.workspaceId,
      bidsAndLegal,
      "Internal",
    );
    const toBids = await connectedSourceForGroups(db(), scenario.workspaceId, [bids], "Internal");
    const written = await conceptCiting(scenario, scenario.editor, [toBoth.documentId]);
    const writeUp = await writeUpIncluding(db(), scenario.workspaceId, [written.iri], {
      audienceGroups: bidsAndLegal,
    });
    const atBoth = { sensitivity: "Internal", audience: "groups", audience_groups: bidsAndLegal };
    expect(await heldBy(scenario, written.iri, writeUp)).toEqual({
      concept: atBoth,
      writeUp: atBoth,
    });
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual(footnoteTo(written));

    const rewritten = await rewriteCiting(scenario, scenario.editor, written, [toBids.documentId]);

    const atBids = { sensitivity: "Internal", audience: "groups", audience_groups: [bids] };
    expect(await heldBy(scenario, written.iri, writeUp)).toEqual({
      concept: atBids,
      writeUp: atBids,
    });
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual({ ok: true, value: undefined });
    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: bids, userId: scenario.viewer.userId }),
    );
    expect(await footnotesFor(scenario.viewer, writeUp)).toEqual(footnoteTo(written));
    expect(rewritten.ok).toBe(true);
  });
});

describe("a document narrowed under a source its siblings stand under", () => {
  it("leaves a concept at its sources' class without document classes", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const onInternal = await conceptCiting(scenario, scenario.editor, [internal.documentId]);
    const onRestricted = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const onBoth = await conceptCiting(scenario, scenario.editor, [
      internal.documentId,
      restricted.documentId,
    ]);
    const held = (iri: string) =>
      visibilityHeld(db().pool, "concept_index", scenario.workspaceId, iri);

    expect([
      await held(onInternal.iri),
      await held(onRestricted.iri),
      await held(onBoth.iri),
    ]).toEqual([
      { sensitivity: "Internal", audience: "everyone", audience_groups: null },
      { sensitivity: "Restricted", audience: "everyone", audience_groups: null },
      { sensitivity: "Restricted", audience: "everyone", audience_groups: null },
    ]);
    expect([
      await reaches(scenario.viewer, onInternal.iri),
      await reaches(scenario.viewer, onRestricted.iri),
      await reaches(scenario.viewer, onBoth.iri),
      await reaches(scenario.admin, onInternal.iri),
      await reaches(scenario.admin, onRestricted.iri),
      await reaches(scenario.admin, onBoth.iri),
    ]).toEqual([true, false, false, true, true, true]);
  });

  it("withholds its passages from a Viewer exactly as absent ones", async () => {
    const scenario = await arrange();
    const { internal, narrowedUnderInternal } = await restrictedAndInternal(
      db(),
      scenario.workspaceId,
    );
    const narrowedPassage = await passageOf(scenario.workspaceId, narrowedUnderInternal);
    const siblingPassage = await passageOf(scenario.workspaceId, internal);

    const absent = await passagesReadableBy(scenario.viewer, ulid());
    expect(await passagesReadableBy(scenario.viewer, narrowedUnderInternal.documentId)).toEqual(
      absent,
    );
    expect(absent).toEqual([]);
    expect(await passagesReadableBy(scenario.viewer, internal.documentId)).toEqual([
      siblingPassage,
    ]);

    expect(await passagesReadableBy(scenario.admin, narrowedUnderInternal.documentId)).toEqual([
      narrowedPassage,
    ]);
    expect(await passagesReadableBy(scenario.admin, internal.documentId)).toEqual([siblingPassage]);
  });

  it("derives Restricted for its citing concept, Internal for its sibling's", async () => {
    const scenario = await arrange();
    const { internal, narrowedUnderInternal } = await restrictedAndInternal(
      db(),
      scenario.workspaceId,
    );
    const onNarrowed = await conceptCiting(scenario, scenario.editor, [
      narrowedUnderInternal.documentId,
    ]);
    const onSibling = await conceptCiting(scenario, scenario.editor, [internal.documentId]);

    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, onNarrowed.iri),
    ).toEqual({
      sensitivity: "Restricted",
      audience: "everyone",
      audience_groups: null,
    });
    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, onSibling.iri),
    ).toEqual({
      sensitivity: "Internal",
      audience: "everyone",
      audience_groups: null,
    });
    expect([
      await reaches(scenario.viewer, onNarrowed.iri),
      await reaches(scenario.viewer, onSibling.iri),
      await reaches(scenario.admin, onNarrowed.iri),
      await reaches(scenario.admin, onSibling.iri),
    ]).toEqual([false, true, true, true]);
  });

  it("cannot exceed its source's class: Internal under Restricted stays Restricted", async () => {
    const scenario = await arrange();
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const wider = await documentUnder(
      db(),
      scenario.workspaceId,
      restricted.connectedSourceId,
      "Internal",
    );
    const onWider = await conceptCiting(scenario, scenario.editor, [wider.documentId]);

    expect(
      await visibilityHeld(db().pool, "concept_index", scenario.workspaceId, onWider.iri),
    ).toEqual({
      sensitivity: "Restricted",
      audience: "everyone",
      audience_groups: null,
    });
    expect([
      await reaches(scenario.viewer, onWider.iri),
      await reaches(scenario.admin, onWider.iri),
    ]).toEqual([false, true]);
  });
});

const irisReadBy = async (
  person: UserPrincipal,
  iris: readonly ConceptIri[],
): Promise<readonly ConceptIri[]> => {
  const read = await reading(person, (reader, tx) => conceptsByIris(reader, tx, iris));
  if (!read.ok) throw read.error;
  return read.value.map((concept) => concept.iri);
};

describe("concepts read together by iri", () => {
  it("answers the readable ones by iri, withheld ones left out", async () => {
    const { scenario, withheld, visible } = await withheldBesideVisible();
    const iris = [withheld.iri, conceptIriOf(ulid()), visible.iri];

    expect(await irisReadBy(scenario.viewer, iris)).toEqual([visible.iri]);
    expect(await irisReadBy(scenario.admin, iris)).toEqual([visible.iri, withheld.iri].toSorted());
  });

  it("answers none for no iri, and a repeated iri once", async () => {
    const { scenario, visible } = await withheldBesideVisible();

    expect(await irisReadBy(scenario.viewer, [])).toEqual([]);
    expect(await irisReadBy(scenario.viewer, [visible.iri, visible.iri])).toEqual([visible.iri]);
  });
});

const QUESTION = { question: "How long are audit logs kept?" };

const RETENTION: WrittenAnswer = {
  collection: "audits",
  slug: "log-retention",
  title: "How long are audit logs kept?",
  body: "Audit logs are kept for thirteen months. The board's period is [separate](/knowledge/audits/board-log-retention.md).",
};

const BOARD_RETENTION: WrittenAnswer = {
  collection: "audits",
  slug: "board-log-retention",
  title: "How long are audit logs kept for the board?",
  body: "The board's audit logs are kept for seven years.",
  sensitivity: "Restricted",
};

const aroundAWithheldAnswer = async (scenario: Scenario) => {
  const before = await asked(db(), scenario.viewer, QUESTION);
  const withheld = await answerWritten(scenario, BOARD_RETENTION);
  const after = await asked(db(), scenario.viewer, QUESTION);
  const admins = await asked(db(), scenario.admin, QUESTION);
  return { before, withheld, after, admins };
};

const irisOf = (answer: AnswerResult): readonly ConceptIri[] =>
  answer.related.map((concept) => concept.iri);

describe("an `Answer` withheld from the asker", () => {
  it("AE7: refuses alike with no match and only withheld matches", async () => {
    const scenario = await arrange();

    const { before, withheld, after, admins } = await aroundAWithheldAnswer(scenario);

    expect(withoutRecord(before)).toEqual(REFUSED);
    expect(withoutRecord(after)).toEqual(REFUSED);
    expect(renderAnswer({ ...after, recordId: before.recordId })).toBe(renderAnswer(before));
    expect(after.recordId).not.toBe(before.recordId);
    expect(irisOf(admins)).toEqual([withheld.iri]);
  });

  it("AE4: answers as if a withheld `Answer` were never written", async () => {
    const scenario = await arrange();
    const visible = await answerWritten(scenario, RETENTION);

    const { before, withheld, after, admins } = await aroundAWithheldAnswer(scenario);

    expect(irisOf(before)).toEqual([visible.iri]);
    expect(withoutRecord(after)).toEqual(withoutRecord(before));
    expect(renderAnswer({ ...after, recordId: before.recordId })).toBe(renderAnswer(before));
    expect(irisOf(admins).toSorted()).toEqual([visible.iri, withheld.iri].toSorted());
  });

  it("AE4: answers a collection of withheld concepts as one unmade", async () => {
    const scenario = await arrange();
    await answerWritten(scenario, RETENTION);
    const withheld = await answerWritten(scenario, { ...BOARD_RETENTION, collection: "board" });
    const naming = (asker: UserPrincipal, collection: string) =>
      asked(db(), asker, { ...QUESTION, collections: [collection] });

    const unreadable = await naming(scenario.viewer, "board");
    const unmade = await naming(scenario.viewer, "bored");
    const admins = await naming(scenario.admin, "board");

    expect(withoutRecord(unreadable)).toEqual({
      ...REFUSED,
      collections: ["board"],
      readableCollections: ["audits"],
    });
    expect(withoutRecord(unmade)).toEqual({ ...withoutRecord(unreadable), collections: ["bored"] });
    expect(irisOf(admins)).toEqual([withheld.iri]);
    expect(admins.readableCollections).toEqual(["audits", "board"]);
  });

  it("spends no entry slot on a withheld `Answer`", async () => {
    const scenario = await arrange();
    const withheld = await answerWritten(scenario, BOARD_RETENTION);
    const three = await answerWritten(scenario, {
      collection: "audits",
      slug: "log-storage",
      title: "Where do audit logs stay?",
      body: "Audit logs stay in the console for a long time.",
    });
    const two = await answerWritten(scenario, {
      collection: "audits",
      slug: "long-audits",
      title: "Do long audits happen?",
      body: "A full audit takes a week.",
    });
    const one = await answerWritten(scenario, {
      collection: "audits",
      slug: "log-exports",
      title: "Can a log be exported?",
      body: "A log can be exported as a spreadsheet.",
    });
    const entriesFor = async (asker: UserPrincipal, entryPoints: number) =>
      irisOf(await asked(db(), asker, QUESTION, { caps: { ...ASK_CAPS, entryPoints } }));

    expect(await entriesFor(scenario.viewer, 2)).toEqual([three.iri, two.iri]);
    expect(await entriesFor(scenario.admin, 2)).toEqual([withheld.iri, three.iri]);
    expect(await entriesFor(scenario.viewer, 1)).toEqual([three.iri]);
    expect(await entriesFor(scenario.viewer, 3)).toEqual([three.iri, two.iri, one.iri]);
  });

  it("spends no walked slot on a withheld concept", async () => {
    const scenario = await arrange();
    const minted = [conceptIriOf(ulid()), conceptIriOf(ulid())] as const;
    const [first, second] = minted[0] < minted[1] ? minted : ([minted[1], minted[0]] as const);
    const reached = await conceptSeeded(db(), scenario.workspaceId, {
      collection: "audits",
      title: "Console exports",
      body: "Exports are made in the console.",
      iri: second,
    });
    const entry = await conceptSeeded(db(), scenario.workspaceId, {
      collection: "audits",
      kind: "Answer",
      title: QUESTION.question,
      body: "Audit logs are kept for thirteen months.",
      linksTo: [first, second],
    });
    const ofTwo = { caps: { ...ASK_CAPS, related: 2 } };

    const before = await asked(db(), scenario.viewer, QUESTION, ofTwo);
    const withheld = await conceptSeeded(db(), scenario.workspaceId, {
      collection: "audits",
      title: "Board papers",
      body: "Papers go to the board each quarter.",
      sensitivity: "Restricted",
      iri: first,
    });
    const after = await asked(db(), scenario.viewer, QUESTION, ofTwo);
    const admins = await asked(db(), scenario.admin, QUESTION, ofTwo);

    expect(irisOf(before)).toEqual([entry, reached]);
    expect(withoutRecord(after)).toEqual(withoutRecord(before));
    expect(irisOf(admins)).toEqual([entry, withheld]);
  });

  it("keeps a withheld document's passage from the asker", async () => {
    const scenario = await arrange();
    const minutes = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes 2026",
      text: "Audit logs are kept for seven years.",
      sensitivity: "Restricted",
    });

    const viewers = await asked(db(), scenario.viewer, QUESTION);
    const admins = await asked(db(), scenario.admin, QUESTION);

    expect(withoutRecord(viewers)).toEqual(REFUSED);
    expect(renderAnswer(viewers)).not.toContain("seven years");
    expect(admins.unmappedPassages).toEqual([
      {
        locator: minutes.locator,
        source: "Board minutes 2026",
        text: "Audit logs are kept for seven years.",
        sensitivity: "Restricted",
      },
    ]);
    expect(renderAnswer(admins)).toContain("> Audit logs are kept for seven years.");
  });

  const evidenceOf = (concept: RelatedConcept) => ("evidence" in concept ? concept.evidence : []);

  it("names a source the asker cannot open by its label", async () => {
    const scenario = await arrange();
    const minutes = await documentLanded(db().pool, scenario.workspaceId, {
      title: "Board minutes 2026",
      text: "The board set the retention period in March.",
      sensitivity: "Restricted",
    });
    const retention = await conceptCiting(scenario, scenario.editor, [], {
      title: RETENTION.title,
      kind: "Answer",
      sensitivity: "Internal",
      body: "Audit logs are kept for thirteen months.[^BM-1]",
      frontmatter: {
        title: RETENTION.title,
        type: "Answer",
        sources: [
          {
            id: "BM-1",
            title: "The board's minutes",
            resource: "minutes",
            locator: minutes.locator,
          },
        ],
      },
    });
    await overriddenBy(db(), scenario, retention.iri, "Internal");

    const viewers = await asked(db(), scenario.viewer, QUESTION);
    const admins = await asked(db(), scenario.admin, QUESTION);
    const seen = `${JSON.stringify(viewers)}\n${renderAnswer(viewers)}`;

    expect(viewers.related.map(evidenceOf)).toEqual([
      [{ id: "BM-1", source: "The board's minutes" }],
    ]);
    expect(seen).not.toContain(minutes.locator);
    expect(seen).not.toContain(minutes.documentId);
    expect(seen).not.toContain("Board minutes 2026");
    expect(admins.related.map(evidenceOf)).toEqual([
      [{ id: "BM-1", source: "The board's minutes", locator: minutes.locator }],
    ]);
  });
});
