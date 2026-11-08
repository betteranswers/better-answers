import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { assert, describe, expect, it, vi } from "vitest";

import {
  KINDS_KEYSTROKES as KEY,
  KINDS_LIST,
} from "@/features/knowledge/curation/curation-state.ts";
import { KINDS_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
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

const PAGE = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Kinds").path;

const KINDS = [
  {
    kind: "Ledger",
    count: 2,
    collections: [{ collection: "finance", count: 2 }],
  },
  {
    kind: "Policy",
    count: 3,
    collections: [
      { collection: "hr", count: 2 },
      { collection: null, count: 1 },
    ],
  },
  { kind: "Procedure", count: 1, collections: [{ collection: "ops", count: 1 }] },
  { kind: "Role", count: 2, collections: [{ collection: "hr", count: 2 }] },
];

const aKindsApi = (kinds: readonly unknown[] = KINDS) => {
  const api = adaAnAdmin();
  api.set("knowledge.kinds", () => read({ kinds }));
  return api;
};

const region = () => within(screen.getByRole("region", { name: "Kinds" }));

const disclosures = () =>
  region()
    .getAllByRole("button")
    .filter((each) => each.hasAttribute("aria-expanded"));

const disclosureOf = (kind: string) =>
  region().getByRole("button", { name: new RegExp(`^${kind}`) });

const kindsListed = (): string[] =>
  disclosures().map((each) => each.textContent.replace(WORDS.byCollection, ""));

const countOf = (kind: string): string | undefined => {
  const row = disclosureOf(kind).closest("tr");
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
    assert(loading !== undefined, "no status says the kinds are loading");
    return loading;
  });

const theStatusEmptyOnArrival = () => theOneEmptyStatus(region().getAllByRole("status"));

const searchOf = (router: Awaited<ReturnType<typeof openAt>>) => router.state.location.searchStr;

