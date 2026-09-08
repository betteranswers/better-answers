import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { head } from "@better-answers/core/store/git";

import { ask, find, open } from "../src/answering/index.ts";
import {
  evidencePaneOf,
  overrideConceptClass,
  writeConcept,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { footnotesOf } from "../src/guides/index.ts";
import { attempt, type UserPrincipal } from "../src/kernel/index.ts";
import { narrowBinding, type NarrowBindingInput } from "../src/sources/index.ts";
import { bundleHistory } from "./bundle.ts";
import { countWaitingOnLocks, until, whileActsWaitAt } from "./suite-postgres.ts";
import { doorsOf, type Scenario } from "./workspace-with-bundle.ts";
import {
  bindingForGroups,
  bindingHolding,
  conceptCiting,
  conceptForGroup,
  conceptOnBoth,
  edgeVisibilityHeld,
  groupNamed,
  ledgerRowsOf,
  restrictedAndInternal,
  seededBy,
  visibilityHeld,
  visibilitySuite,
  type SourcedConcept,
} from "./sourced-concept.ts";

/**
 * Who may see a concept, derived inside the act that changes it (T-055; ADR 0023, ADR
 * 0039), through the slices' entry points (`[TEST1]`) against real Postgres and a real
 * bare repository: the derivation at write time, the narrowing act's two-level cascade in
 * one transaction, the Admin's override and the state it creates, the evidence pane's
 * routing, and `find`'s first real read — each asserted on the rows the act left and on
 * what a reader then sees, never on internals.
 */

const { db, arrange, reading } = visibilitySuite();

const RESTRICTED = { sensitivity: "Restricted" } as const;

/** The concept's row alone, as the superuser reads it. */
const heldRow = (workspaceId: string, iri: string) =>
  visibilityHeld(db().pool, "concept_index", workspaceId, iri);

/** The Admin's override of one concept to a class for everyone, through the act. */
const overriddenTo = (scenario: Scenario, iri: string, sensitivity: string) =>
  reading(scenario.admin, (admin, tx) =>
    overrideConceptClass(admin, tx, { iri, sensitivity, audience: "everyone" }),
  );
const EVERYONE = { audience: "everyone", audience_groups: null } as const;

/** The concept's row and its node, which the derivation must keep in step. */
const rowAndNode = async (workspaceId: string, iri: string) => ({
  row: await visibilityHeld(db().pool, "concept_index", workspaceId, iri),
  node: await visibilityHeld(db().pool, "graph_node", workspaceId, iri),
});

/** The row and the node both at one pair — the derivation's answer, on the map too. */
const bothAt = (pair: object) => ({ row: pair, node: pair });

/**
 * Whether some other connection to this suite's database is waiting on a row lock — how a
 * test about two connections sees that the second has reached the row the first holds,
 * rather than guessing from a pause. Polled through `until`, whose cap is the one runaway
 * guard every two-connection test here shares.
 */
const someoneWaitsOnALock = async (): Promise<boolean> => {
  const found = await db().pool.query(
    "SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return (found.rowCount ?? 0) > 0;
};

/** A composition seeded as including these concepts, Internal and open to everyone. */
const compositionIncluding = (workspaceId: string, iris: readonly string[]): Promise<string> =>
  seededBy(db(), async (seed) => {
    const composition = await seed.composition({ workspaceId });
    for (const [ordinal, iri] of iris.entries()) {
      await seed.compositionInclude({ workspaceId, compositionId: composition.id, iri, ordinal });
    }
    return composition.id;
  });

describe("what a governed write derives from the bindings of what it cites", () => {
  it("lands the most restrictive class among them, on the row and on the map alike", async () => {
    const scenario = await arrange();
    const { written } = await conceptOnBoth(db(), scenario);

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("intersects their audiences, with everyone as the identity", async () => {
    const scenario = await arrange();
    const [hr, sales, board] = await Promise.all(
      ["HR", "Sales", "Board"].map((name) => groupNamed(db(), scenario, name, [])),
    );
    const forHrAndSales = await bindingForGroups(db(), scenario.workspaceId, [
      hr ?? "",
      sales ?? "",
    ]);
    const forSalesAndBoard = await bindingForGroups(db(), scenario.workspaceId, [
      sales ?? "",
      board ?? "",
    ]);
    const forEveryone = await bindingHolding(db(), scenario.workspaceId);

    const narrowed = await conceptCiting(scenario, scenario.editor, [
      forHrAndSales.documentId,
      forSalesAndBoard.documentId,
      forEveryone.documentId,
    ]);
    const widened = await conceptCiting(scenario, scenario.editor, [
      forHrAndSales.documentId,
      forEveryone.documentId,
    ]);

    expect(await heldRow(scenario.workspaceId, narrowed.iri)).toEqual({
      sensitivity: "Internal",
      audience: "groups",
      audience_groups: [sales],
    });
    expect(await heldRow(scenario.workspaceId, widened.iri)).toEqual({
      sensitivity: "Internal",
      audience: "groups",
      audience_groups: [hr, sales].toSorted(),
    });
  });

  it("forces a concept Restricted when the audiences share nobody, and never stores an empty list", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", [scenario.viewer]);
    const sales = await groupNamed(db(), scenario, "Sales", []);
    const forHr = await bindingForGroups(db(), scenario.workspaceId, [hr]);
    const forSales = await bindingForGroups(db(), scenario.workspaceId, [sales]);

    const written = await conceptCiting(scenario, scenario.editor, [
      forHr.documentId,
      forSales.documentId,
    ]);

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
    // Nobody's: the HR Viewer passes neither the class nor an audience that is not there.
    const seen = await reading(scenario.viewer, (viewer, tx) =>
      open(viewer, tx, { iri: written.iri }),
    );
    expect(seen.ok && seen.value.found).toBe(false);
  });

  it("floors a Person at Restricted whatever its evidence says", async () => {
    const scenario = await arrange();
    const website = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Public" });

    const person = await conceptCiting(scenario, scenario.editor, [website.documentId], {
      kind: "Person",
      frontmatter: { title: "Ada Lovelace", type: "Person" },
    });
    const page = await conceptCiting(scenario, scenario.editor, [website.documentId]);

    expect(await heldRow(scenario.workspaceId, person.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(await heldRow(scenario.workspaceId, page.iri)).toEqual({
      sensitivity: "Public",
      ...EVERYONE,
    });
  });

  it("keeps the writer's word when nothing it cites resolves to a catalogued document", async () => {
    const scenario = await arrange();

    const written = await conceptCiting(scenario, scenario.editor, [ulid()], {
      sensitivity: "Internal",
    });

    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
  });

  it("keeps a re-write's audience when it drops the citations that named it, rather than widening", async () => {
    const scenario = await arrange();
    // The Editor is in the group, so the concept is theirs to re-write.
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", [scenario.editor]);

    await conceptCiting(scenario, scenario.editor, [], {
      iri: written.iri,
      path: written.path,
      expects: { head: written.sha },
    });

    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Internal",
      audience: "groups",
      audience_groups: [hr],
    });
  });
});

/**
 * A re-write of one concept by this person, citing these documents — the act as `writeConcept`
 * answers it, refusal and all, against the bundle's current head.
 */
const rewriteCiting = async (
  scenario: Scenario,
  writer: UserPrincipal,
  written: SourcedConcept,
  documents: readonly string[],
  overrides: Partial<WriteConceptInput> = {},
) =>
  writeConcept(writer, doorsOf(scenario), {
    iri: written.iri,
    mergeKey: written.mergeKey,
    path: written.path,
    kind: "Note",
    title: written.title,
    frontmatter: { title: written.title, type: "Note" },
    body: "The note says something else now.",
    message: "Re-write the note",
    author: { name: "Ada Editor", email: "ada@acme.invalid" },
    expects: { head: await head(writer, scenario.git) },
    evidence: documents.map((sourceDocumentId, at) => ({
      sourceDocumentId,
      locator: `p.${at + 1}`,
      resource: `Document ${at + 1}`,
    })),
    ...overrides,
  });

describe("what a re-write may not do to the class a concept holds", () => {
  it("refuses a re-write whose new citations would widen the class or audience the concept holds, and makes no commit", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
    const forHr = await bindingForGroups(db(), scenario.workspaceId, [hr]);
    // The Admin may read a Restricted concept, so the refusal below is the widening's alone.
    const restrictedNote = await conceptCiting(scenario, scenario.admin, [restricted.documentId]);
    const hrNote = await conceptCiting(scenario, scenario.editor, [forHr.documentId]);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    // Swapping the Restricted document for an Internal one would land the concept Internal
    // — an un-narrowing no Admin recorded; swapping HR's for everyone's widens the audience.
    const widenedClass = await rewriteCiting(scenario, scenario.admin, restrictedNote, [
      internal.documentId,
    ]);
    const widenedAudience = await rewriteCiting(scenario, scenario.editor, hrNote, [
      internal.documentId,
    ]);

    expect(widenedClass).toEqual({ ok: false, error: "widening-refused" });
    expect(widenedAudience).toEqual({ ok: false, error: "widening-refused" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
    expect(await heldRow(scenario.workspaceId, restrictedNote.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(await heldRow(scenario.workspaceId, hrNote.iri)).toEqual({
      sensitivity: "Internal",
      audience: "groups",
      audience_groups: [hr],
    });
  });

  it("an Editor cannot re-write a concept the predicate withholds from them, even one they wrote", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const board = await groupNamed(db(), scenario, "Board", []);
    const forBoard = await bindingForGroups(db(), scenario.workspaceId, [board]);
    const restrictedNote = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);
    const boardNote = await conceptCiting(scenario, scenario.editor, [forBoard.documentId]);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    const byClass = await rewriteCiting(scenario, scenario.editor, restrictedNote, [
      restricted.documentId,
    ]);
    const byAudience = await rewriteCiting(scenario, scenario.editor, boardNote, [
      forBoard.documentId,
    ]);
    // The Admin reaches the Restricted one and re-writes it; the audience narrows Admins too.
    const byAdmin = await rewriteCiting(scenario, scenario.admin, restrictedNote, [
      restricted.documentId,
    ]);

    expect(byClass).toEqual({ ok: false, error: "no-such-concept" });
    expect(byAudience).toEqual({ ok: false, error: "no-such-concept" });
    expect(byAdmin.ok).toBe(true);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(before.length + 1);
  });

  it("answers an Editor's re-write of a withheld IRI word for word as one of an IRI nobody minted, and refuses a creation onto a withheld concept's merge key before any commit", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      kind: "Person",
      frontmatter: { title: "Jane Doe", type: "Person" },
      mergeKey: "person:jane doe",
    });
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    const ofWithheld = await rewriteCiting(scenario, scenario.editor, withheld, []);
    const ofAbsent = await rewriteCiting(
      scenario,
      scenario.editor,
      { ...withheld, iri: conceptIriOf(ulid()) },
      [],
    );
    // The one oracle that cannot close: a key is one concept's, so a creation onto a key a
    // withheld concept holds cannot land as a creation onto a free key would. What the act
    // guarantees is that the refusal is read before the commit — a commit refused by the
    // index afterwards would be the reconciler's stop, and a way for an Editor to wedge the
    // bundle behind it (ADR 0012, 2026-09-07).
    const ontoKey = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: withheld.mergeKey,
      path: "knowledge/jane-doe-again.md",
      kind: "Person",
      title: "Jane Doe",
      frontmatter: { title: "Jane Doe", type: "Person" },
      body: "A second card.",
      message: "Record a second card",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head: await head(scenario.editor, scenario.git) },
    });

    expect(ofWithheld).toEqual({ ok: false, error: "no-such-concept" });
    expect(ofAbsent).toEqual(ofWithheld);
    expect(ontoKey).toEqual({ ok: false, error: "merge-key-taken" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
  });

  it("a re-write that narrows a concept takes its compositions with it, on the write road as on the narrowing's", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [internal.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [written.iri]);
    const footnotes = () =>
      reading(scenario.viewer, (viewer, tx) => footnotesOf(viewer, tx, composition));
    expect(await footnotes()).toEqual({
      ok: true,
      value: [{ label: expect.any(String), iri: written.iri, title: written.title }],
    });

    const narrowed = await rewriteCiting(scenario, scenario.editor, written, [
      restricted.documentId,
    ]);

    expect(narrowed.ok).toBe(true);
    // The second level of the cascade ran in the write's own transaction: the composition's
    // columns are its include's, and the Viewer loses the page as they do after a narrowing
    // of the binding — nothing, not an empty list.
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
    expect(await footnotes()).toEqual({ ok: true, value: undefined });
  });
});

