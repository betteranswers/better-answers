import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";

import { ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import {
  acceptSuggestions,
  declineSuggestion,
  submitSuggestionSet,
  waitingEdit,
  waitingOnYou,
  type SuggestionRequest,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { parseLocator, passageAt } from "../../src/sources/index.ts";
import {
  connectedSourceHolding,
  groupNamed,
  passageUnder,
  writeUpIncluding,
} from "../fixtures/sourced-concept.ts";
import {
  doorsOf,
  nameOwnerAs,
  suiteWithBundles,
  type Scenario,
} from "../fixtures/workspace-with-bundle.ts";
import {
  conceptProposedBy,
  conceptWritten,
  nextConcept,
  proposedBy,
} from "../support/suggested-concept.ts";
import { answered, readingAs } from "../support/suite-postgres.ts";

const { db, arrange } = suiteWithBundles();

const waitingFor = async (reader: UserPrincipal) =>
  answered(await readingAs(db().runtimePool, reader, waitingOnYou)).items;

const suggestionsWaitingFor = async (reader: UserPrincipal) =>
  (await waitingFor(reader)).map((item) => item.suggestionId);

const openedBy = (reader: UserPrincipal, suggestionId: string) =>
  readingAs(db().runtimePool, reader, (principal, tx) =>
    waitingEdit(
      principal,
      tx,
      { suggestionId },
      {
        passageAt: (locator) => passageAt(principal, tx, locator),
        namesPassage: (locator) => parseLocator(locator).ok,
      },
    ),
  );

const declinedBy = (scenario: Scenario, decider: UserPrincipal, suggestionId: string) =>
  declineSuggestion(decider, doorsOf(scenario), { suggestionId, reason: "Thirty days stands." });

const waitingStatusOf = async (suggestionIds: readonly string[]) => {
  const found = await db().pool.query<{ waiting: boolean }>(
    "SELECT status = 'waiting' AS waiting FROM suggestion WHERE id = ANY($1) ORDER BY id",
    [suggestionIds],
  );
  return found.rows.map((row) => row.waiting);
};

const named = async (principal: UserPrincipal, name: string) => {
  await db().pool.query('UPDATE "user" SET name = $2 WHERE id = $1', [principal.userId, name]);
  return { id: principal.userId, name };
};

const orphanedByRetitle = async (scenario: Scenario, body: string) => {
  const standing = await conceptWritten(scenario);
  const retitle = await proposedBy(scenario, scenario.viewer, standing, {
    title: "Travel Expenses",
    frontmatter: { title: "Travel Expenses", type: "Policy" },
  });
  const sibling = await proposedBy(scenario, scenario.viewer, standing, { body });
  await acceptSuggestions(scenario.admin, doorsOf(scenario), {
    decisions: [{ suggestionId: retitle.suggestionId, expectedTarget: standing.written.iri }],
  });
  return { standing, sibling };
};

describe("Waiting on you", () => {
  it("lists edit suggestions on concepts the reader owns", async () => {
    const scenario = await arrange();
    const proposer = await named(scenario.viewer, "Priya Proposer");
    const owner = await named(scenario.editor, "Olu Owner");
    const { written: standing, suggestionId } = await conceptProposedBy(scenario, scenario.viewer);
    await writeUpIncluding(db(), scenario.workspaceId, [standing.iri]);

    const items = await waitingFor(scenario.editor);

    expect(items).toEqual([
      {
        suggestionId,
        title: "Expenses",
        proposer,
        proposedAt: matching.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        target: standing.iri,
        collection: "policy",
        owner,
        baseMoved: false,
        places: 1,
      },
    ]);
  });

  it("lists none on concepts another person owns", async () => {
    const scenario = await arrange();
    const { suggestionId } = await conceptProposedBy(scenario, scenario.viewer);

    expect({
      owner: await suggestionsWaitingFor(scenario.editor),
      another: await suggestionsWaitingFor(scenario.unowned),
    }).toEqual({ owner: [suggestionId], another: [] });
  });

  it("lists an unowned concept's suggestion only to Admins", async () => {
    const scenario = await arrange();
    const { suggestionId } = await conceptProposedBy(scenario, scenario.viewer, {
      path: `knowledge/unowned/expenses-${nextConcept()}.md`,
    });

    expect({
      admin: await waitingFor(scenario.admin),
      editor: await waitingFor(scenario.editor),
      unowned: await waitingFor(scenario.unowned),
    }).toEqual({
      admin: [
        matching.objectContaining({
          suggestionId,
          owner: null,
          collection: "unowned",
        }),
      ],
      editor: [],
      unowned: [],
    });
  });

  it("lists every edit for an Admin, naming each owner", async () => {
    const scenario = await arrange();
    const collectionOwner = await named(scenario.editor, "Olu Owner");
    const overrideOwner = await named(scenario.viewer, "Vera Owner");
    const collectionOwned = await conceptProposedBy(scenario, scenario.unowned);
    const overridden = await conceptProposedBy(scenario, scenario.unowned);
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: overridden.written.iri,
      personId: scenario.viewer.userId,
    });

    const items = await waitingFor(scenario.admin);

    expect(items.map(({ suggestionId, owner }) => ({ suggestionId, owner }))).toEqual([
      { suggestionId: collectionOwned.suggestionId, owner: collectionOwner },
      { suggestionId: overridden.suggestionId, owner: overrideOwner },
    ]);
  });

  it("shows an override owner the suggestion on their concept", async () => {
    const scenario = await arrange();
    const theirs = await conceptProposedBy(scenario, scenario.unowned);
    const another = await conceptProposedBy(scenario, scenario.unowned);
    await nameOwnerAs(scenario.admin, scenario.postgres, {
      iri: theirs.written.iri,
      personId: scenario.viewer.userId,
    });

    expect({
      overrideOwner: await suggestionsWaitingFor(scenario.viewer),
      collectionOwner: await suggestionsWaitingFor(scenario.editor),
    }).toEqual({
      overrideOwner: [theirs.suggestionId],
      collectionOwner: [another.suggestionId],
    });
  });

  it("names the existing concept's collection, not the proposed path's", async () => {
    const scenario = await arrange();
    const standing = await conceptWritten(scenario);
    const { suggestionId } = await proposedBy(scenario, scenario.viewer, standing, {
      path: `knowledge/unowned/expenses-${nextConcept()}.md`,
    });

    expect(await waitingFor(scenario.editor)).toEqual([
      matching.objectContaining({ suggestionId, collection: "policy" }),
    ]);
  });

  it("opens an item next to its concept's current text", async () => {
    const scenario = await arrange();
    const standing = await conceptWritten(scenario);
    await proposedBy(scenario, scenario.viewer, standing);
    const { suggestionId } = await proposedBy(scenario, scenario.viewer, standing, {
      body: "Expenses are claimed within ninety days.",
    });

    const opened = answered(await openedBy(scenario.editor, suggestionId));

    expect(opened).toEqual({
      item: matching.objectContaining({ suggestionId, target: standing.written.iri }),
      current: {
        state: "shown",
        version: {
          title: "Expenses",
          body: "Expenses are claimed within thirty days.",
          sources: undefined,
        },
      },
      proposed: {
        title: "Expenses",
        body: "Expenses are claimed within ninety days.",
        sources: undefined,
      },
    });
  });

  it("opens the requested item of a two-item set", async () => {
    const scenario = await arrange();
    const one = await conceptWritten(scenario);
    const other = await conceptWritten(scenario);
    const requestOn = (standing: typeof one): SuggestionRequest => ({
      mergeKey: standing.input.mergeKey,
      path: standing.input.path,
      conceptType: "Policy",
      title: "Expenses",
      frontmatter: { title: "Expenses", type: "Policy" },
      body: "Expenses are claimed within sixty days.",
      baseContentHash: standing.written.contentHash,
    });
    const set = await submitSuggestionSet(
      scenario.viewer,
      { postgres: scenario.postgres },
      { kind: "edit", requests: [requestOn(one), requestOn(other)] },
    );
    assert(set.ok, `the set was not submitted: ${inspect(set)}`);
    const asked = set.value.suggestionIds[1];
    assert(asked !== undefined, "the set has no second suggestion");

    const opened = answered(await openedBy(scenario.editor, asked));

    expect(opened.item).toMatchObject({ suggestionId: asked, target: other.written.iri });
  });

  it("lists a new concept's suggestion with nothing to compare", async () => {
    const scenario = await arrange();
    const n = nextConcept();
    const set = await submitSuggestionSet(
      scenario.viewer,
      { postgres: scenario.postgres },
      {
        kind: "edit",
        requests: [
          {
            mergeKey: `policy:mileage-${n}`,
            path: `knowledge/policy/mileage-${n}.md`,
            conceptType: "Policy",
            title: "Mileage",
            frontmatter: { title: "Mileage", type: "Policy" },
            body: "Mileage is paid at 45p a mile.",
          },
        ],
      },
    );
    assert(set.ok, `the set was not submitted: ${inspect(set)}`);
    const [suggestionId = ""] = set.value.suggestionIds;

    const items = await waitingFor(scenario.editor);
    const opened = answered(await openedBy(scenario.editor, suggestionId));

    expect(items).toEqual([
      matching.objectContaining({ suggestionId, target: null, collection: "policy", places: 0 }),
    ]);
    expect(opened.current).toEqual({ state: "new-concept" });
  });

  it("opens a retitle's orphaned edit as orphaned, not withheld", async () => {
    const scenario = await arrange();
    const { sibling } = await orphanedByRetitle(
      scenario,
      "Expenses are claimed within ninety days.",
    );

    const opened = answered(await openedBy(scenario.editor, sibling.suggestionId));

    expect(opened.item).toMatchObject({ target: null, baseMoved: true });
    expect(opened.current).toEqual({ state: "orphaned" });
  });

  it("withholds a source the owner cannot open from the preview", async () => {
    const scenario = await arrange();
    const restricted = await connectedSourceHolding(db(), scenario.workspaceId, {
      sensitivity: "Restricted",
    });
    const minutes = "The board approved the new claims limit.";
    await passageUnder(db(), scenario.workspaceId, restricted, {
      content: minutes,
      ordinal: 0,
      charStart: 0,
      charEnd: minutes.length,
    });
    const locator = `${restricted.documentId}/chars:0-${minutes.length}`;
    const standing = await conceptWritten(scenario);
    const { suggestionId } = await proposedBy(scenario, scenario.viewer, standing, {
      frontmatter: {
        title: "Expenses",
        type: "Policy",
        sources: [
          {
            id: "S-1",
            title: "Board minutes",
            resource: "documents/minutes",
            locator,
          },
        ],
      },
    });

    const opened = answered(await openedBy(scenario.editor, suggestionId));

    expect(opened.proposed.sources).toEqual([
      { id: "S-1", title: "Board minutes", resource: "Board minutes" },
    ]);
    expect(JSON.stringify(opened)).not.toContain(locator);
    expect(JSON.stringify(opened)).not.toContain(restricted.documentId);
  });

  it("hides an edit whose concept the owner cannot read", async () => {
    const scenario = await arrange();
    const restricted = { sensitivity: "Restricted" } as const;
    const published = await conceptProposedBy(scenario, scenario.viewer, restricted);
    const draft = await conceptProposedBy(scenario, scenario.viewer, {
      ...restricted,
      status: "draft",
    });

    expect({
      owner: await suggestionsWaitingFor(scenario.editor),
      ownerOpensPublished: await openedBy(scenario.editor, published.suggestionId),
      ownerOpensDraft: await openedBy(scenario.editor, draft.suggestionId),
      admin: await suggestionsWaitingFor(scenario.admin),
    }).toEqual({
      owner: [],
      ownerOpensPublished: { ok: false, error: "not-found" },
      ownerOpensDraft: { ok: false, error: "not-found" },
      admin: [published.suggestionId, draft.suggestionId],
    });
  });

  it("hides an edit from an Admin outside its concept's audience", async () => {
    const scenario = await arrange();
    const published = await conceptProposedBy(scenario, scenario.viewer);
    const draft = await conceptProposedBy(scenario, scenario.viewer, { status: "draft" });
    await db().pool.query(
      `UPDATE concept_index SET audience = 'groups', audience_groups = ARRAY[$3]
        WHERE workspace_id = $1 AND iri = ANY($2)`,
      [scenario.workspaceId, [published.written.iri, draft.written.iri], ulid()],
    );

    expect({
      admin: await suggestionsWaitingFor(scenario.admin),
      adminOpensPublished: await openedBy(scenario.admin, published.suggestionId),
      adminOpensDraft: await openedBy(scenario.admin, draft.suggestionId),
      adminDeclinesPublished: await declinedBy(scenario, scenario.admin, published.suggestionId),
      adminDeclinesDraft: await declinedBy(scenario, scenario.admin, draft.suggestionId),
      stillWaiting: await waitingStatusOf([published.suggestionId, draft.suggestionId]),
    }).toEqual({
      admin: [],
      adminOpensPublished: { ok: false, error: "not-found" },
      adminOpensDraft: { ok: false, error: "not-found" },
      adminDeclinesPublished: { ok: false, error: "no-such-suggestion" },
      adminDeclinesDraft: { ok: false, error: "no-such-suggestion" },
      stillWaiting: [true, true],
    });
  });

  it("hides a retitle's orphaned edit from deciders outside its audience", async () => {
    const scenario = await arrange();
    const withheld = "The settlement figure is 4.2 million pounds.";
    const { standing, sibling } = await orphanedByRetitle(scenario, withheld);
    const orphaned = await waitingFor(scenario.admin);
    await db().pool.query(
      `UPDATE concept_index SET audience = 'groups', audience_groups = ARRAY[$3]
        WHERE workspace_id = $1 AND iri = $2`,
      [scenario.workspaceId, standing.written.iri, ulid()],
    );

    const seen = {
      admin: await suggestionsWaitingFor(scenario.admin),
      owner: await suggestionsWaitingFor(scenario.editor),
      adminOpens: await openedBy(scenario.admin, sibling.suggestionId),
      ownerOpens: await openedBy(scenario.editor, sibling.suggestionId),
      adminDeclines: await declinedBy(scenario, scenario.admin, sibling.suggestionId),
      ownerDeclines: await declinedBy(scenario, scenario.editor, sibling.suggestionId),
      adminAccepts: await acceptSuggestions(scenario.admin, doorsOf(scenario), {
        decisions: [{ suggestionId: sibling.suggestionId, expectedTarget: null }],
      }),
    };

    expect(orphaned).toEqual([
      matching.objectContaining({ suggestionId: sibling.suggestionId, target: null }),
    ]);
    expect(seen).toEqual({
      admin: [],
      owner: [],
      adminOpens: { ok: false, error: "not-found" },
      ownerOpens: { ok: false, error: "not-found" },
      adminDeclines: { ok: false, error: "no-such-suggestion" },
      ownerDeclines: { ok: false, error: "no-such-suggestion" },
      adminAccepts: {
        ok: true,
        value: [
          {
            suggestionId: sibling.suggestionId,
            outcome: { ok: false, error: "no-such-suggestion" },
          },
        ],
      },
    });
    expect(await waitingStatusOf([sibling.suggestionId])).toEqual([true]);
    expect(JSON.stringify(seen)).not.toContain(withheld);
  });

  describe("on a draft concept", () => {
    const draftProposed = (scenario: Scenario) =>
      conceptProposedBy(scenario, scenario.viewer, { status: "draft" });

    const standingText = {
      state: "shown",
      version: {
        title: "Expenses",
        body: "Expenses are claimed within thirty days.",
        sources: undefined,
      },
    };

    it("lists and opens its edit for the owner and Admins", async () => {
      const scenario = await arrange();
      const { written, suggestionId } = await draftProposed(scenario);
      const opened = { ok: true, value: matching.objectContaining({ current: standingText }) };

      expect({
        owner: await suggestionsWaitingFor(scenario.editor),
        ownerOpens: await openedBy(scenario.editor, suggestionId),
        admin: await waitingFor(scenario.admin),
        adminOpens: await openedBy(scenario.admin, suggestionId),
      }).toEqual({
        owner: [suggestionId],
        ownerOpens: opened,
        admin: [matching.objectContaining({ suggestionId, target: written.iri })],
        adminOpens: opened,
      });
    });

    it("lets an Admin in its audience group decide its edit", async () => {
      const scenario = await arrange();
      const { written, suggestionId } = await draftProposed(scenario);
      const finance = await groupNamed(db(), scenario, "Finance", [scenario.admin]);
      await db().pool.query(
        `UPDATE concept_index SET audience = 'groups', audience_groups = ARRAY[$3]
          WHERE workspace_id = $1 AND iri = $2`,
        [scenario.workspaceId, written.iri, finance],
      );

      expect({
        admin: await suggestionsWaitingFor(scenario.admin),
        adminOpens: await openedBy(scenario.admin, suggestionId),
        adminDeclines: await declinedBy(scenario, scenario.admin, suggestionId),
      }).toEqual({
        admin: [suggestionId],
        adminOpens: { ok: true, value: matching.objectContaining({ current: standingText }) },
        adminDeclines: matching.objectContaining({ ok: true }),
      });
    });

    it("hides its edit from people who may not decide it", async () => {
      const scenario = await arrange();
      const { suggestionId } = await draftProposed(scenario);

      expect({
        proposer: await suggestionsWaitingFor(scenario.viewer),
        proposerOpens: await openedBy(scenario.viewer, suggestionId),
        anotherEditor: await suggestionsWaitingFor(scenario.unowned),
        anotherEditorOpens: await openedBy(scenario.unowned, suggestionId),
      }).toEqual({
        proposer: [],
        proposerOpens: { ok: false, error: "not-found" },
        anotherEditor: [],
        anotherEditorOpens: { ok: false, error: "not-found" },
      });
    });

    it("lets the owner accept and an Admin decline its edits", async () => {
      const scenario = await arrange();
      const accepted = await draftProposed(scenario);
      const declined = await draftProposed(scenario);

      const acceptance = await acceptSuggestions(scenario.editor, doorsOf(scenario), {
        decisions: [{ suggestionId: accepted.suggestionId, expectedTarget: accepted.written.iri }],
      });
      const decline = await declineSuggestion(scenario.admin, doorsOf(scenario), {
        suggestionId: declined.suggestionId,
        reason: "Thirty days stands.",
      });
      const landed = await db().pool.query<{ status: string; body: string }>(
        "SELECT status, body FROM concept_index WHERE workspace_id = $1 AND iri = $2",
        [scenario.workspaceId, accepted.written.iri],
      );

      expect({
        acceptance,
        decline,
        landed: landed.rows,
        waiting: await suggestionsWaitingFor(scenario.admin),
      }).toEqual({
        acceptance: {
          ok: true,
          value: [
            {
              suggestionId: accepted.suggestionId,
              outcome: matching.objectContaining({ ok: true }),
            },
          ],
        },
        decline: matching.objectContaining({ ok: true }),
        landed: [{ status: "draft", body: "Expenses are claimed within sixty days." }],
        waiting: [],
      });
    });
  });
});
