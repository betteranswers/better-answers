import { describe, expect, it } from "vitest";

import { conceptIriOf, ulid } from "@better-answers/schema";

import { find, open } from "../src/answering/index.ts";
import { evidencePaneOf, overrideConceptClass } from "../src/concepts/index.ts";
import { attempt, type UserPrincipal } from "../src/kernel/index.ts";
import { narrowBinding } from "../src/sources/index.ts";
import type { Scenario } from "./workspace-with-bundle.ts";
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
    const { groupId: hr, written } = await conceptForGroup(db(), scenario, "HR", []);

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

describe("find", () => {
  it("previews the concepts the reader may see whose title or body holds the query, and never a withheld one", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const visible = await conceptCiting(scenario, scenario.editor, [internal.documentId], {
      title: "Expenses policy",
      frontmatter: { title: "Expenses policy", type: "Policy", tags: ["finance"] },
      kind: "Policy",
    });
    const withheld = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      title: "Expenses of the board",
    });
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