describe("narrowing a binding", () => {
  it("recomputes the concepts citing its documents and the compositions including them, in its own transaction, with its ledger row", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const other = await bindingHolding(db(), scenario.workspaceId);
    const cited = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    const linked = await conceptCiting(scenario, scenario.editor, [binding.documentId], {
      body: `See [the first note](/${cited.path}).`,
    });
    const untouched = await conceptCiting(scenario, scenario.editor, [other.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [
      cited.iri,
      untouched.iri,
    ]);

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowBinding(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Restricted",
        audience: "everyone",
      }),
    );

    expect(narrowed).toMatchObject({
      ok: true,
      value: {
        bindingId: binding.bindingId,
        concepts: [cited.iri, linked.iri].toSorted(),
        compositions: [composition],
      },
    });
    // Both levels of the cascade, and the map's copies — the node and the edges that wear
    // the from-concept's columns — moved with the row.
    for (const iri of [cited.iri, linked.iri]) {
      expect(await rowAndNode(scenario.workspaceId, iri)).toEqual(
        bothAt({ sensitivity: "Restricted", ...EVERYONE }),
      );
    }
    expect(await edgeVisibilityHeld(db().pool, scenario.workspaceId, linked.iri)).toEqual([
      { sensitivity: "Restricted", ...EVERYONE },
    ]);
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(await heldRow(scenario.workspaceId, untouched.iri)).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
    // The ledger row: the binding as subject, the decision in the glossary's words.
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed")).toEqual(
      [
        {
          id: narrowed.ok ? narrowed.value.auditEventId : "",
          actor: `human:${scenario.admin.userId}`,
          subject_id: binding.bindingId,
          detail: { bindingId: binding.bindingId, sensitivity: "Restricted", audience: "everyone" },
        },
      ],
    );
  });

  it("narrows an audience to named groups, and the Viewer outside them loses the concept at once", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [written.iri]);

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowBinding(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [hr],
      }),
    );

    expect(narrowed.ok).toBe(true);
    const named = { sensitivity: "Internal", audience: "groups", audience_groups: [hr] };
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual(named);
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual(named);
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual(named);
    const [viewer, editor] = await Promise.all(
      [scenario.viewer, scenario.editor].map((person) =>
        reading(person, (reader, tx) => open(reader, tx, { iri: written.iri })),
      ),
    );
    expect(viewer?.ok && viewer.value.found).toBe(false);
    expect(editor?.ok && editor.value.found).toBe(true);
  });

  it("refuses a Viewer and an Editor before anything moves", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);

    for (const person of [scenario.viewer, scenario.editor]) {
      const refused = await reading(person, (reader, tx) =>
        narrowBinding(reader, tx, {
          bindingId: binding.bindingId,
          sensitivity: "Restricted",
          audience: "everyone",
        }),
      );
      expect(refused).toEqual({ ok: false, error: "role-forbids" });
    }
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
  });

  it("refuses a move that would widen on any term — the class, everyone where groups were named, or a group the list did not hold", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", []);
    const sales = await groupNamed(db(), scenario, "Sales", []);
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const forHr = await bindingForGroups(db(), scenario.workspaceId, [hr]);

    const moves = [
      { bindingId: restricted.bindingId, sensitivity: "Internal", audience: "everyone" },
      { bindingId: forHr.bindingId, sensitivity: "Internal", audience: "everyone" },
      {
        bindingId: forHr.bindingId,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [hr, sales],
      },
    ];
    for (const move of moves) {
      const refused = await reading(scenario.admin, (admin, tx) => narrowBinding(admin, tx, move));
      expect(refused).toEqual({ ok: false, error: "widening-refused" });
    }
    // And the narrowing of the same list is allowed: fewer groups, never more.
    const kept = await reading(scenario.admin, (admin, tx) =>
      narrowBinding(admin, tx, {
        bindingId: forHr.bindingId,
        sensitivity: "Restricted",
        audience: "groups",
        audienceGroups: [hr],
      }),
    );
    expect(kept.ok).toBe(true);
  });

  it("refuses a group this workspace does not hold, a binding it does not hold, and a pair that is not an audience", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const elsewhere = await arrange();
    const theirGroup = await groupNamed(db(), elsewhere, "HR", []);

    const refusals = await Promise.all(
      [
        {
          bindingId: binding.bindingId,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [theirGroup],
        },
        { bindingId: ulid(), sensitivity: "Restricted", audience: "everyone" },
        {
          bindingId: binding.bindingId,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [],
        },
        {
          bindingId: binding.bindingId,
          sensitivity: "Internal",
          audience: "everyone",
          audienceGroups: [ulid()],
        },
        { bindingId: binding.bindingId, sensitivity: "Secret", audience: "everyone" },
      ].map((move) => reading(scenario.admin, (admin, tx) => narrowBinding(admin, tx, move))),
    );

    expect(refusals.map((refused) => (refused.ok ? "ok" : refused.error))).toEqual([
      "no-such-group",
      "no-such-binding",
      "malformed",
      "malformed",
      "malformed",
    ]);
  });

  /**
   * A binding narrowed to Restricted on a second connection and **held open** across a write:
   * the write is started, seen from the database itself to be waiting on a row the narrowing
   * holds — "still pending after a pause" would also be true of a write that was merely slow
   * to reach it — then the narrowing commits and the write is expected to land.
   */
  const writeBesideAnOpenNarrowing = async (
    scenario: Scenario,
    bindingId: string,
    write: () => Promise<Awaited<ReturnType<typeof rewriteCiting>>>,
  ) => {
    const narrowing = await db().runtimePool.connect();
    try {
      await narrowing.query("BEGIN");
      await narrowing.query("SELECT set_config('app.workspace_id', $1, true)", [
        scenario.workspaceId,
      ]);
      const narrowed = await narrowBinding(scenario.admin, narrowing, {
        bindingId,
        sensitivity: "Restricted",
        audience: "everyone",
      });
      expect(narrowed.ok).toBe(true);

      let settled = false;
      const landing = write().then((outcome) => {
        settled = true;
        return outcome;
      });
      await until(someoneWaitsOnALock);
      expect(settled).toBe(false);

      await narrowing.query("COMMIT");
      expect(await landing).toMatchObject({ ok: true });
    } finally {
      // A no-op after the COMMIT; what frees the write if an assertion above failed first.
      await attempt(() => narrowing.query("ROLLBACK"));
      narrowing.release();
    }
  };

  it("holds a write landing beside it until it has committed, so the write derives from the narrowed binding and never lands wider", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);

    // READ COMMITTED would let a plain read of the binding see the row before the narrowing
    // and derive Internal, then commit after it — a concept citing a Restricted binding at
    // Internal until the next recompute. The write has to wait on the binding row instead.
    await writeBesideAnOpenNarrowing(scenario, binding.bindingId, () =>
      rewriteCiting(scenario, scenario.editor, written, [binding.documentId]),
    );

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("clamps a re-write that swapped its evidence to the pair the row holds when it lands, when a cascade narrowed the row between the write's check and its landing", async () => {
    const scenario = await arrange();
    const cited = await bindingHolding(db(), scenario.workspaceId);
    const other = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [cited.documentId]);

    // The narrowing is of the binding the concept cites *today*, and its cascade has moved
    // the concept's row to Restricted, uncommitted. The re-write cites the other binding —
    // Internal — so its pre-commit check reads the row as it stands committed (Internal) and
    // derives Internal from the new citations: no widening, and a commit is made. The landing
    // derives Internal from the new binding too, which nothing it read FOR SHARE would stop;
    // only the row itself, read again in the landing's own transaction, says the concept has
    // since narrowed.
    await writeBesideAnOpenNarrowing(scenario, cited.bindingId, () =>
      rewriteCiting(scenario, scenario.editor, written, [other.documentId]),
    );

    // Restricted — what the row held when the rows landed — and not the Internal the new
    // citations derive: a re-write never widens a concept, whichever instant the widening
    // would have slipped through at.
    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("counts an include whose concept has no row as Restricted, so a composition never widens over a concept nobody can yet say the class of", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    // An include naming an identity with no index row — a creation whose rows were lost in
    // the crash window and not yet replayed, as the cascade may find one.
    const composition = await seededBy(db(), async (seed) => {
      const page = await seed.composition({ workspaceId: scenario.workspaceId });
      await seed.compositionInclude({
        workspaceId: scenario.workspaceId,
        compositionId: page.id,
        iri: written.iri,
        ordinal: 0,
      });
      await seed.compositionInclude({
        workspaceId: scenario.workspaceId,
        compositionId: page.id,
        ordinal: 1,
      });
      return page.id;
    });

    // A narrowing that changes nothing recomputes all the same, and that is the road to the
    // composition's recompute here.
    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowBinding(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        audience: "everyone",
      }),
    );

    expect(narrowed).toMatchObject({ ok: true, value: { compositions: [composition] } });
    // Not the Internal its one readable include would derive: the missing include stands
    // in at the most restrictive visibility there is until its row does.
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
  });

  /**
   * A re-write started and **parked** at its first write to `table` by `whileActsWaitAt`,
   * a narrowing then started beside it and seen from the database to be waiting too, and
   * the pair released: the shape of every race between the write road and the cascade.
   */
  const narrowingBesideAParkedWrite = async (
    scenario: Scenario,
    table: string,
    event: "INSERT" | "UPDATE",
    write: () => Promise<Awaited<ReturnType<typeof rewriteCiting>>>,
    narrowing: NarrowBindingInput,
  ): Promise<void> => {
    await whileActsWaitAt(db().pool, table, event, async (release) => {
      const rewriting = write();
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 1);
      const narrowed = reading(scenario.admin, (admin, tx) => narrowBinding(admin, tx, narrowing));
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 2);
      await release();
      expect(await rewriting).toMatchObject({ ok: true });
      expect(await narrowed).toMatchObject({ ok: true });
    });
  };

  it("re-derives a concept from what it cites after waiting on a re-write's row, so a narrowing of the citation the re-write dropped never overwrites what the re-write landed", async () => {
    const scenario = await arrange();
    const dropped = await bindingHolding(db(), scenario.workspaceId);
    const kept = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [dropped.documentId]);

    // The re-write swaps its citation from one binding to the other and is held inside its
    // landing — its row taken, its citations replaced, the commit row not yet written —
    // while the binding it dropped is narrowed. The cascade sees the concept as still citing
    // that binding (the swap is uncommitted), reaches the row and waits.
    await narrowingBesideAParkedWrite(
      scenario,
      "bundle_commit",
      "INSERT",
      () => rewriteCiting(scenario, scenario.editor, written, [kept.documentId]),
      { bindingId: dropped.bindingId, sensitivity: "Restricted", audience: "everyone" },
    );

    // Internal — what the binding it now cites allows — and not the Restricted a cascade
    // deriving from the citation it had already dropped would have written over it.
    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Internal", ...EVERYONE }),
    );
  });

  it("recomputes a composition two acts reach one after the other, so two disjoint audiences intersect to nobody rather than to the last writer's groups", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
    const sales = await groupNamed(db(), scenario, "Sales", [scenario.viewer]);
    const forHr = await bindingForGroups(db(), scenario.workspaceId, [hr]);
    const open = await bindingHolding(db(), scenario.workspaceId);
    const other = await bindingHolding(db(), scenario.workspaceId);
    const narrowing = await conceptCiting(scenario, scenario.editor, [other.documentId]);
    const cited = await conceptCiting(scenario, scenario.editor, [open.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [
      narrowing.iri,
      cited.iri,
    ]);

    // The re-write takes its concept to HR alone and is held at its composition update,
    // having derived the page from the other include as it stood — everyone. The narrowing
    // then takes the other include to Sales alone and reaches the same page.
    await narrowingBesideAParkedWrite(
      scenario,
      "composition",
      "UPDATE",
      () => rewriteCiting(scenario, scenario.editor, narrowing, [forHr.documentId]),
      {
        bindingId: open.bindingId,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [sales],
      },
    );

    // HR and Sales share nobody: the page is for nobody, which is Restricted for everyone
    // (ADR 0039) — never the groups of whichever act wrote last.
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
  });

  it("lands two narrowings of two bindings one concept cites one after the other, never as a deadlock", async () => {
    const scenario = await arrange();
    const first = await bindingHolding(db(), scenario.workspaceId);
    const second = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [
      first.documentId,
      second.documentId,
    ]);

    // The first narrowing is held at its ledger row — its binding taken, its cascade not
    // yet run — while the second narrowing starts. Without one lock at the head, each would
    // hold its own binding and want the other through the concept citing both, and Postgres
    // would end one Admin's act with an error.
    await whileActsWaitAt(db().pool, "audit_event", "INSERT", async (release) => {
      // The second starts only once the first is parked, so the order is the one the
      // deadlock needs and never the one a fast first narrowing would have finished in.
      const narrowings: Promise<Awaited<ReturnType<typeof narrowBinding>>>[] = [];
      for (const [at, binding] of [first, second].entries()) {
        narrowings.push(
          reading(scenario.admin, (admin, tx) =>
            narrowBinding(admin, tx, {
              bindingId: binding.bindingId,
              sensitivity: "Restricted",
              audience: "everyone",
            }),
          ),
        );
        await until(async () => (await countWaitingOnLocks(db().pool)) >= at + 1);
      }
      const settling = Promise.all(narrowings);
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 2);
      await release();
      const [one, two] = await settling;
      expect(one).toMatchObject({ ok: true });
      expect(two).toMatchObject({ ok: true });
    });

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed"),
    ).toHaveLength(2);
  });

  it("leaves neither the narrowed row, nor the cascade, nor its ledger row when the transaction fails after it", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);

    // `[AUDIT1]` and `[TEST8]`: a failure provoked after the act's rows and its ledger row
    // have landed, and the assertion on what the transaction left, before any value.
    await expect(
      reading(scenario.admin, async (admin, tx) => {
        const narrowed = await narrowBinding(admin, tx, {
          bindingId: binding.bindingId,
          sensitivity: "Restricted",
          audience: "everyone",
        });
        expect(narrowed.ok).toBe(true);
        await attempt(() =>
          tx.query(
            "INSERT INTO source_binding (workspace_id, id, sensitivity, audience) VALUES ($1, $2, 'Internal', 'everyone')",
            [scenario.workspaceId, binding.bindingId],
          ),
        );
      }),
    ).rejects.toThrow(/did not commit/);

    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
    expect(await ledgerRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed")).toEqual(
      [],
    );
  });
});

