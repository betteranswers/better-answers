import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import { ALL_KNOWLEDGE_KEYSTROKES as KEY } from "@/features/knowledge/curation/curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import {
  aConceptRow,
  ALL_KNOWLEDGE,
  anAllKnowledgeApi,
  asAnEditorOwning,
  knowledgeAsks,
  RHIAN,
  type ConceptRow,
} from "@test/knowledge/all-knowledge-answers.ts";
import { theOneEmptyStatus } from "@test/knowledge/empty-status.ts";
import { choosing, placedWithoutMeasuring } from "@test/measuring.ts";
import { server } from "@test/stub-server.ts";
import { ADA, aRefusalAnswer, LOST, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const ADA_OWNS = { id: ADA.personId, name: "Ada", own: false };

const THE_LEAVE = aConceptRow(1, "Annual leave", {
  owner: ADA_OWNS,
  checkedBy: "Rhian Pryce",
  checkedOn: "4 March 2026",
  trust: { tier: "human-reviewed", status: "current" },
  trustWords: "Verified by Rhian Pryce · 4 March 2026",
});

const THE_EXPENSES = aConceptRow(2, "Expense claims", {
  owner: { id: RHIAN.personId, name: "Rhian Pryce", own: true },
});

const THE_DRILLS = aConceptRow(3, "Fire drills", { collection: "safety" });

const THE_LEASE = aConceptRow(4, "Yard lease", { conceptType: "lease", collection: null });

const CONCEPTS: readonly ConceptRow[] = [THE_LEAVE, THE_EXPENSES, THE_DRILLS, THE_LEASE];

const SET_OWNER = WORDS.setOwner.action;

const region = () => within(screen.getByRole("region", { name: "All Knowledge" }));

const rowOf = (title: string) => {
  const row = region().getByRole("link", { name: title }).closest("tr");
  if (row === null) throw new Error(`${title} has no row`);
  return within(row);
};

const cellOf = (title: string, column: string): string => {
  const heads = region().getAllByRole("columnheader");
  const at = heads.findIndex((head) => head.textContent.startsWith(column));
  const row = region().getByRole("link", { name: title }).closest("tr");
  const cell = row?.children[at];
  assert(at !== -1 && cell !== undefined, `${title} has no ${column} cell`);
  return cell.textContent;
};

const theCount = () => region().getAllByRole("status")[0]?.textContent ?? "";

const theStatusEmptyOnArrival = () => theOneEmptyStatus(region().getAllByRole("status"));

const whatTheAlertsSay = () =>
  region()
    .getAllByRole("alert")
    .map((alert) => alert.textContent)
    .join("");

const selectionBar = () => region().queryByRole("toolbar", { name: "Selected concepts" });

const tickOf = (title: string) => region().getByRole("checkbox", { name: `Select ${title}` });

const setOwnerAction = () => {
  const bar = selectionBar();
  assert(bar !== null, "the selection bar is hidden");
  return within(bar).getByRole("button", { name: SET_OWNER });
};

const SET_OWNER_DIALOG = { name: WORDS.setOwner.action };

const asked = (procedure: string): unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);

const lastAsk = () => knowledgeAsks().at(-1);

const choosingRhian = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByRole("combobox", { name: WORDS.setOwner.newOwner }), {
    target: { value: RHIAN.personId },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: SET_OWNER }));
};

const settingTheOwnerOfTwo = async () => {
  await screen.findByRole("link", { name: "Annual leave" });
  fireEvent.click(tickOf("Annual leave"));
  fireEvent.click(tickOf("Fire drills"));
  const bar = selectionBar();
  assert(bar !== null, "ticking two concepts did not show the selection bar");
  expect(within(bar).getByRole("status").textContent).toMatch(/^2\b/u);
  fireEvent.click(setOwnerAction());
  choosingRhian(await screen.findByRole("dialog", SET_OWNER_DIALOG));
};

