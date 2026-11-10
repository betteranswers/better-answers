import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import { UNKNOWN_PAGE } from "@/app/words.ts";
import { ALL_KNOWLEDGE_KEYSTROKES as KEY } from "@/features/knowledge/curation/curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { CONCEPT_WORDS, EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";
import { KNOWLEDGE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { CLEAR_WORDS, filterBy } from "@/shared/words.ts";
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

const FILTER_BY_COLLECTION = filterBy(WORDS.filters.collection.label);

const FILTER_BY_TRUST = filterBy(WORDS.filters.trust.label);

const region = () =>
  within(
    screen.getByRole("region", {
      name: pageById(menuGroupIn(KNOWLEDGE, "curation"), "all-knowledge").name,
    }),
  );

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
    expect(cellOf("Annual leave", WORDS.columns.trust)).toContain("4 March 2026");
    expect(cellOf("Annual leave", WORDS.columns.trust)).toContain("Rhian Pryce");
    const ownOwner = cellOf("Expense claims", "Owner");
    expect(ownOwner).toContain("Rhian Pryce");
    expect(ownOwner, "a concept's own owner looks like its collection's").not.toBe("Rhian Pryce");
    expect(
      cellOf("Expense claims", WORDS.columns.trust),
      "an unverified concept shows a date",
    ).toMatch(/^\D*\S\D*$/u);
    const unowned = cellOf("Fire drills", "Owner");
    expect(unowned, "a concept with no owner shows its empty word").toBe(EMPTY_WORDS.owner);
    expect(
      cellOf("Yard lease", "Collection"),
      "a concept with no collection shows its empty word",
    ).toBe(EMPTY_WORDS.collection);
  });

  it("sorts and filters by what the address holds", async () => {
    const router = await openAt(
      `${ALL_KNOWLEDGE}?all.sort=-title&all.type=policy&all.collection=policy`,
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
      "all.type": "policy",
    });
    await waitFor(() => {
      expect(lastAsk()?.sort).toEqual({ column: "owner", desc: false });
    });
  });

  it("sorts by type from the Type column's header", async () => {
    const router = await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => CONCEPTS),
    );
    await screen.findByRole("link", { name: "Expense claims" });

    fireEvent.click(region().getByRole("button", { name: "Type" }));

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ "all.sort": "type" });
    });
    await waitFor(() => {
      expect(lastAsk()?.sort).toEqual({ column: "type", desc: false });
    });
  });

  it("offers Clear Filters when no concept matches", async () => {
    await openAt(
      `${ALL_KNOWLEDGE}?all.type=nothing`,
      anAllKnowledgeApi(() => CONCEPTS),
    );

    const clear = await region().findByRole("button", { name: CLEAR_WORDS.filters });
    expect(region().queryAllByRole("link")).toHaveLength(0);
    expect(region().getByText(WORDS.noneMatch)).toBeDefined();
    expect(region().queryByText(WORDS.matching(0)), "no match also counts 0").toBeNull();

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
    expect(region().queryByRole("button", { name: CLEAR_WORDS.filters })).toBeNull();
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

const THE_OUT_OF_DATE = aConceptRow(5, "Yard rota", {
  trust: { tier: "human-reviewed", status: "out-of-date" },
  trustWords: "Out of date",
  checkedBy: "Rhian Pryce",
  checkedOn: "1 July 2025",
});

const THE_CHANGED = aConceptRow(6, "Rate card", {
  trust: { tier: "human-reviewed", status: "changed-since-checked" },
  trustWords: "Changed since verified",
  checkedBy: "Rhian Pryce",
  checkedOn: "2 June 2026",
});

const THE_DEPRECATED = aConceptRow(7, "Old tariff", {
  trust: { tier: "unverified", status: "deprecated" },
  trustWords: "Deprecated",
});

const THE_MACHINE_CHECKED = aConceptRow(8, "Gate codes", {
  trust: { tier: "machine-confirmed", status: "current" },
  trustWords: "Verified automatically",
  checkedOn: "9 May 2026",
});

const WORKLIST: readonly ConceptRow[] = [
  THE_LEAVE,
  THE_EXPENSES,
  THE_OUT_OF_DATE,
  THE_CHANGED,
  THE_DEPRECATED,
  THE_MACHINE_CHECKED,
];

const worklistOpened = async () => {
  await openAt(
    ALL_KNOWLEDGE,
    anAllKnowledgeApi(() => WORKLIST),
  );
  await screen.findByRole("link", { name: "Annual leave" });
};

const headsListed = () =>
  region()
    .getAllByRole("columnheader")
    .map((head) => head.textContent);

const titlesListed = () =>
  region()
    .getAllByRole("link")
    .map((link) => link.textContent);

describe("the All Knowledge page as a worklist", () => {
  it.each([
    ["unverified", ["Expense claims"]],
    ["out-of-date", ["Yard rota"]],
    ["changed-since-checked", ["Rate card"]],
    ["deprecated", ["Old tariff"]],
  ] as const)("lists only the %s concepts", async (trust, titles) => {
    const router = await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => WORKLIST),
    );
    await screen.findByRole("link", { name: "Annual leave" });

    choosing(
      region().getByRole("combobox", { name: FILTER_BY_TRUST }),
      WORDS.filters.trust.choices[trust],
    );

    await waitFor(() => {
      expect(titlesListed()).toEqual(titles);
    });
    expect(lastAsk()?.trust).toBe(trust);
    expect(router.state.location.search).toMatchObject({ "all.trust": trust });
    expect(theCount()).toMatch(/^1 matching\b/u);
  });

  it("offers the four trust words the worklist filters by", async () => {
    await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => WORKLIST),
    );
    await screen.findByRole("link", { name: "Annual leave" });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      value: () => undefined,
      configurable: true,
    });

    fireEvent.keyDown(region().getByRole("combobox", { name: FILTER_BY_TRUST }), { key: "Enter" });

    const offered = (await screen.findAllByRole("option")).map((option) => option.textContent);
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    expect(offered).toEqual([
      WORDS.filters.trust.any,
      ...Object.values(WORDS.filters.trust.choices),
    ]);
  });

  it("holds the trust filter in the address and clears it", async () => {
    await openAt(
      `${ALL_KNOWLEDGE}?all.trust=out-of-date`,
      anAllKnowledgeApi(() => WORKLIST),
    );

    await screen.findByRole("link", { name: "Yard rota" });
    expect(region().getByRole("combobox", { name: FILTER_BY_TRUST }).textContent).toBe(
      WORDS.filters.trust.choices["out-of-date"],
    );

    choosing(region().getByRole("combobox", { name: FILTER_BY_TRUST }), WORDS.filters.trust.any);

    await waitFor(() => {
      expect(titlesListed()).toHaveLength(WORKLIST.length);
    });
    expect(lastAsk()?.trust).toBeUndefined();
  });

  it("offers Clear Filters when no concept shows the trust word", async () => {
    await openAt(
      `${ALL_KNOWLEDGE}?all.trust=deprecated`,
      anAllKnowledgeApi(() => [THE_LEAVE]),
    );

    fireEvent.click(await region().findByRole("button", { name: CLEAR_WORDS.filters }));

    expect(await region().findByRole("link", { name: "Annual leave" })).toBeDefined();
    expect(lastAsk()?.trust).toBeUndefined();
  });

  it("sorts by verification date from the Trust header", async () => {
    const router = await openAt(
      ALL_KNOWLEDGE,
      anAllKnowledgeApi(() => WORKLIST),
    );
    await screen.findByRole("link", { name: "Annual leave" });

    fireEvent.click(region().getByRole("button", { name: WORDS.columns.trust }));

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ "all.sort": "trust" });
    });
    await waitFor(() => {
      expect(lastAsk()?.sort).toEqual({ column: "trust", desc: false });
    });
    fireEvent.click(region().getByRole("button", { name: WORDS.columns.trust }));
    await waitFor(() => {
      expect(lastAsk()?.sort).toEqual({ column: "trust", desc: true });
    });
  });

  it("shows each concept's trust and date in one Trust column", async () => {
    await worklistOpened();

    const heads = headsListed();
    expect(heads.filter((head) => head.startsWith(WORDS.columns.trust))).toHaveLength(1);
    expect(heads.some((head) => head.includes(CONCEPT_WORDS.titleBlock.checkedBy))).toBe(false);
    expect(cellOf("Yard rota", WORDS.columns.trust)).toContain(THE_OUT_OF_DATE.trustWords);
    expect(cellOf("Yard rota", WORDS.columns.trust)).toContain("1 July 2025");
    expect(cellOf("Gate codes", WORDS.columns.trust)).toContain("9 May 2026");
    expect(cellOf("Old tariff", WORDS.columns.trust)).not.toMatch(/\d{4}/u);
    expect(
      cellOf("Annual leave", WORDS.columns.trust).match(/4 March 2026/gu),
      "the date showed twice beside a person's verification",
    ).toHaveLength(1);
  });

  it("keeps the Trust column on a narrow screen", async () => {
    document.documentElement.style.setProperty("--shell-wide", "0");
    await worklistOpened();

    const heads = headsListed();

    document.documentElement.style.removeProperty("--shell-wide");
    expect(heads.some((head) => head.startsWith(WORDS.columns.trust))).toBe(true);
    expect(heads.some((head) => head.startsWith(WORDS.columns.owner))).toBe(false);
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
    expect(region().getByRole("combobox", { name: FILTER_BY_COLLECTION }).textContent).toBe(
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
    expect(region().getByRole("combobox", { name: FILTER_BY_COLLECTION }).textContent).toBe(
      collectionNameOf("policy"),
    );
  });

  it("lets an owner clear the filter and keeps it cleared", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, ["policy"]);
    const router = await openAt(ALL_KNOWLEDGE, api);
    await screen.findByRole("link", { name: "Annual leave" });

    choosing(
      region().getByRole("combobox", { name: FILTER_BY_COLLECTION }),
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

    expect(
      await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
    ).toBeDefined();
    expect(
      screen.queryByRole("region", {
        name: pageById(menuGroupIn(KNOWLEDGE, "curation"), "all-knowledge").name,
      }),
    ).toBeNull();
  });

  it("shows Page Not Found to an owner who owns nothing", async () => {
    const api = anAllKnowledgeApi(() => CONCEPTS);
    asAnEditorOwning(api, []);
    await openAt(ALL_KNOWLEDGE, api);

    expect(
      await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.heading }),
    ).toBeDefined();
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