describe("an Admin's recorded override", () => {
  it("widens past the floor and the evidence, names the Admin on the row and the ledger, and cascades to the compositions", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const person = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      kind: "Person",
      frontmatter: { title: "Ada Lovelace", type: "Person" },
    });
    const composition = await compositionIncluding(scenario.workspaceId, [person.iri]);
    // As the cascade would have left it: a composition including a Restricted concept.
    await db().pool.query(
      "UPDATE composition SET sensitivity = 'Restricted' WHERE workspace_id = $1 AND id = $2",
      [scenario.workspaceId, composition],
    );

    const overridden = await overriddenTo(scenario, person.iri, "Internal");

    expect(overridden).toMatchObject({
      ok: true,
      value: { iri: person.iri, compositions: [composition] },
    });
    expect(await rowAndNode(scenario.workspaceId, person.iri)).toEqual(
      bothAt({ sensitivity: "Internal", ...EVERYONE }),
    );
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
    const recorded = await db().pool.query<{ actor: string; audit_event_id: string }>(
      "SELECT actor, audit_event_id FROM concept_class_override WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, person.iri],
    );
    const auditEventId = overridden.ok ? overridden.value.auditEventId : "";
    expect(recorded.rows).toEqual([
      { actor: `human:${scenario.admin.userId}`, audit_event_id: auditEventId },
    ]);
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: person.iri,
        detail: { iri: person.iri, sensitivity: "Internal", audience: "everyone" },
      },
    ]);
    // The Viewer now sees the concept — and its class is derived from nothing they could read.
    const seen = await reading(scenario.viewer, (viewer, tx) =>
      open(viewer, tx, { iri: person.iri }),
    );
    expect(seen.ok && seen.value.found).toBe(true);
  });

  it("stands when the binding is narrowed afterwards, because it outranks the evidence", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    await overriddenTo(scenario, written.iri, "Public");

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowBinding(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Restricted",
        audience: "everyone",
      }),
    );

    expect(narrowed.ok).toBe(true);
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Public",
      ...EVERYONE,
    });
  });

  it("refuses an Editor, a concept nobody minted, a group the workspace does not hold, and a pair that is not an audience", async () => {
    const scenario = await arrange();
    const written = await conceptCiting(scenario, scenario.editor, []);
    const override = { iri: written.iri, sensitivity: "Internal", audience: "everyone" };

    const editor = await reading(scenario.editor, (person, tx) =>
      overrideConceptClass(person, tx, override),
    );
    const refusals = await Promise.all(
      [
        { ...override, iri: conceptIriOf(ulid()) },
        { ...override, audience: "groups", audienceGroups: [ulid()] },
        { ...override, audience: "groups", audienceGroups: null },
        { ...override, iri: "not-an-iri" },
      ].map((input) =>
        reading(scenario.admin, (admin, tx) => overrideConceptClass(admin, tx, input)),
      ),
    );

    expect(editor).toEqual({ ok: false, error: "role-forbids" });
    expect(refusals.map((refused) => (refused.ok ? "ok" : refused.error))).toEqual([
      "no-such-concept",
      "no-such-group",
      "malformed",
      "malformed",
    ]);
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([]);
  });

  it("leaves neither the override nor its ledger row when the transaction fails after it", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const written = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);

    await expect(
      reading(scenario.admin, async (admin, tx) => {
        const overridden = await overrideConceptClass(admin, tx, {
          iri: written.iri,
          sensitivity: "Internal",
          audience: "everyone",
        });
        expect(overridden.ok).toBe(true);
        // A second identity row under the concept's own key: the primary key refuses it,
        // which aborts the transaction the override landed in.
        await attempt(() =>
          tx.query(
            "INSERT INTO concept_identity (workspace_id, iri, merge_key) VALUES ($1, $2, 'x')",
            [scenario.workspaceId, written.iri],
          ),
        );
      }),
    ).rejects.toThrow(/did not commit/);

    const survived = await db().pool.query(
      "SELECT 1 FROM concept_class_override WHERE workspace_id = $1 AND iri = $2",
      [scenario.workspaceId, written.iri],
    );
    expect(survived.rowCount).toBe(0);
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(
      await ledgerRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([]);
  });
});

