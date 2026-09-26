import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { head } from "@better-answers/core/store/git";
import { conceptIriOf, ulid } from "@better-answers/schema";
import type { TestData } from "@better-answers/schema/testing";
import { bindingIdTakenAgain, conceptIriTakenAgain } from "@better-answers/schema/testing/probes";

import { ask, find, open } from "../src/answering/index.ts";
import {
  evidencePaneOf,
  overrideConceptClass,
  writeConcept,
  type WriteConceptInput,
} from "../src/concepts/index.ts";
import { footnotesOf } from "../src/guides/index.ts";
import { attempt, parse, type UserPrincipal } from "../src/kernel/index.ts";
import {
  narrowBinding,
  narrowBindingInput,
  narrowDocuments,
  narrowDocumentsInput,
  widenBinding,
  widenBindingInput,
} from "../src/sources/index.ts";
import type { Folded, Tx } from "../src/store/postgres/index.ts";
import { bundleHistory } from "./bundle.ts";
import {
  bindingForGroups,
  bindingHolding,
  chunkUnder,
  chunkVersionsOf,
  conceptCiting,
  conceptForGroup,
  conceptOnBoth,
  documentUnder,
  edgeVisibilityHeld,
  groupNamed,
  auditEventRowsOf,
  publishedOnceIndexed,
  restrictedAndInternal,
  seededBy,
  visibilityHeld,
  visibilitySuite,
  type Sourced,
  type SourcedConcept,
} from "./sourced-concept.ts";
import { inputOf } from "./suite-input.ts";
import { countWaitingOnLocks, until, whileActsWaitAt } from "./suite-postgres.ts";
import { doorsOf, type Scenario } from "./workspace-with-bundle.ts";

const { db, arrange, reading } = visibilitySuite();

type NarrowingAsked = z.input<typeof narrowBindingInput>;

const narrowingAsked = (
  principal: Parameters<typeof narrowBinding>[0],
  tx: Parameters<typeof narrowBinding>[1],
  asked: NarrowingAsked,
) => narrowBinding(principal, tx, inputOf(narrowBindingInput, asked));

const wideningAsked = (
  principal: Parameters<typeof widenBinding>[0],
  tx: Parameters<typeof widenBinding>[1],
  asked: z.input<typeof widenBindingInput>,
) => widenBinding(principal, tx, inputOf(widenBindingInput, asked));

const RESTRICTED = { sensitivity: "Restricted" } as const;

const now = new Date("2026-09-08T12:00:00.000Z");

const heldRow = (workspaceId: string, iri: string) =>
  visibilityHeld(db().pool, "concept_index", workspaceId, iri);

const chunkVisibilityOf = async (workspaceId: string, sourceDocumentId: string) => {
  const read = await db().pool.query(
    `SELECT sensitivity, audience, audience_groups FROM "index".readable_chunk
      WHERE workspace_id = $1 AND source_document_id = $2 ORDER BY ordinal`,
    [workspaceId, sourceDocumentId],
  );
  return read.rows;
};

const HOLIDAY = "Holiday is twenty-eight days including bank holidays.";

const LOCK_NOT_AVAILABLE = "55P03";

const chunkRowsAreHeld = async (workspaceId: string, bindingId: string): Promise<boolean> => {
  const probe = await db().pool.connect();
  try {
    await probe.query("BEGIN");
    await probe.query("SET LOCAL lock_timeout = '250ms'");
    await probe.query(
      `UPDATE "index".chunk SET content = content WHERE workspace_id = $1 AND binding_id = $2`,
      [workspaceId, bindingId],
    );
    return false;
  } catch (reason) {
    const code = reason instanceof Error && "code" in reason ? String(reason.code) : "";
    if (code !== LOCK_NOT_AVAILABLE) throw reason;
    return true;
  } finally {
    await probe.query("ROLLBACK");
    probe.release();
  }
};

/**
 * No act under test holds a chunk row, so the probe's `true` branch needs this control to stay
 * honest.
 */
const whileAChunkRowIsHeld = async <T>(
  workspaceId: string,
  bindingId: string,
  work: () => Promise<T>,
): Promise<T> => {
  const holder = await db().pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query(
      `SELECT 1 FROM "index".chunk WHERE workspace_id = $1 AND binding_id = $2 FOR UPDATE`,
      [workspaceId, bindingId],
    );
    return await work();
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }
};

/** A second binding under a held id fails the transaction after the act has landed every row. */
const landedThenTheTransactionFailed = (
  scenario: Scenario,
  bindingId: string,
  act: (admin: UserPrincipal, tx: Tx) => Promise<{ readonly ok: boolean }>,
) =>
  expect(
    reading(scenario.admin, async (admin, tx) => {
      expect((await act(admin, tx)).ok).toBe(true);
      await attempt(() =>
        bindingIdTakenAgain(tx, scenario.workspaceId, {
          bindingId,
          name: "The handbook",
          sensitivity: "Internal",
        }),
      );
    }),
  ).rejects.toThrow(/did not commit/);

const widenedTo = (scenario: Scenario, bindingId: string, sensitivity: string) =>
  reading(scenario.admin, (admin, tx) =>
    wideningAsked(admin, tx, { bindingId, sensitivity, audience: "everyone" }),
  );

const overriddenTo = (scenario: Scenario, iri: string, sensitivity: string) =>
  reading(scenario.admin, (admin, tx) =>
    overrideConceptClass(admin, tx, { iri, sensitivity, audience: "everyone" }),
  );
