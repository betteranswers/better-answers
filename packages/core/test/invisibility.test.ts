import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { walkFrom, walkTo } from "@better-answers/core/store/graph";

import { conceptByIri } from "../src/concepts/index.ts";
import { footnotesOf } from "../src/guides/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { addToGroup, deleteGroup } from "../src/members/index.ts";
import type { Tx } from "../src/store/postgres/index.ts";
import {
  bindingForGroups,
  conceptCiting,
  conceptForGroup,
  groupNamed,
  restrictedAndInternal,
  seededBy,
  visibilityHeld,
  visibilitySuite,
} from "./sourced-concept.ts";
import type { Scenario } from "./workspace-with-bundle.ts";

/**
 * What the read predicate refuses (`[SEC2]`, `[SEC3]`): the audience arm's fail-closed
 * edges, pinned through a real read and never by comparing SQL — a Viewer in no group, a
 * group deleted since the row was written, the rows the CHECK will not hold, and the Admin
 * arm's reach — and then the two invisibility proofs at the slice seam (T-055): a
 * Restricted-sourced concept, written through the governed write citing a document under a
 * Restricted binding, is invisible to a Viewer through the graph walk and through a guide's
 * footnotes, indistinguishably from one that never existed. `find`, `ask` and `open` are
 * proved through the api harness (`apps/api/tests/invisibility.test.ts`).
 */

const { db, arrange, reading } = visibilitySuite();

/** Whether this person reaches the concept through the read `open` serves. */
const reaches = async (person: UserPrincipal, iri: string): Promise<boolean> => {
  const read = await reading(person, (reader, tx) => conceptByIri(reader, tx, iri));
  if (!read.ok) throw read.error;
  return read.value !== undefined;
};

const asAdmin = <T>(scenario: Scenario, work: (admin: UserPrincipal, tx: Tx) => Promise<T>) =>
  reading(scenario.admin, work);

describe("the audience arm of the read predicate", () => {
  it("withholds a named-group unit from a Viewer in no group, and hands it to one the group holds", async () => {
    const scenario = await arrange();
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", []);

    // An empty caller list overlaps nothing: `'{}' && …` is false, never NULL-as-true.
    expect(await reaches(scenario.viewer, written.iri)).toBe(false);

    await asAdmin(scenario, (admin, tx) =>
      addToGroup(admin, tx, { groupId: hr, userId: scenario.viewer.userId }),
    );
    // Re-read per call, never carried: the next read sees the membership.
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

    // A dangling id is an id no caller holds (ADR 0038): the content narrows, never widens,
    // and the Admin arm is the class's, not the audience's.
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

    // The database's own sentence (`AUDIENCE_CHECK`), so no writer can land the shape the
    // predicate has no answer for — and the `'{}'` case the ticket names is refused at the
    // row rather than answered by the `&&` arm.
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

    // The precedent (T-054): the Admin arm is legitimate on the class, because the Admin is
    // who decides what a Restricted unit becomes — and the audience still narrows them.
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

    const outward = await reading(scenario.viewer, (viewer, tx) => walkFrom(viewer, tx, entry.iri));
    const fromWithheld = await reading(scenario.viewer, (viewer, tx) =>
      walkFrom(viewer, tx, withheld.iri),
    );
    const inward = await reading(scenario.viewer, (viewer, tx) => walkTo(viewer, tx, withheld.iri));
    const absent = await reading(scenario.viewer, (viewer, tx) =>
      walkFrom(viewer, tx, conceptIriOf(ulid())),
    );

    // The entry alone: the edge into the withheld concept ends the path, with no count and
    // no hint that a hop was there; and the withheld concept itself answers as one nobody
    // mapped, from either direction.
    expect(outward.map((step) => [step.uid, step.depth])).toEqual([[entry.iri, 0]]);
    expect(fromWithheld).toEqual(absent);
    expect(inward).toEqual(absent);
    expect(absent).toEqual([]);
    // The Admin, who may see it, is the proof the concept and the hop are really there.
    const admin = await reading(scenario.admin, (reader, tx) => walkFrom(reader, tx, entry.iri));
    expect(admin.map((step) => step.uid).toSorted()).toEqual([entry.iri, withheld.iri].toSorted());
  });

  it("is invisible through a guide's footnotes, with no gap where it was, and takes the composition with it when the cascade has run", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const visible = await conceptCiting(scenario, scenario.editor, [internal.documentId]);
    // Two compositions, seeded as B8 will one day write them: one whose columns the cascade
    // has left behind its includes — the per-include predicate is what holds — and one the
    // cascade has already narrowed to its most restrictive include.
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

    // Only the footnote the Viewer may open, with nothing standing where the other was.
    expect(viewerBehind).toEqual({
      ok: true,
      value: [{ label: "i2", iri: visible.iri, title: visible.title }],
    });
    // The narrowed composition answers as one nobody made.
    expect(viewerNarrowed).toEqual({ ok: true, value: undefined });
    expect(absent).toEqual(viewerNarrowed);
    expect(adminBehind.ok && adminBehind.value?.map((footnote) => footnote.label)).toEqual([
      "i1",
      "i2",
    ]);
  });
});