const refusalOf = (word: string) =>
  ({
    "role-forbids": aRefusalAnswer("role-forbids", "forbidden", 403),
    "no-such-member": aRefusalAnswer("no-such-member", "precondition", 412),
    "no-such-concept": aRefusalAnswer("no-such-concept", "absent", 404),
    malformed: aRefusalAnswer("malformed", "malformed", 400),
  })[word] ?? LOST;

describe("the All Knowledge page", () => {
  it("shows each concept's owner and who last verified it", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Annual leave" });
    expect(theCount()).toMatch(/^4\b/u);
    expect(cellOf("Annual leave", "Owner")).toBe("Ada");
    expect(cellOf("Annual leave", WORDS.columns.checked)).toContain("4 March 2026");
    expect(cellOf("Annual leave", WORDS.columns.checked)).toContain("Rhian Pryce");
    const ownOwner = cellOf("Expense claims", "Owner");
    expect(ownOwner).toContain("Rhian Pryce");
    expect(ownOwner, "a concept's own owner looks like its collection's").not.toBe("Rhian Pryce");
    expect(
      cellOf("Expense claims", WORDS.columns.checked),
      "an unverified concept shows a date",
    ).toMatch(/^\D*\S\D*$/u);
    const unowned = cellOf("Fire drills", "Owner");
    expect(unowned, "a concept with no owner shows an empty cell").toMatch(/\S/u);
    expect(unowned, "a concept with no owner names a person").not.toMatch(/Ada|Rhian/u);
    expect(cellOf("Yard lease", "Collection"), "a concept with no collection shows none").toMatch(
      /\S/u,
    );
  });

  it("sorts and filters by what the address holds", async () => {
    const router = await openAt(
      `${ALL_KNOWLEDGE}?all.sort=-title&all.kind=policy&all.collection=policy`,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Expense claims" });
    expect(lastAsk()).toEqual({
      collections: ["policy"],
      conceptType: "policy",
      sort: { column: "title", desc: true },
      page: 1,
    });
    expect(region().queryByRole("link", { name: "Fire drills" })).toBeNull();
    expect(theCount()).toMatch(/^2\b/u);
    const titles = region()
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(titles).toEqual(["Expense claims", "Annual leave"]);

    fireEvent.click(region().getByRole("button", { name: "Owner" }));

    await waitFor(() => {
      expect(router.state.location.searchStr).toContain("all.sort");
    });
    expect(router.state.location.search).toMatchObject({
      "all.sort": "owner",
      "all.kind": "policy",
    });
    await waitFor(() => {
      expect(lastAsk()?.sort).toEqual({ column: "owner", desc: false });
    });
  });

  it("offers Clear Filters when no concept matches", async () => {
    await openAt(
      `${ALL_KNOWLEDGE}?all.kind=nothing`,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    const clear = await region().findByRole("button", { name: "Clear Filters" });
    expect(region().queryAllByRole("link")).toHaveLength(0);

    fireEvent.click(clear);

    expect(await region().findByRole("link", { name: "Annual leave" })).toBeDefined();
    expect(lastAsk()).toMatchObject({ collections: [] });
    expect(lastAsk()?.conceptType).toBeUndefined();
  });

  it("shows an empty table for an empty knowledge base", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => []),
    );

    await waitFor(() => expect(theCount()).toMatch(/^0\b/u));
    const cells = within(region().getByRole("table")).getAllByRole("cell");
    expect(cells, "the empty table drew rows").toHaveLength(1);
    expect(cells[0]?.textContent, "the empty table says nothing").toMatch(/\S/u);
    expect(region().queryByRole("button", { name: "Clear Filters" })).toBeNull();
    expect(whatTheAlertsSay(), "an empty knowledge base showed as a failure").toBe("");
  });

  it("turns to the last page when the address overshoots", async () => {
    const many = Array.from({ length: 51 }, (_, index) =>
      aConceptRow(index + 1, `Concept ${String(index + 1).padStart(2, "0")}`),
    );
    const router = await openAt(
      `${ALL_KNOWLEDGE}?all.page=9`,
      anAllKnowledgeApi(() => many),
    );

    expect(await region().findByRole("link", { name: "Concept 51" })).toBeDefined();
    expect(router.state.location.search).toMatchObject({ "all.page": 2 });
    const pages = region().getByRole("navigation", { name: WORDS.pages });
    expect(within(pages).getAllByRole("status")[0]?.textContent).toMatch(/51\D+51\D+51/u);
  });
});