describe("the evidence pane", () => {
  const paneFor = (person: UserPrincipal, iri: string) =>
    reading(person, (reader, tx) => evidencePaneOf(reader, tx, iri));

  it("answers nothing for a concept the reader may not see, exactly as for one nobody minted", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const written = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);

    const withheld = await paneFor(scenario.viewer, written.iri);
    const absent = await paneFor(scenario.viewer, conceptIriOf(ulid()));

    expect(withheld).toEqual({ ok: true, value: undefined });
    expect(absent).toEqual(withheld);
  });

  it("leads with the reader's access and lists every piece they may open", async () => {
    const scenario = await arrange();
    const { written } = await conceptOnBoth(db(), scenario);

    const pane = await paneFor(scenario.admin, written.iri);

    expect(pane).toEqual({
      ok: true,
      value: {
        access: "included",
        lead: "Based on your current access, the evidence is included.",
        evidence: [
          { locator: "p.1", resource: "Document 1" },
          { locator: "p.2", resource: "Document 2" },
        ],
        sharedBeyondEvidence: undefined,
        next: "Open a source to read the passage the concept rests on.",
      },
    });
  });

  it("names the overriding Admin and shows nothing of the evidence when the override outruns all of it", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const written = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      kind: "Person",
      frontmatter: { title: "Ada Lovelace", type: "Person" },
    });
    await overriddenTo(scenario, written.iri, "Internal");

    const pane = await paneFor(scenario.viewer, written.iri);

    expect(pane.ok && pane.value).toMatchObject({
      access: "not-included",
      lead: "Based on your current access, the evidence isn't included. An Admin shared this concept beyond its evidence.",
      evidence: [],
      sharedBeyondEvidence: { by: `human:${scenario.admin.userId}` },
      next: "Ask an Admin for access to the sources, or read the concept as it stands.",
    });
    expect(pane.ok && pane.value?.sharedBeyondEvidence?.at).toBeInstanceOf(Date);
    // Nothing of the withheld evidence reaches the reader — not its locator, not its name.
    expect(JSON.stringify(pane)).not.toContain("Document 1");
  });

  it("lists only what the reader may open when some of the evidence is withheld", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [
      restricted.documentId,
      internal.documentId,
    ]);
    await overriddenTo(scenario, written.iri, "Internal");

    const pane = await paneFor(scenario.viewer, written.iri);

    expect(pane.ok && pane.value).toMatchObject({
      access: "partly-included",
      lead: "Based on your current access, some of the evidence isn't included. An Admin shared this concept beyond its evidence.",
      evidence: [{ locator: "p.2", resource: "Document 2" }],
      sharedBeyondEvidence: { by: `human:${scenario.admin.userId}` },
    });
  });

  it("says nothing is withheld for a concept that cites no source, and names no Admin when nothing is withheld", async () => {
    const scenario = await arrange();
    const unsourced = await conceptCiting(scenario, scenario.editor, [], {
      sensitivity: "Internal",
    });
    const internal = await bindingHolding(db(), scenario.workspaceId);
    const sourced = await conceptCiting(scenario, scenario.editor, [internal.documentId]);
    await overriddenTo(scenario, sourced.iri, "Public");

    const nothingCited = await paneFor(scenario.viewer, unsourced.iri);
    const allIncluded = await paneFor(scenario.viewer, sourced.iri);

    expect(nothingCited.ok && nothingCited.value).toEqual({
      access: "included",
      lead: "This concept cites no source, so there is nothing to include.",
      evidence: [],
      sharedBeyondEvidence: undefined,
      next: "Read the concept as it stands.",
    });
    expect(allIncluded.ok && allIncluded.value).toMatchObject({
      access: "included",
      evidence: [{ locator: "p.1", resource: "Document 1" }],
      sharedBeyondEvidence: undefined,
    });
  });

  it("withholds evidence whose binding is unpublished or whose document is uncatalogued, naming no Admin", async () => {
    const scenario = await arrange();
    const unpublished = await bindingHolding(db(), scenario.workspaceId, { publishedAt: null });
    const written = await conceptCiting(
      scenario,
      scenario.editor,
      [unpublished.documentId, ulid()],
      {
        sensitivity: "Internal",
      },
    );

    const pane = await paneFor(scenario.admin, written.iri);

    expect(pane.ok && pane.value).toMatchObject({
      access: "not-included",
      lead: "Based on your current access, the evidence isn't included.",
      evidence: [],
      sharedBeyondEvidence: undefined,
    });
  });
});

