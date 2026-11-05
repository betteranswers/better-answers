import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ALL_KNOWLEDGE_KEYSTROKES as KEY } from "@/features/knowledge/curation/curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import {
  aConceptRow,
  ALL_KNOWLEDGE,
  anAllKnowledgeApi,
  asAnEditorOwning,
  knowledgeAsks,
  RHIAN,
  type ConceptRow,
} from "@test/knowledge/all-knowledge-answers.ts";
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
  trustWords: "Reviewed by a person",
});

const THE_EXPENSES = aConceptRow(2, "Expense claims", {
  owner: { id: RHIAN.personId, name: "Rhian Pryce", own: true },
});

const THE_DRILLS = aConceptRow(3, "Fire drills", { collection: "safety" });

const THE_LEASE = aConceptRow(4, "Yard lease", { kind: "lease", collection: null });

const CONCEPTS: readonly ConceptRow[] = [THE_LEAVE, THE_EXPENSES, THE_DRILLS, THE_LEASE];

const region = () => within(screen.getByRole("region", { name: "All Knowledge" }));

const rowOf = (title: string) => {
  const row = region().getByRole("link", { name: title }).closest("tr");
  if (row === null) throw new Error(`${title} has no row`);
  return within(row);
};

const tickOf = (title: string) => region().getByRole("checkbox", { name: `Select ${title}` });

const setOwnerAction = () =>
  within(region().getByRole("toolbar", { name: WORDS.selected })).getByRole("button", {
    name: WORDS.setOwner.action,
  });

const SET_OWNER_DIALOG = (count: number) => ({ name: WORDS.setOwner.title(count) });

const asked = (procedure: string): unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);

const lastAsk = () => knowledgeAsks().at(-1);

const choosingRhian = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByRole("combobox", { name: WORDS.setOwner.newOwner }), {
    target: { value: RHIAN.personId },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: WORDS.setOwner.action }));
};

const settingTheOwnerOfTwo = async () => {
  await screen.findByRole("link", { name: "Annual leave" });
  fireEvent.click(tickOf("Annual leave"));
  fireEvent.click(tickOf("Fire drills"));
  expect(region().getByText("2 concepts selected.")).toBeDefined();
  fireEvent.click(setOwnerAction());
  choosingRhian(await screen.findByRole("dialog", SET_OWNER_DIALOG(2)));
};

const refusalOf = (word: string) =>
  ({
    "role-forbids": aRefusalAnswer("role-forbids", "forbidden", 403),
    "no-such-member": aRefusalAnswer("no-such-member", "precondition", 412),
    "no-such-concept": aRefusalAnswer("no-such-concept", "absent", 404),
    malformed: aRefusalAnswer("malformed", "malformed", 400),
  })[word] ?? LOST;