describe("the Kinds page", () => {
  it("lists each kind with its concepts, sorted by kind", async () => {
    await openAt(PAGE, aKindsApi());

    await table();
    expect(kindsListed()).toEqual(["Ledger", "Policy", "Procedure", "Role"]);
    expect(
      ["Ledger", "Policy", "Procedure", "Role"].map(countOf),
      "a count differs from the kind's",
    ).toEqual(["2", "3", "1", "2"]);
    expect(region().getByText("4 kinds")).toBeDefined();
    expect(region().getByRole("columnheader", { name: "Kind" }).getAttribute("aria-sort")).toBe(
      "ascending",
    );
  });

  it("holds a sort by concepts in the address", async () => {
    const router = await openAt(PAGE, aKindsApi());
    await table();

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() =>
      expect(kindsListed(), "equal counts left their kinds out of order").toEqual([
        "Procedure",
        "Ledger",
        "Role",
        "Policy",
      ]),
    );
    expect(searchOf(router)).toContain(`${KINDS_LIST}.sort=count`);
    expect(region().getByRole("columnheader", { name: "Concepts" }).getAttribute("aria-sort")).toBe(
      "ascending",
    );

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() => expect(kindsListed()).toEqual(["Policy", "Ledger", "Role", "Procedure"]));
    expect(searchOf(router)).toContain(`${KINDS_LIST}.sort=-count`);

    fireEvent.click(sortHead("Kind"));

    await waitFor(() => expect(kindsListed()).toEqual(["Ledger", "Policy", "Procedure", "Role"]));
    expect(searchOf(router)).not.toContain(`${KINDS_LIST}.sort`);
  });

  it("reads the filter and the sort from its address", async () => {
    await openAt(`${PAGE}?${KINDS_LIST}.tail=small&${KINDS_LIST}.sort=-count`, aKindsApi());

    await table();
    expect(kindsListed()).toEqual(["Ledger", "Role", "Procedure"]);
    expect(filterButton().getAttribute("aria-pressed")).toBe("true");
    expect(region().getByText("3 of 4 kinds")).toBeDefined();
  });

  it("shows only kinds with two or fewer concepts when pressed", async () => {
    const router = await openAt(PAGE, aKindsApi());
    await table();
    expect(filterButton().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(filterButton());

    await waitFor(() => expect(kindsListed()).toEqual(["Ledger", "Procedure", "Role"]));
    expect(filterButton().getAttribute("aria-pressed")).toBe("true");
    expect(searchOf(router)).toContain(`${KINDS_LIST}.tail=small`);
    expect(region().getByText("3 of 4 kinds")).toBeDefined();

    fireEvent.click(filterButton());

    await waitFor(() => expect(kindsListed()).toHaveLength(4));
    expect(filterButton().getAttribute("aria-pressed")).toBe("false");
    expect(searchOf(router)).not.toContain(`${KINDS_LIST}.tail`);
  });

  it("switches the filter by its keystroke", async () => {
    await openAt(PAGE, aKindsApi());
    await table();

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("true"));
    expect(kindsListed()).toEqual(["Ledger", "Procedure", "Role"]);

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("false"));
    expect(kindsListed()).toHaveLength(4);
  });

  it("offers Clear Filters when the filter leaves no kinds", async () => {
    const router = await openAt(
      PAGE,
      aKindsApi([{ kind: "Policy", count: 3, collections: [{ collection: "hr", count: 3 }] }]),
    );
    await table();

    fireEvent.click(filterButton());

    const clear = await region().findByRole("button", { name: "Clear Filters" });
    expect(kindsListed()).toEqual([]);
    expect(region().getByText("0 of 1 kind")).toBeDefined();

    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(kindsListed()).toEqual(["Policy"]));
    expect(searchOf(router)).not.toContain(`${KINDS_LIST}.tail`);
    expect(document.activeElement).toBe(filterButton());
  });

  it("opens a kind to list its counts per collection", async () => {
    await openAt(PAGE, aKindsApi());
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
    expect(named, "the collections differ from the kind's").toEqual(["hr", "2"]);
    expect(unnamed?.[1], "the concepts in no collection are miscounted").toBe("1");
    expect(unnamed?.[0], "the concepts in no collection have no label").toMatch(/\S/u);
    expect(unnamed?.[0], "the missing collection shows as null").not.toMatch(/null/u);
    expect(disclosureOf("Ledger").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(policy);

    await waitFor(() => expect(policy.getAttribute("aria-expanded")).toBe("false"));
    expect(region().queryByRole("list", { name: WORDS.collectionsOf("Policy") })).toBeNull();
  });

  it("keeps an opened kind open through a sort", async () => {
    await openAt(PAGE, aKindsApi());
    await table();
    fireEvent.click(disclosureOf("Role"));
    await region().findByRole("list", { name: WORDS.collectionsOf("Role") });

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() => expect(kindsListed()).toEqual(["Procedure", "Ledger", "Role", "Policy"]));
    expect(disclosureOf("Role").getAttribute("aria-expanded")).toBe("true");
    expect(region().getByRole("list", { name: WORDS.collectionsOf("Role") })).toBeDefined();
  });

  it("opens and closes the kind in focus by its keystroke", async () => {
    await openAt(PAGE, aKindsApi());
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

  it("asks for a kind first when none is in focus", async () => {
    await openAt(PAGE, aKindsApi());
    await table();
    const outcome = theStatusEmptyOnArrival();

    fireEvent.keyDown(document.body, { key: KEY.open.key });

    await waitFor(() =>
      expect(outcome.textContent, "the open key with no kind in focus said nothing").toMatch(/\S/u),
    );
    expect(disclosures().filter((each) => each.getAttribute("aria-expanded") === "true")).toEqual(
      [],
    );
  });

  it("offers no rename, merge or editable cell", async () => {
    await openAt(PAGE, aKindsApi());
    await table();

    expect(
      region()
        .getAllByRole("columnheader")
        .map((each) => each.textContent),
    ).toEqual(["Kind", "Concepts"]);
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
      "Kind",
      "Concepts",
      ...["Ledger", "Policy", "Procedure", "Role"].map((kind) => `${kind}${WORDS.byCollection}`),
    ]);
  });

  it("shows no table for an empty knowledge base", async () => {
    await openAt(PAGE, aKindsApi([]));

    expect(await region().findByText("0 kinds")).toBeDefined();
    expect(region().queryByRole("table")).toBeNull();
    expect(region().queryByRole("button", { name: WORDS.tail })).toBeNull();
    expect(
      region().queryByRole("button", { name: "Retry" }),
      "an empty list showed as a failure",
    ).toBeNull();
  });

  it("says the kinds are loading until the read answers", async () => {
    const api = aKindsApi();
    const held = holdProcedure(api, "knowledge.kinds");
    await openAt(PAGE, api);

    const loading = await theLoadingLine();
    expect(region().queryByRole("table")).toBeNull();

    held.resolve();

    expect(await table()).toBeDefined();
    expect(loading.isConnected, "the loading line stayed after the kinds arrived").toBe(false);
  });

  it.each(["owner-forbids", "role-forbids"])("alerts on a %s refusal of the read", async (word) => {
    const api = aKindsApi();
    api.set("knowledge.kinds", () => aRefusalAnswer(word, "forbidden", 403));
    await openAt(PAGE, api);

    await alertHoldsWords();
    expect(region().queryByRole("table")).toBeNull();
  });

  it("alerts on a failed read and retries it", async () => {
    const api = aKindsApi();
    api.set("knowledge.kinds", () => LOST);
    await openAt(PAGE, api);

    await alertHoldsWords();

    api.set("knowledge.kinds", () => read({ kinds: KINDS }));
    fireEvent.click(region().getByRole("button", { name: "Retry" }));

    expect(await table()).toBeDefined();
  });

  it("leaves the page when its reader stops owning a collection", async () => {
    const api = aKindsApi();
    const person = { id: ADA.personId, name: ADA.displayName, email: ADA.address };
    const asAnOwner = (collections: string[]) =>
      read({ workspace: NORTHERN, person, role: "Editor", owns: { collections, concepts: 0 } });
    api.set("session.member", () => asAnOwner(["policy"]));
    api.set("knowledge.kinds", () => aRefusalAnswer("owner-forbids", "forbidden", 403));
    const refused = holdProcedure(api, "knowledge.kinds");
    await openAt(PAGE, api);
    await theLoadingLine();

    api.set("session.member", () => asAnOwner([]));
    refused.resolve();

    await waitFor(() => expect(screen.queryByRole("region", { name: "Kinds" })).toBeNull());
  });
});