const EVERYONE = { audience: "everyone", audience_groups: null } as const;

const landedFor = async (workspaceId: string, path: string, documentId: string) => {
  const concepts = await db().pool.query(
    "SELECT 1 FROM concept_index WHERE workspace_id = $1 AND path = $2",
    [workspaceId, path],
  );
  const cited = await db().pool.query(
    "SELECT 1 FROM evidence WHERE workspace_id = $1 AND source_document_id = $2",
    [workspaceId, documentId],
  );
  return { concepts: concepts.rowCount ?? 0, evidence: cited.rowCount ?? 0 };
};

const rowAndNode = async (workspaceId: string, iri: string) => ({
  row: await visibilityHeld(db().pool, "concept_index", workspaceId, iri),
  node: await visibilityHeld(db().pool, "graph_node", workspaceId, iri),
});

const bothAt = (pair: object) => ({ row: pair, node: pair });

const documentsCitedBy = async (workspaceId: string, iri: string) => {
  const read = await db().pool.query<{ source_document_id: string }>(
    "SELECT source_document_id FROM concept_evidence WHERE workspace_id = $1 AND iri = $2",
    [workspaceId, iri],
  );
  return read.rows.map((row) => row.source_document_id).toSorted();
};

const statementsWaitingOnALock = async (): Promise<readonly string[]> => {
  const found = await db().pool.query<{ query: string }>(
    "SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  );
  return found.rows.map((row) => row.query);
};

const someoneWaitsOnALock = async (): Promise<boolean> =>
  (await statementsWaitingOnALock()).length > 0;

const besideAnOpenNarrowing = async <T>(
  scenario: Scenario,
  narrowing: (tx: Tx) => Promise<{ readonly ok: boolean }>,
  act: () => Promise<T>,
): Promise<{ readonly outcome: T; readonly waitingAt: readonly string[] }> => {
  const holder = await db().runtimePool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT set_config('app.workspace_id', $1, true)", [scenario.workspaceId]);
    expect(await narrowing(holder)).toMatchObject({ ok: true });

    let settled = false;
    const acting = act().then((outcome) => {
      settled = true;
      return outcome;
    });
    await until(someoneWaitsOnALock);
    const waitingAt = await statementsWaitingOnALock();
    expect(settled).toBe(false);

    await holder.query("COMMIT");
    return { outcome: await acting, waitingAt };
  } finally {
    await attempt(() => holder.query("ROLLBACK"));
    holder.release();
  }
};

const compositionIncluding = (
  workspaceId: string,
  iris: readonly string[],
  held: { readonly sensitivity?: string; readonly audienceGroups?: readonly string[] } = {},
): Promise<string> =>
  seededBy(db(), async (seed) => {
    const composition = await seed.composition({
      workspaceId,
      ...(held.sensitivity === undefined ? {} : { sensitivity: held.sensitivity }),
      ...(held.audienceGroups === undefined
        ? {}
        : { audience: "groups", audienceGroups: [...held.audienceGroups] }),
    });
    for (const [ordinal, iri] of iris.entries()) {
      await seed.compositionInclude({ workspaceId, compositionId: composition.id, iri, ordinal });
    }
    return composition.id;
  });