describe("the All Knowledge page for an Admin", () => {
  it("sets one owner on the concepts selected", async () => {
    let listed: readonly ConceptRow[] = CONCEPTS;
    const api = anAllKnowledgeApi(() => listed);
    api.set("knowledge.setOwners", () => {
      const named = new Set([THE_LEAVE.iri, THE_DRILLS.iri]);
      listed = [
        ...listed.filter((row) => !named.has(row.iri)),
        ...listed
          .filter((row) => named.has(row.iri))
          .map((row) => ({
            ...row,
            owner: { id: RHIAN.personId, name: "Rhian Pryce", own: true },
          })),
      ];
      return read({ named: 2, batchId: "batch" });
    });
    await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });
    const outcome = theStatusEmptyOnArrival();

    await settingTheOwnerOfTwo();

    await waitFor(() => {
      expect(rowOf("Fire drills").getByText("Rhian Pryce")).toBeDefined();
    });
    expect(asked("knowledge.setOwners")).toEqual([
      { iris: [THE_LEAVE.iri, THE_DRILLS.iri], personId: RHIAN.personId },
    ]);
    expect(outcome.textContent, "the outcome does not name the new owner").toContain("Rhian Pryce");
    expect(rowOf("Annual leave").queryByText("Ada")).toBeNull();
    expect(tickOf("Annual leave").getAttribute("aria-checked")).toBe("false");
    expect(tickOf("Fire drills").getAttribute("aria-checked")).toBe("false");
    expect(selectionBar(), "the selection bar stayed after the owner was set").toBeNull();
  });

  it("hands the concepts selected back to their collection's owner", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.setOwners", () => read({ named: 2, batchId: "batch" }));
    await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });
    const outcome = theStatusEmptyOnArrival();
    fireEvent.click(tickOf("Annual leave"));
    fireEvent.click(tickOf("Expense claims"));
    fireEvent.click(setOwnerAction());
    const dialog = await screen.findByRole("dialog", SET_OWNER_DIALOG);

    const returned = within(dialog).getByRole("option", { name: WORDS.setOwner.collectionsOwner });
    fireEvent.change(within(dialog).getByRole("combobox", { name: WORDS.setOwner.newOwner }), {
      target: { value: returned.getAttribute("value") },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: SET_OWNER }));

    await waitFor(() =>
      expect(asked("knowledge.setOwners")).toEqual([
        { iris: [THE_LEAVE.iri, THE_EXPENSES.iri], personId: null },
      ]),
    );
    await waitFor(() => expect(outcome.textContent).toBe(WORDS.setOwner.returned(2)));
  });

  it("selects and sets an owner by keystroke alone", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.setOwners", () => read({ named: 1, batchId: "batch" }));
    await openAt(ALL_KNOWLEDGE, api);

    const leave = await screen.findByRole("link", { name: "Annual leave" });
    const outcome = theStatusEmptyOnArrival();
    act(() => {
      leave.focus();
    });
    fireEvent.keyDown(leave, { key: KEY.tick.key });
    expect(tickOf("Annual leave").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(leave, { key: KEY.setOwner.key, shiftKey: true });

    const dialog = await screen.findByRole("dialog", SET_OWNER_DIALOG);
    expect(
      within(dialog).getByRole("button", { name: SET_OWNER }).hasAttribute("disabled"),
      "Set Owner is enabled before a person is chosen",
    ).toBe(true);
    choosingRhian(dialog);

    await waitFor(() =>
      expect(asked("knowledge.setOwners")).toEqual([
        { iris: [THE_LEAVE.iri], personId: RHIAN.personId },
      ]),
    );
    await waitFor(() => expect(outcome.textContent).toContain("Rhian Pryce"));
  });

  it("asks for a selection before it sets an owner", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Annual leave" });
    const outcome = theStatusEmptyOnArrival();
    fireEvent.keyDown(document.body, { key: KEY.setOwner.key, shiftKey: true });
    await waitFor(() =>
      expect(outcome.textContent, "Set Owner with nothing selected").toMatch(/\S/u),
    );

    fireEvent.keyDown(document.body, { key: KEY.tick.key });
    expect(outcome.textContent, "the hint cleared with nothing in focus").toMatch(/\S/u);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["role-forbids", "no-such-member", "no-such-concept", "malformed", "lost"])(
    "alerts on a %s refusal and keeps the selection",
    async (word) => {
      const api = anAllKnowledgeApi(() => CONCEPTS);
      api.set("knowledge.setOwners", () => refusalOf(word));
      await openAt(ALL_KNOWLEDGE, api);

      await settingTheOwnerOfTwo();

      await waitFor(() => {
        expect(whatTheAlertsSay(), "the refusal showed no alert").toMatch(/\S/u);
      });
      expect(
        tickOf("Annual leave").getAttribute("aria-checked"),
        "a refusal cleared the selection",
      ).toBe("true");
    },
  );
});

