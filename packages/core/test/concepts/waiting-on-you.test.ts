import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";

import { matching } from "@better-answers/schema/testing/matching";

import {
  submitSuggestionSet,
  waitingEdit,
  waitingOnYou,
  type SuggestionRequest,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { parseLocator, passageAt } from "../../src/sources/index.ts";
import {
  connectedSourceHolding,
  passageUnder,
  writeUpIncluding,
} from "../fixtures/sourced-concept.ts";
import { nameOwnerAs, suiteWithBundles } from "../fixtures/workspace-with-bundle.ts";
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

const named = async (principal: UserPrincipal, name: string) => {
  await db().pool.query('UPDATE "user" SET name = $2 WHERE id = $1', [principal.userId, name]);
  return { id: principal.userId, name };
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

  it("lists an unowned concept's suggestion for Admins alone", async () => {
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

  it("names the standing concept's collection, not the proposed path's", async () => {
    const scenario = await arrange();
    const standing = await conceptWritten(scenario);
    const { suggestionId } = await proposedBy(scenario, scenario.viewer, standing, {
      path: `knowledge/unowned/expenses-${nextConcept()}.md`,
    });

    expect(await waitingFor(scenario.editor)).toEqual([
      matching.objectContaining({ suggestionId, collection: "policy" }),
    ]);
  });

  it("opens an item beside its concept's current text", async () => {
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
        title: "Expenses",
        body: "Expenses are claimed within thirty days.",
        sources: undefined,
      },
      proposed: {
        title: "Expenses",
        body: "Expenses are claimed within ninety days.",
        sources: undefined,
      },
    });
  });

  it("opens the asked item of a set holding two", async () => {
    const scenario = await arrange();
    const one = await conceptWritten(scenario);
    const other = await conceptWritten(scenario);
    const requestOn = (standing: typeof one): SuggestionRequest => ({
      mergeKey: standing.input.mergeKey,
      path: standing.input.path,
      conceptKind: "Policy",
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
    assert(asked !== undefined, "the set holds the second suggestion");

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
            conceptKind: "Policy",
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
    expect(opened.current).toBeNull();
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
    const { suggestionId } = await conceptProposedBy(scenario, scenario.viewer, {
      sensitivity: "Restricted",
    });

    expect({
      owner: await suggestionsWaitingFor(scenario.editor),
      ownerOpens: await openedBy(scenario.editor, suggestionId),
      admin: await suggestionsWaitingFor(scenario.admin),
    }).toEqual({
      owner: [],
      ownerOpens: { ok: false, error: "not-found" },
      admin: [suggestionId],
    });
  });
});