describe("the All Knowledge page", () => {
  it("names each concept's owner and last checker", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Annual leave" });
    expect(region().getByText(WORDS.count(4))).toBeDefined();
    expect(rowOf("Annual leave").getByText("Ada")).toBeDefined();
    expect(rowOf("Annual leave").getByText("4 March 2026")).toBeDefined();
    expect(rowOf("Annual leave").getByText("by Rhian Pryce")).toBeDefined();
    expect(rowOf("Expense claims").getByText("Rhian Pryce")).toBeDefined();
    expect(rowOf("Expense claims").getByText(WORDS.ownOwner)).toBeDefined();
    expect(rowOf("Expense claims").getByText(WORDS.notChecked)).toBeDefined();
    expect(rowOf("Fire drills").getByText(WORDS.unowned)).toBeDefined();
    expect(rowOf("Yard lease").getByText(WORDS.noCollection)).toBeDefined();
  });

  it("sorts and filters by what the address holds", async () => {
    const router = await openAt(
      `${ALL_KNOWLEDGE}?all.sort=-title&all.kind=policy&all.collection=policy`,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Expense claims" });
    expect(lastAsk()).toEqual({
      collections: ["policy"],
      kind: "policy",
      sort: { column: "title", desc: true },
      page: 1,
    });
    expect(region().queryByRole("link", { name: "Fire drills" })).toBeNull();
    expect(region().getByText(WORDS.matching(2))).toBeDefined();
    const titles = region()
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(titles).toEqual(["Expense claims", "Annual leave"]);

    fireEvent.click(region().getByRole("button", { name: WORDS.columns.owner }));

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

  it("says so when no concept matches, and clears the filters", async () => {
    await openAt(
      `${ALL_KNOWLEDGE}?all.kind=nothing`,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    expect(await region().findByText(WORDS.noneMatch)).toBeDefined();

    fireEvent.click(region().getByRole("button", { name: "Clear Filters" }));

    expect(await region().findByRole("link", { name: "Annual leave" })).toBeDefined();
    expect(lastAsk()).toMatchObject({ collections: [] });
    expect(lastAsk()?.kind).toBeUndefined();
  });

  it("says an empty knowledge base has no concepts yet", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => []),
    );

    expect(await region().findByText(WORDS.none)).toBeDefined();
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
    expect(region().getByText("Showing 51–51 of 51.")).toBeDefined();
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

    await settingTheOwnerOfTwo();

    expect(await region().findByText("Rhian Pryce now owns 2 concepts.")).toBeDefined();
    expect(asked("knowledge.setOwners")).toEqual([
      { iris: [THE_LEAVE.iri, THE_DRILLS.iri], personId: RHIAN.personId },
    ]);
    await waitFor(() => {
      expect(rowOf("Fire drills").getByText("Rhian Pryce")).toBeDefined();
    });
    expect(rowOf("Annual leave").queryByText("Ada")).toBeNull();
    expect(tickOf("Annual leave").getAttribute("aria-checked")).toBe("false");
    expect(tickOf("Fire drills").getAttribute("aria-checked")).toBe("false");
    expect(region().queryByText("2 concepts selected.")).toBeNull();
  });

  it("selects and sets an owner by keystroke alone", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.setOwners", () => read({ named: 1, batchId: "batch" }));
    await openAt(ALL_KNOWLEDGE, api);

    const leave = await screen.findByRole("link", { name: "Annual leave" });
    act(() => {
      leave.focus();
    });
    fireEvent.keyDown(leave, { key: KEY.tick.key });
    expect(tickOf("Annual leave").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(leave, { key: KEY.setOwner.key, shiftKey: true });

    const dialog = await screen.findByRole("dialog", SET_OWNER_DIALOG(1));
    expect(
      within(dialog).getByRole("button", { name: WORDS.setOwner.action }).hasAttribute("disabled"),
      "a person was not chosen yet",
    ).toBe(true);
    choosingRhian(dialog);

    expect(await region().findByText("Rhian Pryce now owns 1 concept.")).toBeDefined();
  });

  it("asks for a selection before it sets an owner", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    await screen.findByRole("link", { name: "Annual leave" });
    fireEvent.keyDown(document.body, { key: KEY.setOwner.key, shiftKey: true });
    expect(await region().findByText(WORDS.selectFirst)).toBeDefined();

    fireEvent.keyDown(document.body, { key: KEY.tick.key });
    expect(region().getByText(WORDS.selectFirst)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["role-forbids", "Only an Admin can set the owner of concepts."],
    ["no-such-member", WORDS.refusedOnSetOwner["no-such-member"]],
    ["no-such-concept", WORDS.refusedOnSetOwner["no-such-concept"]],
    ["malformed", WORDS.refusedOnSetOwner.malformed],
    ["lost", STOCK.tryAgain],
  ])("words the %s refusal of a Set Owner", async (word, said) => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.setOwners", () => refusalOf(word));
    await openAt(ALL_KNOWLEDGE, api);

    await settingTheOwnerOfTwo();

    await waitFor(() => {
      expect(region().getByRole("alert").textContent).toBe(said);
    });
    expect(
      tickOf("Annual leave").getAttribute("aria-checked"),
      "a refusal cleared the selection",
    ).toBe("true");
  });
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

  it("decides the page again once the owner holds nothing", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy"]);
    await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });

    asAnEditorOwning(api, []);
    api.set("knowledge.allKnowledge", () => aRefusalAnswer("owner-forbids", "forbidden", 403));
    fireEvent.click(region().getByRole("button", { name: WORDS.columns.title }));

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "All Knowledge" })).toBeNull();
  });

  it("shows an owner who holds nothing the Page Not Found", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, []);
    await openAt(ALL_KNOWLEDGE, api);

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(asked("knowledge.allKnowledge")).toEqual([]);
  });

  it("says why a read of the table is refused", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    api.set("knowledge.allKnowledge", () => aRefusalAnswer("role-forbids", "forbidden", 403));
    await openAt(ALL_KNOWLEDGE, api);

    expect(await region().findByText(WORDS.refusedOnRead["role-forbids"])).toBeDefined();
    expect(region().getByRole("button", { name: "Retry" })).toBeDefined();
  });
});