describe("the All Knowledge page for an owner", () => {
  it("opens on the collections an owner holds, with no selection", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy", "safety"]);
    await openAt(ALL_KNOWLEDGE, api);

    await screen.findByRole("link", { name: "Annual leave" });
    expect(lastAsk()?.collections).toEqual(["policy", "safety"]);
    expect(region().queryByRole("link", { name: "Yard lease" })).toBeNull();
    expect(region().getByRole("combobox", { name: "Filter by Collection" }).textContent).toBe(
      WORDS.filters.collection.yours,
    );
    expect(region().queryAllByRole("checkbox")).toHaveLength(0);
    expect(region().queryByRole("toolbar")).toBeNull();
    fireEvent.keyDown(document.body, { key: KEY.setOwner.key, shiftKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the one collection an owner holds in the filter", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy"]);
    await openAt(ALL_KNOWLEDGE, api);

    await screen.findByRole("link", { name: "Annual leave" });
    expect(region().getByRole("combobox", { name: "Filter by Collection" }).textContent).toBe(
      "policy",
    );
  });

  it("lets an owner clear the filter and keeps it cleared", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy"]);
    const router = await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });

    choosing(
      region().getByRole("combobox", { name: "Filter by Collection" }),
      WORDS.filters.collection.any,
    );

    expect(await region().findByRole("link", { name: "Yard lease" })).toBeDefined();
    expect(lastAsk()?.collections).toEqual([]);
    expect(router.state.location.searchStr).not.toBe("");

    await act(async () => {
      await router.invalidate();
    });
    expect(region().getByRole("link", { name: "Yard lease" })).toBeDefined();
  });

  it("checks access again once the owner owns nothing", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy"]);
    await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });

    asAnEditorOwning(api, []);
    api.set("knowledge.allKnowledge", () => aRefusalAnswer("owner-forbids", "forbidden", 403));
    fireEvent.click(region().getByRole("button", { name: "Title" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "All Knowledge" })).toBeNull();
  });

  it("shows Page Not Found to an owner who owns nothing", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, []);
    await openAt(ALL_KNOWLEDGE, api);

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(asked("knowledge.allKnowledge")).toEqual([]);
  });

  it("alerts and offers Retry when the table read is refused", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.allKnowledge", () => aRefusalAnswer("role-forbids", "forbidden", 403));
    await openAt(ALL_KNOWLEDGE, api);

    await waitFor(() =>
      expect(whatTheAlertsSay(), "the refused read showed no alert").toMatch(/\S/u),
    );
    expect(region().getByRole("button", { name: "Retry" })).toBeDefined();
    expect(region().queryByRole("table")).toBeNull();
  });
});