/**
 * Two concepts about expenses — one an Internal-sourced Policy the Viewer may see, one
 * Restricted-sourced and withheld from them — which is what both reads are asked about.
 */
const expensesNotes = async (scenario: Scenario) => {
  const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
  const visible = await conceptCiting(scenario, scenario.editor, [internal.documentId], {
    title: "Expenses policy",
    frontmatter: { title: "Expenses policy", type: "Policy", tags: ["finance"] },
    kind: "Policy",
  });
  const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
    title: "Expenses of the board",
  });
  return { visible, withheld, internal };
};

describe("find", () => {
  it("previews the concepts the reader may see whose title or body holds the query, and never a withheld one", async () => {
    const scenario = await arrange();
    const { visible, withheld, internal } = await expensesNotes(scenario);
    await conceptCiting(scenario, scenario.editor, [internal.documentId], {
      title: "Unrelated",
      body: "Nothing about the matter.",
    });

    const viewer = await reading(scenario.viewer, (reader, tx) =>
      find(reader, tx, { query: "expenses", limit: 5 }),
    );
    const admin = await reading(scenario.admin, (reader, tx) =>
      find(reader, tx, { query: "EXPENSES", limit: 5 }),
    );

    expect(viewer).toEqual({
      ok: true,
      value: {
        query: "expenses",
        hits: [
          {
            iri: visible.iri,
            kind: "Policy",
            title: "Expenses policy",
            trust: {
              tier: "unverified",
              status: "current",
              checkedBy: null,
              checkedAt: null,
              rider: null,
            },
            bundle: "knowledge",
            tags: ["finance"],
          },
        ],
      },
    });
    expect(admin.ok && admin.value.hits.map((hit) => hit.iri).toSorted()).toEqual(
      [visible.iri, withheld.iri].toSorted(),
    );
  });

  it("lets ask name the concepts the reader may see that its question's terms resolve to, and never a withheld one — as a refusal, since nothing drafts yet", async () => {
    const scenario = await arrange();
    const { visible, withheld } = await expensesNotes(scenario);
    const question = { question: "How are expenses claimed?" };

    const [viewer, admin, unrelated] = await Promise.all([
      reading(scenario.viewer, (reader, tx) => ask(reader, tx, question)),
      reading(scenario.admin, (reader, tx) => ask(reader, tx, question)),
      reading(scenario.viewer, (reader, tx) => ask(reader, tx, { question: "Is the sky blue?" })),
    ]);

    // Verdict first (ADR 0016), the one sentence, and the concepts it would rest on named
    // by IRI — the Viewer's answer naming only what the Viewer could open.
    expect(viewer).toEqual({
      ok: true,
      value: {
        verdict: "refuse",
        text: "Not answered from the company's knowledge.",
        citations: [{ iri: visible.iri, url: visible.iri }],
        conflicts: [],
        coverage: { asked: 1, answered: 0 },
        unmappedPassages: [],
        map: { state: "live" },
      },
    });
    expect(admin.ok && admin.value.citations.map((citation) => citation.iri).toSorted()).toEqual(
      [visible.iri, withheld.iri].toSorted(),
    );
    expect(unrelated.ok && unrelated.value.citations).toEqual([]);
  });

  it("keeps the limit, reads the query as text and never as a pattern, and answers nothing to nothing", async () => {
    const scenario = await arrange();
    const internal = await bindingHolding(db(), scenario.workspaceId);
    for (const title of ["Alpha note", "Beta note", "Gamma note"]) {
      await conceptCiting(scenario, scenario.editor, [internal.documentId], { title });
    }

    const [limited, pattern, empty] = await Promise.all(
      [
        { query: "note", limit: 2 },
        { query: "%", limit: 5 },
        { query: "   ", limit: 5 },
      ].map((input) => reading(scenario.viewer, (reader, tx) => find(reader, tx, input))),
    );

    expect(limited?.ok && limited.value.hits.map((hit) => hit.title)).toEqual([
      "Alpha note",
      "Beta note",
    ]);
    expect(pattern?.ok && pattern.value.hits).toEqual([]);
    expect(empty?.ok && empty.value.hits).toEqual([]);
  });
});