describe("what a governed write derives from its cited bindings", () => {
  it("lands the most restrictive class on both row and map", async () => {
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

  it("forces Restricted, not an empty list, when audiences share nobody", async () => {
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

    const seen = await reading(scenario.viewer, (viewer, tx) =>
      open(viewer, tx, { iri: written.iri }, now),
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

  it("refuses citing an uncatalogued document by name, landing nothing", async () => {
    const scenario = await arrange();
    const uncatalogued = ulid();
    const path = "knowledge/cites-an-uncatalogued-document.md";
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    const refused = await writeConcept(scenario.editor, doorsOf(scenario), {
      mergeKey: "note:cites-an-uncatalogued-document",
      path,
      kind: "Note",
      title: "A note on a document nobody catalogued",
      frontmatter: { title: "A note on a document nobody catalogued", type: "Note" },
      body: "It cites a document the catalogue does not hold.",
      message: "Record a note citing an uncatalogued document",
      author: { name: "Ada Editor", email: "ada@acme.invalid" },
      expects: { head: await head(scenario.editor, scenario.git) },
      sensitivity: "Internal",
      evidence: [{ sourceDocumentId: uncatalogued, locator: "p.1", resource: "Document 1" }],
    });

    expect(refused).toEqual({ ok: false, error: "no-such-document" });
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
    expect(await landedFor(scenario.workspaceId, path, uncatalogued)).toEqual({
      concepts: 0,
      evidence: 0,
    });
  });

  it("keeps the writer's word when a concept cites no source", async () => {
    const scenario = await arrange();

    const written = await conceptCiting(scenario, scenario.editor, [], {
      sensitivity: "Internal",
    });

    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
  });

  it("keeps the audience of a re-write that drops its citations", async () => {
    const scenario = await arrange();

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

  it("lets a write cite an unpublished binding, landing at Restricted", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
    const unpublished = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Public",
      audience: "groups",
      audienceGroups: [hr],
      publishedAt: null,
    });
    const published = await bindingHolding(db(), scenario.workspaceId);

    const created = await conceptCiting(scenario, scenario.editor, [unpublished.documentId]);
    const standing = await conceptCiting(scenario, scenario.editor, [published.documentId]);
    const rewritten = await conceptCiting(
      scenario,
      scenario.editor,
      [published.documentId, unpublished.documentId],
      {
        iri: standing.iri,
        path: standing.path,
        mergeKey: standing.mergeKey,
        expects: { head: await head(scenario.editor, scenario.git) },
      },
    );

    const restrictedToHr = { sensitivity: "Restricted", audience: "groups", audience_groups: [hr] };
    expect(await rowAndNode(scenario.workspaceId, created.iri)).toEqual(bothAt(restrictedToHr));
    expect(await rowAndNode(scenario.workspaceId, rewritten.iri)).toEqual(bothAt(restrictedToHr));
    expect(await documentsCitedBy(scenario.workspaceId, created.iri)).toEqual([
      unpublished.documentId,
    ]);
    expect(await documentsCitedBy(scenario.workspaceId, rewritten.iri)).toEqual(
      [published.documentId, unpublished.documentId].toSorted(),
    );
  });
});

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

describe("what a re-write may not do to a concept's class", () => {
  it("refuses citations that widen the class or audience, committing nothing", async () => {
    const scenario = await arrange();
    const { restricted, internal } = await restrictedAndInternal(db(), scenario.workspaceId);
    const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
    const forHr = await bindingForGroups(db(), scenario.workspaceId, [hr]);

    const restrictedNote = await conceptCiting(scenario, scenario.admin, [restricted.documentId]);
    const hrNote = await conceptCiting(scenario, scenario.editor, [forHr.documentId]);
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

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

  it("refuses an Editor re-writing a withheld concept, even their own", async () => {
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

    const byAdmin = await rewriteCiting(scenario, scenario.admin, restrictedNote, [
      restricted.documentId,
    ]);

    expect(byClass).toEqual({ ok: false, error: "no-such-concept" });
    expect(byAudience).toEqual({ ok: false, error: "no-such-concept" });
    expect(byAdmin.ok).toBe(true);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toHaveLength(before.length + 1);
  });

  it("answers a withheld IRI as unminted, refusing its merge key", async () => {
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

  it("takes the compositions along when a re-write narrows a concept", async () => {
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

const workspaceWithHrBinding = async () => {
  const scenario = await arrange();
  const hr = await groupNamed(db(), scenario, "HR", [scenario.editor]);
  const binding = await bindingHolding(db(), scenario.workspaceId);
  return { scenario, hr, binding };
};

describe("narrowing a binding", () => {
  it("cascades to citing concepts and compositions, writing one audit event", async () => {
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
      narrowingAsked(admin, tx, {
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

    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed"),
    ).toEqual([
      {
        id: narrowed.ok ? narrowed.value.auditEventId : "",
        actor: `human:${scenario.admin.userId}`,
        subject_id: binding.bindingId,
        detail: { bindingId: binding.bindingId, sensitivity: "Restricted", audience: "everyone" },
      },
    ]);
  });

  it("touches no document's chunk row, whatever its own class", async () => {
    const { scenario, hr, binding } = await workspaceWithHrBinding();

    const narrowed = await documentUnder(
      db(),
      scenario.workspaceId,
      binding.bindingId,
      "Restricted",
    );
    const wider = await documentUnder(db(), scenario.workspaceId, binding.bindingId, "Public");
    for (const document of [binding, narrowed, wider]) {
      await chunkUnder(db(), scenario.workspaceId, document, {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
      });
    }
    const stoodAt = await chunkVersionsOf(db(), scenario.workspaceId, binding.bindingId);

    const moved = await reading(scenario.admin, (admin, tx) =>
      narrowingAsked(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [hr],
      }),
    );

    expect(moved.ok).toBe(true);
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual({ sensitivity: "Internal", audience: "groups", audience_groups: [hr] });
    expect(await chunkVersionsOf(db(), scenario.workspaceId, binding.bindingId)).toEqual(stoodAt);

    const toTheGroup = { audience: "groups", audience_groups: [hr] };
    expect(await chunkVisibilityOf(scenario.workspaceId, binding.documentId)).toEqual([
      { sensitivity: "Internal", ...toTheGroup },
    ]);

    expect(await chunkVisibilityOf(scenario.workspaceId, narrowed.documentId)).toEqual([
      { sensitivity: "Restricted", ...toTheGroup },
    ]);
    expect(await chunkVisibilityOf(scenario.workspaceId, wider.documentId)).toEqual([
      { sensitivity: "Internal", ...toTheGroup },
    ]);
  });

  it("holds no chunk row while waiting on the concept index", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const elsewhere = await bindingHolding(db(), scenario.workspaceId);
    await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    for (const document of [binding, elsewhere]) {
      await chunkUnder(db(), scenario.workspaceId, document, {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
      });
    }

    expect(
      await whileAChunkRowIsHeld(scenario.workspaceId, binding.bindingId, () =>
        chunkRowsAreHeld(scenario.workspaceId, binding.bindingId),
      ),
    ).toBe(true);

    await whileActsWaitAt(db().pool, "concept_index", "UPDATE", async (release) => {
      const narrowing = reading(scenario.admin, (admin, tx) =>
        narrowingAsked(admin, tx, {
          bindingId: binding.bindingId,
          sensitivity: "Restricted",
          audience: "everyone",
        }),
      );
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 1);

      expect(await chunkRowsAreHeld(scenario.workspaceId, binding.bindingId)).toBe(false);

      expect(await chunkRowsAreHeld(scenario.workspaceId, elsewhere.bindingId)).toBe(false);

      await release();
      expect(await narrowing).toMatchObject({ ok: true });
    });

    expect(await chunkVisibilityOf(scenario.workspaceId, binding.documentId)).toEqual([
      { sensitivity: "Restricted", ...EVERYONE },
    ]);
  });

  it("narrows to named groups; an outside Viewer loses the concept", async () => {
    const { scenario, hr, binding } = await workspaceWithHrBinding();
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [written.iri]);

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowingAsked(admin, tx, {
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
        reading(person, (reader, tx) => open(reader, tx, { iri: written.iri }, now)),
      ),
    );
    expect(viewer?.ok && viewer.value.found).toBe(false);
    expect(editor?.ok && editor.value.found).toBe(true);
  });

  // A shape says nothing of a tenant's state, so refusing it ahead of the role leaks nothing.
  it("names a malformed field before weighing role, and moves nothing", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);

    expect(
      parse(narrowBindingInput, {
        bindingId: "not-a-binding-id",
        sensitivity: "Restricted",
        audience: "everyone",
      }),
    ).toEqual({ ok: false, error: { word: "malformed", fields: { bindingId: "bad-format" } } });

    for (const person of [scenario.viewer, scenario.editor]) {
      const refused = await reading(person, (reader, tx) =>
        narrowingAsked(reader, tx, {
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

  it("refuses a move widening the class, audience or group list", async () => {
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
      const refused = await reading(scenario.admin, (admin, tx) => narrowingAsked(admin, tx, move));
      expect(refused).toEqual({ ok: false, error: "widening-refused" });
    }

    const kept = await reading(scenario.admin, (admin, tx) =>
      narrowingAsked(admin, tx, {
        bindingId: forHr.bindingId,
        sensitivity: "Restricted",
        audience: "groups",
        audienceGroups: [hr],
      }),
    );
    expect(kept.ok).toBe(true);
  });

  it("refuses a group or binding this workspace does not hold", async () => {
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
      ].map((move) => reading(scenario.admin, (admin, tx) => narrowingAsked(admin, tx, move))),
    );

    expect(refusals.map((refused) => (refused.ok ? "ok" : refused.error))).toEqual([
      "no-such-group",
      "no-such-binding",
    ]);
  });

  const writeBesideAnOpenNarrowing = async (
    scenario: Scenario,
    bindingId: string,
    write: () => Promise<Awaited<ReturnType<typeof rewriteCiting>>>,
  ) => {
    const { outcome } = await besideAnOpenNarrowing(
      scenario,
      (tx) =>
        narrowingAsked(scenario.admin, tx, {
          bindingId,
          sensitivity: "Restricted",
          audience: "everyone",
        }),
      write,
    );
    expect(outcome).toMatchObject({ ok: true });
  };

  it("makes a concurrent write wait, so it never lands wider", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);

    await writeBesideAnOpenNarrowing(scenario, binding.bindingId, () =>
      rewriteCiting(scenario, scenario.editor, written, [binding.documentId]),
    );

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("clamps a swapped-evidence re-write to the row a cascade narrowed", async () => {
    const scenario = await arrange();
    const cited = await bindingHolding(db(), scenario.workspaceId);
    const other = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [cited.documentId]);

    await writeBesideAnOpenNarrowing(scenario, cited.bindingId, () =>
      rewriteCiting(scenario, scenario.editor, written, [other.documentId]),
    );

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("counts an include with no concept row as Restricted", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);

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

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowingAsked(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        audience: "everyone",
      }),
    );

    expect(narrowed).toMatchObject({ ok: true, value: { compositions: [composition] } });

    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
  });

  const narrowingBesideAParkedWrite = async (
    scenario: Scenario,
    table: string,
    event: "INSERT" | "UPDATE",
    write: () => Promise<Awaited<ReturnType<typeof rewriteCiting>>>,
    narrowing: NarrowingAsked,
  ): Promise<void> => {
    await whileActsWaitAt(db().pool, table, event, async (release) => {
      const rewriting = write();
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 1);
      const narrowed = reading(scenario.admin, (admin, tx) => narrowingAsked(admin, tx, narrowing));
      await until(async () => (await countWaitingOnLocks(db().pool)) >= 2);
      await release();
      expect(await rewriting).toMatchObject({ ok: true });
      expect(await narrowed).toMatchObject({ ok: true });
    });
  };

  it("re-derives after waiting on a re-write, ignoring its dropped citation", async () => {
    const scenario = await arrange();
    const dropped = await bindingHolding(db(), scenario.workspaceId);
    const kept = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [dropped.documentId]);

    await narrowingBesideAParkedWrite(
      scenario,
      "bundle_commit",
      "INSERT",
      () => rewriteCiting(scenario, scenario.editor, written, [kept.documentId]),
      { bindingId: dropped.bindingId, sensitivity: "Restricted", audience: "everyone" },
    );

    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Internal", ...EVERYONE }),
    );
  });

  it("recomputes a composition two acts reach, intersecting audiences to nobody", async () => {
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

    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
  });

  it("serialises narrowings of two bindings one concept cites, never deadlocking", async () => {
    const scenario = await arrange();
    const first = await bindingHolding(db(), scenario.workspaceId);
    const second = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [
      first.documentId,
      second.documentId,
    ]);

    await whileActsWaitAt(db().pool, "audit_event", "INSERT", async (release) => {
      const narrowings: Promise<Folded<Awaited<ReturnType<typeof narrowBinding>>>>[] = [];
      for (const [at, binding] of [first, second].entries()) {
        narrowings.push(
          reading(scenario.admin, (admin, tx) =>
            narrowingAsked(admin, tx, {
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
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed"),
    ).toHaveLength(2);
  });

  it("leaves nothing, chunks included, when the transaction fails after it", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    await chunkUnder(db(), scenario.workspaceId, binding, {
      content: HOLIDAY,
      ordinal: 0,
      charStart: 0,
      charEnd: 53,
    });

    await landedThenTheTransactionFailed(scenario, binding.bindingId, (admin, tx) =>
      narrowingAsked(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Restricted",
        audience: "everyone",
      }),
    );

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

    expect(await chunkVisibilityOf(scenario.workspaceId, binding.documentId)).toEqual([
      { sensitivity: "Internal", ...EVERYONE },
    ]);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.narrowed"),
    ).toEqual([]);
  });
});

describe("publishing a binding", () => {
  it("releases its recorded class to citing concepts and compositions only", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", []);
    const unpublishedForHr = {
      sensitivity: "Internal",
      audience: "groups",
      audienceGroups: [hr],
      publishedAt: null,
    };
    const binding = await bindingHolding(db(), scenario.workspaceId, unpublishedForHr);
    const other = await bindingHolding(db(), scenario.workspaceId, unpublishedForHr);
    const cited = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    const untouched = await conceptCiting(scenario, scenario.editor, [other.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [cited.iri], {
      sensitivity: "Restricted",
      audienceGroups: [hr],
    });
    const restrictedToHr = { sensitivity: "Restricted", audience: "groups", audience_groups: [hr] };
    expect(await heldRow(scenario.workspaceId, cited.iri)).toEqual(restrictedToHr);

    const published = await publishedOnceIndexed(db(), scenario.admin, binding.bindingId);

    expect(published.ok).toBe(true);
    const internalToHr = { sensitivity: "Internal", audience: "groups", audience_groups: [hr] };
    expect(await rowAndNode(scenario.workspaceId, cited.iri)).toEqual(bothAt(internalToHr));
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual(internalToHr);
    expect(await heldRow(scenario.workspaceId, untouched.iri)).toEqual(restrictedToHr);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.published"),
    ).toMatchObject([
      { subject_id: binding.bindingId, detail: { sensitivity: "Internal", audience: "groups" } },
    ]);
  });
});

const A_HEALTH_CUE = { category: "special-category", ruleId: "HEALTH_CUE", tier: "always" };

type FindingSeeded = Omit<
  NonNullable<Parameters<TestData["finding"]>[0]>,
  "workspaceId" | "documentId"
>;

const findingIn = (scenario: Scenario, document: Sourced, finding: FindingSeeded) =>
  seededBy(db(), (seed) =>
    seed.finding({
      workspaceId: scenario.workspaceId,
      documentId: document.documentId,
      ...finding,
    }),
  );

/** Reviewed, and the run that would lift the seam's verdict not yet run: the document keeps it. */
const dismissedBy = (scenario: Scenario) => ({
  reviewState: "dismissed",
  reviewedBy: `human:${scenario.admin.userId}`,
  reviewedAt: now,
  reviewReason: "Our engineers diagnose faults in pumps, never in people.",
});

const documentClassesUnder = async (workspaceId: string, bindingId: string) => {
  const read = await db().pool.query<{ id: string; sensitivity: string | null }>(
    "SELECT id, sensitivity FROM source_document WHERE workspace_id = $1 AND binding_id = $2",
    [workspaceId, bindingId],
  );
  return Object.fromEntries(read.rows.map((row) => [row.id, row.sensitivity]));
};

describe("widening a binding", () => {
  it("widens a published binding and cascade, recording from and to", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", []);
    const binding = await bindingForGroups(db(), scenario.workspaceId, [hr], "Restricted");
    const other = await bindingForGroups(db(), scenario.workspaceId, [hr], "Restricted");
    const cited = await conceptCiting(scenario, scenario.admin, [binding.documentId]);
    const untouched = await conceptCiting(scenario, scenario.admin, [other.documentId]);
    const composition = await compositionIncluding(scenario.workspaceId, [cited.iri], {
      sensitivity: "Restricted",
      audienceGroups: [hr],
    });
    await chunkUnder(db(), scenario.workspaceId, binding, {
      content: HOLIDAY,
      ordinal: 0,
      charStart: 0,
      charEnd: 53,
    });
    const restrictedToHr = { sensitivity: "Restricted", audience: "groups", audience_groups: [hr] };
    expect(await heldRow(scenario.workspaceId, cited.iri)).toEqual(restrictedToHr);

    const widened = await widenedTo(scenario, binding.bindingId, "Internal");

    expect(widened).toMatchObject({
      ok: true,
      value: {
        bindingId: binding.bindingId,
        visibility: { sensitivity: "Internal", audience: "everyone", audienceGroups: null },
        concepts: [cited.iri],
        compositions: [composition],
      },
    });
    const internal = { sensitivity: "Internal", ...EVERYONE };
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual(internal);
    expect(await rowAndNode(scenario.workspaceId, cited.iri)).toEqual(bothAt(internal));
    expect(
      await visibilityHeld(db().pool, "composition", scenario.workspaceId, composition),
    ).toEqual(internal);
    expect(await chunkVisibilityOf(scenario.workspaceId, binding.documentId)).toEqual([internal]);
    expect(await heldRow(scenario.workspaceId, untouched.iri)).toEqual(restrictedToHr);

    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.widened"),
    ).toEqual([
      {
        id: widened.ok ? widened.value.auditEventId : "",
        actor: `human:${scenario.admin.userId}`,
        subject_id: binding.bindingId,
        detail: {
          bindingId: binding.bindingId,
          fromSensitivity: "Restricted",
          fromAudience: "groups",
          sensitivity: "Internal",
          audience: "everyone",
        },
      },
    ]);
  });

  it("never widens a document or concept past the document's class", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const verdict = await documentUnder(
      db(),
      scenario.workspaceId,
      binding.bindingId,
      "Restricted",
    );
    await findingIn(scenario, verdict, { ...A_HEALTH_CUE, ...dismissedBy(scenario) });
    const narrowed = await seededBy(db(), async (seed) => {
      const document = await seed.sourceDocument({
        workspaceId: scenario.workspaceId,
        bindingId: binding.bindingId,
        sensitivity: "Internal",
        narrowedTo: "Internal",
      });
      return { bindingId: binding.bindingId, documentId: document.id };
    });
    const onTheBinding = await conceptCiting(scenario, scenario.admin, [binding.documentId]);
    const onTheVerdict = await conceptCiting(scenario, scenario.admin, [verdict.documentId]);
    const onTheNarrowing = await conceptCiting(scenario, scenario.admin, [narrowed.documentId]);
    for (const document of [binding, verdict, narrowed]) {
      await chunkUnder(db(), scenario.workspaceId, document, {
        content: HOLIDAY,
        ordinal: 0,
        charStart: 0,
        charEnd: 53,
      });
    }
    const widened = await widenedTo(scenario, binding.bindingId, "Public");

    expect(widened.ok).toBe(true);
    const at = (sensitivity: string) => ({ sensitivity, ...EVERYONE });
    expect(await heldRow(scenario.workspaceId, onTheBinding.iri)).toEqual(at("Public"));
    expect(await heldRow(scenario.workspaceId, onTheVerdict.iri)).toEqual(at("Restricted"));
    expect(await heldRow(scenario.workspaceId, onTheNarrowing.iri)).toEqual(at("Internal"));
    expect(await chunkVisibilityOf(scenario.workspaceId, binding.documentId)).toEqual([
      at("Public"),
    ]);
    expect(await chunkVisibilityOf(scenario.workspaceId, verdict.documentId)).toEqual([
      at("Restricted"),
    ]);
    expect(await chunkVisibilityOf(scenario.workspaceId, narrowed.documentId)).toEqual([
      at("Internal"),
    ]);
    expect(await documentClassesUnder(scenario.workspaceId, binding.bindingId)).toEqual({
      [binding.documentId]: null,
      [verdict.documentId]: "Restricted",
      [narrowed.documentId]: "Internal",
    });
  });

  it("widens an unpublished binding, releasing nothing until the publish", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
      publishedAt: null,
    });
    const cited = await conceptCiting(scenario, scenario.admin, [binding.documentId]);

    const widened = await widenedTo(scenario, binding.bindingId, "Internal");

    expect(widened).toMatchObject({ ok: true, value: { concepts: [cited.iri] } });
    expect(await heldRow(scenario.workspaceId, cited.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect((await publishedOnceIndexed(db(), scenario.admin, binding.bindingId)).ok).toBe(true);
    expect(await heldRow(scenario.workspaceId, cited.iri)).toEqual({
      sensitivity: "Internal",
      ...EVERYONE,
    });
  });

  it("refuses over an unreviewed special-category finding, and moves nothing", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const cited = await conceptCiting(scenario, scenario.admin, [binding.documentId]);
    await findingIn(scenario, binding, A_HEALTH_CUE);
    const reviewed = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    await findingIn(scenario, reviewed, { ...A_HEALTH_CUE, ...dismissedBy(scenario) });
    await findingIn(scenario, reviewed, {});

    const refused = await widenedTo(scenario, binding.bindingId, "Internal");
    const widened = await widenedTo(scenario, reviewed.bindingId, "Internal");

    expect(refused).toEqual({ ok: false, error: "special-category-unreviewed" });
    expect(widened.ok).toBe(true);
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual({ sensitivity: "Restricted", ...EVERYONE });
    expect(await heldRow(scenario.workspaceId, cited.iri)).toEqual({
      sensitivity: "Restricted",
      ...EVERYONE,
    });
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.widened"),
    ).toMatchObject([{ subject_id: reviewed.bindingId }]);
  });

  it("refuses a request that is not wider, and moves nothing", async () => {
    const scenario = await arrange();
    const hr = await groupNamed(db(), scenario, "HR", []);
    const sales = await groupNamed(db(), scenario, "Sales", []);
    const forBoth = await bindingForGroups(db(), scenario.workspaceId, [hr, sales]);

    const asks = [
      { sensitivity: "Internal", audience: "groups", audienceGroups: [hr, sales] },
      { sensitivity: "Restricted", audience: "groups", audienceGroups: [hr, sales] },
      { sensitivity: "Public", audience: "groups", audienceGroups: [hr] },
    ];
    for (const asked of asks) {
      const refused = await reading(scenario.admin, (admin, tx) =>
        wideningAsked(admin, tx, { bindingId: forBoth.bindingId, ...asked }),
      );
      expect(refused).toEqual({ ok: false, error: "not-wider" });
    }
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, forBoth.bindingId),
    ).toEqual({ sensitivity: "Internal", audience: "groups", audience_groups: [hr, sales] });
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.widened"),
    ).toEqual([]);
  });

  it("refuses a non-Admin, an unknown binding and a foreign group", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const elsewhere = await arrange();
    const theirGroup = await groupNamed(db(), elsewhere, "HR", []);
    const toInternal = { sensitivity: "Internal", audience: "everyone" };

    const refusals = await Promise.all([
      reading(scenario.editor, (editor, tx) =>
        wideningAsked(editor, tx, { bindingId: binding.bindingId, ...toInternal }),
      ),
      reading(scenario.admin, (admin, tx) =>
        wideningAsked(admin, tx, { bindingId: ulid(), ...toInternal }),
      ),
      reading(scenario.admin, (admin, tx) =>
        wideningAsked(admin, tx, {
          bindingId: binding.bindingId,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [theirGroup],
        }),
      ),
    ]);

    expect(refusals.map((refused) => (refused.ok ? "ok" : refused.error))).toEqual([
      "role-forbids",
      "no-such-binding",
      "no-such-group",
    ]);
  });

  it("leaves nothing, cascade included, when the transaction fails after it", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const written = await conceptCiting(scenario, scenario.admin, [binding.documentId]);

    await landedThenTheTransactionFailed(scenario, binding.bindingId, (admin, tx) =>
      wideningAsked(admin, tx, {
        bindingId: binding.bindingId,
        sensitivity: "Public",
        audience: "everyone",
      }),
    );

    const restricted = { sensitivity: "Restricted", ...EVERYONE };
    expect(
      await visibilityHeld(db().pool, "source_binding", scenario.workspaceId, binding.bindingId),
    ).toEqual(restricted);
    expect(await heldRow(scenario.workspaceId, written.iri)).toEqual(restricted);
    expect(
      await auditEventRowsOf(db().pool, scenario.workspaceId, "sources.binding.widened"),
    ).toEqual([]);
  });
});

