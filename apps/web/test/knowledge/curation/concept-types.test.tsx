import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import {
  CONCEPT_TYPES_KEYSTROKES as KEY,
  CONCEPT_TYPES_LIST,
  CONCEPT_TYPES_PAGE,
} from "@/features/knowledge/curation/curation-state.ts";
import { CONCEPT_TYPES_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { theOneEmptyStatus } from "@test/knowledge/empty-status.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  aRefusalAnswer,
  LOST,
  NORTHERN,
  openAt,
  read,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const PAGE = CONCEPT_TYPES_PAGE.path;

const CONCEPT_TYPES = [
  {
    conceptType: "Ledger",
    count: 2,
    collections: [{ collection: "finance", count: 2 }],
  },
  {
    conceptType: "Policy",
    count: 3,
    collections: [
      { collection: "hr", count: 2 },
      { collection: null, count: 1 },
    ],
  },
  { conceptType: "Procedure", count: 1, collections: [{ collection: "ops", count: 1 }] },
  { conceptType: "Role", count: 2, collections: [{ collection: "hr", count: 2 }] },
];

const aConceptTypesApi = (conceptTypes: readonly unknown[] = CONCEPT_TYPES) => {
  const api = adaAnAdmin();
  api.set("knowledge.conceptTypes", () => read({ conceptTypes }));
  return api;
};

const region = () => within(screen.getByRole("region", { name: CONCEPT_TYPES_PAGE.name }));

const disclosures = () =>
  region()
    .getAllByRole("button")
    .filter((each) => each.hasAttribute("aria-expanded"));

const disclosureOf = (conceptType: string) =>
  region().getByRole("button", { name: new RegExp(`^${conceptType}`) });

const conceptTypesListed = (): string[] =>
  disclosures().map((each) => each.textContent.replace(WORDS.byCollection, ""));

const countOf = (conceptType: string): string | undefined => {
  const row = disclosureOf(conceptType).closest("tr");
  return row === null ? undefined : within(row).getAllByRole("cell").at(1)?.textContent;
};

const filterButton = () => region().getByRole("button", { name: WORDS.tail });

const sortHead = (name: string) => region().getByRole("button", { name });

const table = () => region().findByRole("table");

const alertHoldsWords = () =>
  waitFor(() =>
    expect(
      region()
        .getAllByRole("alert")
        .map((alert) => alert.textContent)
        .join(""),
      "the failed read showed no alert",
    ).toMatch(/\S/u),
  );

const theLoadingLine = () =>
  waitFor(() => {
    const loading = region()
      .getAllByRole("status")
      .find((status) => /\S/u.test(status.textContent));
    assert(loading !== undefined, "no status says the types are loading");
    return loading;
  });

const theStatusEmptyOnArrival = () => theOneEmptyStatus(region().getAllByRole("status"));

const searchOf = (router: Awaited<ReturnType<typeof openAt>>) => router.state.location.searchStr;

describe("the Concept Types page", () => {
  it("lists each type with its concepts, sorted by type", async () => {
    await openAt(PAGE, aConceptTypesApi());

    await table();
    expect(conceptTypesListed()).toEqual(["Ledger", "Policy", "Procedure", "Role"]);
    expect(
      ["Ledger", "Policy", "Procedure", "Role"].map(countOf),
      "a count differs from the type's",
    ).toEqual(["2", "3", "1", "2"]);
    expect(region().getByText(WORDS.count(4, 4))).toBeDefined();
    expect(
      region().getByRole("columnheader", { name: WORDS.columns.type }).getAttribute("aria-sort"),
    ).toBe("ascending");
  });

  it("holds a sort by concepts in the address", async () => {
    const router = await openAt(PAGE, aConceptTypesApi());
    await table();

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() =>
      expect(conceptTypesListed(), "equal counts left their types out of order").toEqual([
        "Procedure",
        "Ledger",
        "Role",
        "Policy",
      ]),
    );
    expect(searchOf(router)).toContain(`${CONCEPT_TYPES_LIST}.sort=count`);
    expect(region().getByRole("columnheader", { name: "Concepts" }).getAttribute("aria-sort")).toBe(
      "ascending",
    );

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() =>
      expect(conceptTypesListed()).toEqual(["Policy", "Ledger", "Role", "Procedure"]),
    );
    expect(searchOf(router)).toContain(`${CONCEPT_TYPES_LIST}.sort=-count`);

    fireEvent.click(sortHead(WORDS.columns.type));

    await waitFor(() =>
      expect(conceptTypesListed()).toEqual(["Ledger", "Policy", "Procedure", "Role"]),
    );
    expect(searchOf(router)).not.toContain(`${CONCEPT_TYPES_LIST}.sort`);
  });

  it("reads the filter and the sort from its address", async () => {
    await openAt(
      `${PAGE}?${CONCEPT_TYPES_LIST}.tail=small&${CONCEPT_TYPES_LIST}.sort=-count`,
      aConceptTypesApi(),
    );

    await table();
    expect(conceptTypesListed()).toEqual(["Ledger", "Role", "Procedure"]);
    expect(filterButton().getAttribute("aria-pressed")).toBe("true");
    expect(region().getByText(WORDS.count(3, 4))).toBeDefined();
  });

  it("shows only types with two or fewer concepts when pressed", async () => {
    const router = await openAt(PAGE, aConceptTypesApi());
    await table();
    expect(filterButton().getAttribute("aria-pressed")).toBe("false");
    expect(filterButton().querySelector("svg"), "the unpressed toggle drew a mark").toBeNull();

    fireEvent.click(filterButton());

    await waitFor(() => expect(conceptTypesListed()).toEqual(["Ledger", "Procedure", "Role"]));
    expect(filterButton().getAttribute("aria-pressed")).toBe("true");
    expect(filterButton().querySelector("svg"), "the pressed toggle drew no mark").not.toBeNull();
    expect(searchOf(router)).toContain(`${CONCEPT_TYPES_LIST}.tail=small`);
    expect(region().getByText(WORDS.count(3, 4))).toBeDefined();

    fireEvent.click(filterButton());

    await waitFor(() => expect(conceptTypesListed()).toHaveLength(4));
    expect(filterButton().getAttribute("aria-pressed")).toBe("false");
    expect(filterButton().querySelector("svg")).toBeNull();
    expect(searchOf(router)).not.toContain(`${CONCEPT_TYPES_LIST}.tail`);
  });

  it("switches the filter by its keystroke", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("true"));
    expect(conceptTypesListed()).toEqual(["Ledger", "Procedure", "Role"]);

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("false"));
    expect(conceptTypesListed()).toHaveLength(4);
  });

  it("offers Clear Filters when the filter leaves no types", async () => {
    const router = await openAt(
      PAGE,
      aConceptTypesApi([
        { conceptType: "Policy", count: 3, collections: [{ collection: "hr", count: 3 }] },
      ]),
    );
    await table();

    fireEvent.click(filterButton());

    const clear = await region().findByRole("button", { name: "Clear Filters" });
    expect(conceptTypesListed()).toEqual([]);
    expect(region().getByText(WORDS.count(0, 1))).toBeDefined();

    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(conceptTypesListed()).toEqual(["Policy"]));
    expect(searchOf(router)).not.toContain(`${CONCEPT_TYPES_LIST}.tail`);
    expect(document.activeElement).toBe(filterButton());
  });

  it("opens a type to list its counts per collection", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();
    const policy = disclosureOf("Policy");
    expect(policy.getAttribute("aria-expanded")).toBe("false");
    expect(region().queryByRole("list", { name: WORDS.collectionsOf("Policy") })).toBeNull();

    fireEvent.click(policy);

    const list = await region().findByRole("list", { name: WORDS.collectionsOf("Policy") });
    expect(policy.getAttribute("aria-expanded")).toBe("true");
    const [named, unnamed] = within(list)
      .getAllByRole("listitem")
      .map((each) => [...each.children].map((part) => part.textContent));
    expect(named, "the collections differ from the type's").toEqual([collectionNameOf("hr"), "2"]);
    expect(unnamed?.[1], "the concepts in no collection are miscounted").toBe("1");
    expect(unnamed?.[0], "the concepts in no collection have no label").toMatch(/\S/u);
    expect(unnamed?.[0], "the missing collection shows as null").not.toMatch(/null/u);
    expect(disclosureOf("Ledger").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(policy);

    await waitFor(() => expect(policy.getAttribute("aria-expanded")).toBe("false"));
    expect(region().queryByRole("list", { name: WORDS.collectionsOf("Policy") })).toBeNull();
  });

  it("keeps an opened type open through a sort", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();
    fireEvent.click(disclosureOf("Role"));
    await region().findByRole("list", { name: WORDS.collectionsOf("Role") });

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() =>
      expect(conceptTypesListed()).toEqual(["Procedure", "Ledger", "Role", "Policy"]),
    );
    expect(disclosureOf("Role").getAttribute("aria-expanded")).toBe("true");
    expect(region().getByRole("list", { name: WORDS.collectionsOf("Role") })).toBeDefined();
  });

  it("opens and closes the type in focus by its keystroke", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();
    const ledger = disclosureOf("Ledger");
    ledger.focus();

    fireEvent.keyDown(ledger, { key: KEY.open.key });

    await waitFor(() => expect(ledger.getAttribute("aria-expanded")).toBe("true"));
    expect(region().getByRole("list", { name: WORDS.collectionsOf("Ledger") })).toBeDefined();
    expect(disclosureOf("Role").getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(ledger, { key: KEY.open.key });

    await waitFor(() => expect(ledger.getAttribute("aria-expanded")).toBe("false"));
  });

  it("asks for a type first when none is in focus", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();
    const outcome = theStatusEmptyOnArrival();

    fireEvent.keyDown(document.body, { key: KEY.open.key });

    await waitFor(() =>
      expect(outcome.textContent, "the open key with no type in focus said nothing").toMatch(/\S/u),
    );
    expect(disclosures().filter((each) => each.getAttribute("aria-expanded") === "true")).toEqual(
      [],
    );
  });

  it("offers no rename, merge or editable cell", async () => {
    await openAt(PAGE, aConceptTypesApi());
    await table();

    expect(
      region()
        .getAllByRole("columnheader")
        .map((each) => each.textContent),
    ).toEqual([WORDS.columns.type, WORDS.columns.concepts]);
    for (const editable of ["textbox", "combobox", "checkbox", "menuitem", "spinbutton"]) {
      expect(region().queryAllByRole(editable), `a ${editable} stands on a read-only page`).toEqual(
        [],
      );
    }
    expect(region().queryAllByRole("button", { name: /rename|merge|delete|edit/iu })).toEqual([]);
    expect(
      region()
        .getAllByRole("button")
        .map((each) => each.textContent),
    ).toEqual([
      WORDS.tail,
      WORDS.columns.type,
      WORDS.columns.concepts,
      ...["Ledger", "Policy", "Procedure", "Role"].map(
        (conceptType) => `${conceptType}${WORDS.byCollection}`,
      ),
    ]);
  });

  it("shows no table for an empty knowledge base", async () => {
    await openAt(PAGE, aConceptTypesApi([]));

    expect(await region().findByText(WORDS.count(0, 0))).toBeDefined();
    expect(region().queryByRole("table")).toBeNull();
    expect(region().queryByRole("button", { name: WORDS.tail })).toBeNull();
    expect(
      region().queryByRole("button", { name: "Retry" }),
      "an empty list showed as a failure",
    ).toBeNull();
  });

  it("says the types are loading until the read answers", async () => {
    const api = aConceptTypesApi();
    const held = holdProcedure(api, "knowledge.conceptTypes");
    await openAt(PAGE, api);

    const loading = await theLoadingLine();
    expect(region().queryByRole("table")).toBeNull();

    held.resolve();

    expect(await table()).toBeDefined();
    expect(loading.isConnected, "the loading line stayed after the types arrived").toBe(false);
  });

  it.each(["owner-forbids", "role-forbids"])("alerts on a %s refusal of the read", async (word) => {
    const api = aConceptTypesApi();
    api.set("knowledge.conceptTypes", () => aRefusalAnswer(word, "forbidden", 403));
    await openAt(PAGE, api);

    await alertHoldsWords();
    expect(region().queryByRole("table")).toBeNull();
  });

  it("alerts on a failed read and retries it", async () => {
    const api = aConceptTypesApi();
    api.set("knowledge.conceptTypes", () => LOST);
    await openAt(PAGE, api);

    await alertHoldsWords();

    api.set("knowledge.conceptTypes", () => read({ conceptTypes: CONCEPT_TYPES }));
    fireEvent.click(region().getByRole("button", { name: "Retry" }));

    expect(await table()).toBeDefined();
  });

  it("leaves the page when its reader stops owning a collection", async () => {
    const api = aConceptTypesApi();
    const person = { id: ADA.personId, name: ADA.displayName, email: ADA.address };
    const asAnOwner = (collections: string[]) =>
      read({ workspace: NORTHERN, person, role: "Editor", owns: { collections, concepts: 0 } });
    api.set("session.member", () => asAnOwner(["policy"]));
    api.set("knowledge.conceptTypes", () => aRefusalAnswer("owner-forbids", "forbidden", 403));
    const refused = holdProcedure(api, "knowledge.conceptTypes");
    await openAt(PAGE, api);
    await theLoadingLine();

    api.set("session.member", () => asAnOwner([]));
    refused.resolve();

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: CONCEPT_TYPES_PAGE.name })).toBeNull(),
    );
  });
});
