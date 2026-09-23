import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { walkFrom, walkTo } from "@better-answers/core/store/graph";

import { readableClause, readableParameters } from "../src/access/index.ts";
import { conceptByIri } from "../src/concepts/index.ts";
import { footnotesOf } from "../src/guides/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { addToGroup, deleteGroup } from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  bindingForGroups,
  conceptCiting,
  conceptForGroup,
  documentUnder,
  groupNamed,
  restrictedAndInternal,
  seededBy,
  visibilityHeld,
  visibilitySuite,
  type Sourced,
} from "./sourced-concept.ts";
import { answered } from "./suite-postgres.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

const reaches = async (person: UserPrincipal, iri: string): Promise<boolean> => {
  const read = await reading(person, (reader, tx) => conceptByIri(reader, tx, iri));
  if (!read.ok) throw read.error;
  return read.value !== undefined;
};

const asAdmin = <T>(scenario: Scenario, work: (admin: UserPrincipal, tx: Tx) => Promise<T>) =>
  reading(scenario.admin, work);

const chunksReadableBy = async (
  person: UserPrincipal,
  sourceDocumentId: string,
): Promise<readonly string[]> =>
  answered(
    await reading(person, async (reader, tx) => {
      const read = await tx.query<{ id: string }>(
        `SELECT c.id FROM "index".readable_chunk c
        WHERE c.workspace_id = $1 AND c.source_document_id = $2 AND ${readableClause("c", 3)}
        ORDER BY c.id`,
        [reader.workspaceId, sourceDocumentId, ...readableParameters(reader)],
      );
      return read.rows.map((row) => row.id);
    }),
  );

const chunkOf = async (workspaceId: string, document: Sourced): Promise<string> => {
  const row = await seededBy(db(), (seed) =>
    seed.chunk({
      workspaceId,
      bindingId: document.bindingId,
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
  it("withholds a named-group unit from a Viewer in no group, and hands it to one the group holds", async () => {
    const scenario = await arrange();
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", []);

    expect(await reaches(scenario.viewer, written.iri)).toBe(false);

    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: hr, userId: scenario.viewer.userId }),
    );

    expect(await reaches(scenario.viewer, written.iri)).toBe(true);
  });

  it("withholds a unit whose named group was deleted, from everyone, while the row still names it", async () => {
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

  it("cannot hold a unit that says groups over an empty or missing list, or everyone over a list", async () => {
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

  it("reaches Admins alone on a Restricted unit, and narrows Admins by audience on one too", async () => {
    const scenario = await arrange();
    const board = await groupNamed(db(), scenario, "Board", [scenario.viewer]);
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const boardOnly = await bindingForGroups(db(), scenario.workspaceId, [board], "Restricted");
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
});

describe("a Restricted-sourced concept, to a Viewer", () => {
  it("is invisible through the graph walk from either end, exactly as one nobody mapped", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const entry = await conceptCiting(scenario, scenario.editor, [internal.documentId], {
      body: `The board's note is [here](/${withheld.path}).`,
    });

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

  it("is invisible through a guide's footnotes, with no gap where it was, and takes the composition with it when the cascade has run", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const visible = await conceptCiting(scenario, scenario.editor, [internal.documentId]);

    const { behind, narrowed } = await seededBy(db(), async (seed) => {
      const first = await seed.composition({ workspaceId: scenario.workspaceId });
      await seed.compositionInclude({
        workspaceId: scenario.workspaceId,
        compositionId: first.id,
        iri: withheld.iri,
        ordinal: 0,
        id: "i1",
      });
      await seed.compositionInclude({
        workspaceId: scenario.workspaceId,
        compositionId: first.id,
        iri: visible.iri,
        ordinal: 1,
        id: "i2",
      });
      const second = await seed.composition({
        workspaceId: scenario.workspaceId,
        sensitivity: "Restricted",
      });
      await seed.compositionInclude({
        workspaceId: scenario.workspaceId,
        compositionId: second.id,
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

describe("a document narrowed under a binding its siblings stand under", () => {
  it("leaves a concept whose documents carry no class of their own exactly where its bindings put it", async () => {
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

  it("withholds its chunk rows from a Viewer exactly as a document nobody holds, while its sibling's stand", async () => {
    const scenario = await arrange();
    const { internal, narrowedUnderInternal } = await restrictedAndInternal(
      db(),
      scenario.workspaceId,
    );
    const narrowedChunk = await chunkOf(scenario.workspaceId, narrowedUnderInternal);
    const siblingChunk = await chunkOf(scenario.workspaceId, internal);

    const absent = await chunksReadableBy(scenario.viewer, ulid());
    expect(await chunksReadableBy(scenario.viewer, narrowedUnderInternal.documentId)).toEqual(
      absent,
    );
    expect(absent).toEqual([]);
    expect(await chunksReadableBy(scenario.viewer, internal.documentId)).toEqual([siblingChunk]);

    expect(await chunksReadableBy(scenario.admin, narrowedUnderInternal.documentId)).toEqual([
      narrowedChunk,
    ]);
    expect(await chunksReadableBy(scenario.admin, internal.documentId)).toEqual([siblingChunk]);
  });

  it("derives Restricted for the concept citing it and Internal for the one citing its sibling", async () => {
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

  it("cannot widen what its binding decided: an Internal document of a Restricted binding stays Restricted", async () => {
    const scenario = await arrange();
    const { restricted } = await restrictedAndInternal(db(), scenario.workspaceId);
    const wider = await documentUnder(db(), scenario.workspaceId, restricted.bindingId, "Internal");
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