describe("narrowing documents", () => {
  const besideAnOpenDocumentNarrowing = async <T>(
    scenario: Scenario,
    narrowed: Sourced,
    waitingAt: string,
    act: () => Promise<T>,
  ): Promise<T> => {
    const beside = await besideAnOpenNarrowing(
      scenario,
      (tx) =>
        narrowDocuments(
          scenario.admin,
          tx,
          inputOf(narrowDocumentsInput, {
            bindingId: narrowed.bindingId,
            findingGroups: [
              {
                documentId: narrowed.documentId,
                category: "bank-details",
                ruleId: "sort-code-with-account-number",
                tier: "always",
              },
            ],
            sensitivity: "Restricted",
          }),
        ),
      act,
    );
    expect(beside.waitingAt).toEqual([expect.stringContaining(waitingAt)]);
    return beside.outcome;
  };

  it("holds a concurrent concept, which lands at the narrowed class", async () => {
    const scenario = await arrange();
    const handbook = await bindingHolding(db(), scenario.workspaceId);
    // A shared evidence row: a new one's foreign key would wait on the narrowed document before
    // the landing reached the binding.
    await conceptCiting(scenario, scenario.editor, [handbook.documentId]);

    const landed = await besideAnOpenDocumentNarrowing(scenario, handbook, "FOR SHARE", () =>
      conceptCiting(scenario, scenario.editor, [handbook.documentId]),
    );

    expect(await rowAndNode(scenario.workspaceId, landed.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("holds a re-write's check so it weighs the narrowed class", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const handbook = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.admin, [restricted.documentId]);

    const rewritten = await besideAnOpenDocumentNarrowing(
      scenario,
      handbook,
      "FOR SHARE OF b",
      () => rewriteCiting(scenario, scenario.admin, written, [handbook.documentId]),
    );

    expect(rewritten).toEqual({ ok: true, value: expect.objectContaining({ iri: written.iri }) });
    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });

  it("holds another binding's cascade, which then sees the narrowed document", async () => {
    const scenario = await arrange();
    const handbook = await bindingHolding(db(), scenario.workspaceId);
    const brochure = await bindingHolding(db(), scenario.workspaceId, { sensitivity: "Public" });
    const written = await conceptCiting(scenario, scenario.editor, [
      handbook.documentId,
      brochure.documentId,
    ]);

    const narrowed = await besideAnOpenDocumentNarrowing(
      scenario,
      handbook,
      "pg_advisory_xact_lock",
      () =>
        reading(scenario.admin, (admin, tx) =>
          narrowingAsked(admin, tx, {
            bindingId: brochure.bindingId,
            sensitivity: "Internal",
            audience: "everyone",
          }),
        ),
    );

    expect(narrowed).toMatchObject({ ok: true, value: { concepts: [written.iri] } });
    expect(await rowAndNode(scenario.workspaceId, written.iri)).toEqual(
      bothAt({ sensitivity: "Restricted", ...EVERYONE }),
    );
  });
});

describe("an Admin's recorded override", () => {
  it("widens past floor and evidence, names the Admin, and cascades", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const person = await conceptCiting(scenario, scenario.editor, [restricted.documentId], {
      kind: "Person",
      frontmatter: { title: "Ada Lovelace", type: "Person" },
    });
    const composition = await compositionIncluding(scenario.workspaceId, [person.iri]);

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
      await auditEventRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([
      {
        id: auditEventId,
        actor: `human:${scenario.admin.userId}`,
        subject_id: person.iri,
        detail: { iri: person.iri, sensitivity: "Internal", audience: "everyone" },
      },
    ]);

    const seen = await reading(scenario.viewer, (viewer, tx) =>
      open(viewer, tx, { iri: person.iri }, now),
    );
    expect(seen.ok && seen.value.found).toBe(true);
  });

  it("stands when the binding is later narrowed, outranking the evidence", async () => {
    const scenario = await arrange();
    const binding = await bindingHolding(db(), scenario.workspaceId);
    const written = await conceptCiting(scenario, scenario.editor, [binding.documentId]);
    await overriddenTo(scenario, written.iri, "Public");

    const narrowed = await reading(scenario.admin, (admin, tx) =>
      narrowingAsked(admin, tx, {
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

  it("refuses an Editor, unknown concepts and groups, and malformed audiences", async () => {
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
      await auditEventRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([]);
  });

  it("leaves no override or audit event when the transaction fails", async () => {
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

        await attempt(() => conceptIriTakenAgain(tx, scenario.workspaceId, written.iri));
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
      await auditEventRowsOf(db().pool, scenario.workspaceId, "knowledge.concept.class_overridden"),
    ).toEqual([]);
  });
});

describe("the evidence pane", () => {
  const paneFor = (person: UserPrincipal, iri: string) =>
    reading(person, (reader, tx) => evidencePaneOf(reader, tx, iri));

  it("answers a withheld concept exactly as one nobody minted", async () => {
    const scenario = await arrange();
    const restricted = await bindingHolding(db(), scenario.workspaceId, RESTRICTED);
    const written = await conceptCiting(scenario, scenario.editor, [restricted.documentId]);

    const withheld = await paneFor(scenario.viewer, written.iri);
    const absent = await paneFor(scenario.viewer, conceptIriOf(ulid()));

    expect(withheld).toEqual({ ok: true, value: undefined });
    expect(absent).toEqual(withheld);
  });

  it("leads with the reader's access and lists every openable piece", async () => {
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

  it("names the overriding Admin and hides evidence the override outruns", async () => {
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

    expect(JSON.stringify(pane)).not.toContain("Document 1");
  });

  it("lists only the openable evidence when some is withheld", async () => {
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

  it("names no Admin when nothing is withheld, sourced or not", async () => {
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

  it("withholds evidence whose binding is unpublished, naming no Admin", async () => {
    const scenario = await arrange();
    const unpublished = await bindingHolding(db(), scenario.workspaceId, { publishedAt: null });
    const written = await conceptCiting(scenario, scenario.editor, [unpublished.documentId], {
      sensitivity: "Internal",
    });

    const pane = await paneFor(scenario.admin, written.iri);

    expect(pane.ok && pane.value).toMatchObject({
      access: "not-included",
      lead: "Based on your current access, the evidence isn't included.",
      evidence: [],
      sharedBeyondEvidence: undefined,
    });
  });
});

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
  it("previews matching concepts the reader may see, never withheld ones", async () => {
    const scenario = await arrange();
    const { visible, withheld, internal } = await expensesNotes(scenario);
    await conceptCiting(scenario, scenario.editor, [internal.documentId], {
      title: "Unrelated",
      body: "Nothing about the matter.",
    });

    const viewer = await reading(scenario.viewer, (reader, tx) =>
      find(reader, tx, { query: "expenses", limit: 5 }, now),
    );
    const admin = await reading(scenario.admin, (reader, tx) =>
      find(reader, tx, { query: "EXPENSES", limit: 5 }, now),
    );

    expect(viewer).toEqual({
      ok: true,
      value: {
        query: "expenses",
        hits: [
          {
            layer: "bundles",
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

    expect(
      admin.ok &&
        admin.value.hits.flatMap((hit) => (hit.layer === "bundles" ? [hit.iri] : [])).toSorted(),
    ).toEqual([visible.iri, withheld.iri].toSorted());
  });

  it("refuses a question, citing only concepts the reader may see", async () => {
    const scenario = await arrange();
    const { visible, withheld } = await expensesNotes(scenario);
    const question = { question: "How are expenses claimed?" };

    const [viewer, admin, unrelated] = await Promise.all([
      reading(scenario.viewer, (reader, tx) => ask(reader, tx, question)),
      reading(scenario.admin, (reader, tx) => ask(reader, tx, question)),
      reading(scenario.viewer, (reader, tx) => ask(reader, tx, { question: "Is the sky blue?" })),
    ]);

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

  it("keeps the limit, reads queries literally, answers nothing to nothing", async () => {
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
      ].map((input) => reading(scenario.viewer, (reader, tx) => find(reader, tx, input, now))),
    );

    expect(limited?.ok && limited.value.hits.map((hit) => hit.title)).toEqual([
      "Alpha note",
      "Beta note",
    ]);
    expect(pattern?.ok && pattern.value.hits).toEqual([]);
    expect(empty?.ok && empty.value.hits).toEqual([]);
  });
});
