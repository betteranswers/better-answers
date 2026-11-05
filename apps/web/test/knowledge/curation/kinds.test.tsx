import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  KINDS_KEYSTROKES as KEY,
  KINDS_LIST,
} from "@/features/knowledge/curation/curation-state.ts";
import { KINDS_WORDS as WORDS } from "@/features/knowledge/curation/curation-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack } from "@test/stubbed-api.ts";
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

const saidInAnAlert = async (words: string) => {
  const said = await region().findByText(words);
  expect(said.closest("[role=alert]"), `"${words}" was drawn outside an alert`).not.toBeNull();
};

const searchOf = (router: Awaited<ReturnType<typeof openAt>>) => router.state.location.searchStr;

describe("the Kinds page", () => {
  it("lists each kind with its concepts, sorted by kind", async () => {
    await openAt(PAGE, aKindsApi());

    await screen.findByRole("table", { name: WORDS.caption });
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
    await screen.findByRole("table", { name: WORDS.caption });

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

    await screen.findByRole("table", { name: WORDS.caption });
    expect(kindsListed()).toEqual(["Ledger", "Role", "Procedure"]);
    expect(filterButton().getAttribute("aria-pressed")).toBe("true");
    expect(region().getByText("3 of 4 kinds")).toBeDefined();
  });

  it("shows only kinds with two or fewer concepts when pressed", async () => {
    const router = await openAt(PAGE, aKindsApi());
    await screen.findByRole("table", { name: WORDS.caption });
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
    await screen.findByRole("table", { name: WORDS.caption });

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("true"));
    expect(kindsListed()).toEqual(["Ledger", "Procedure", "Role"]);

    fireEvent.keyDown(document.body, { key: KEY.tail.key });

    await waitFor(() => expect(filterButton().getAttribute("aria-pressed")).toBe("false"));
    expect(kindsListed()).toHaveLength(4);
  });

  it("words an empty filter and clears it", async () => {
    const router = await openAt(
      PAGE,
      aKindsApi([{ kind: "Policy", count: 3, collections: [{ collection: "hr", count: 3 }] }]),
    );
    await screen.findByRole("table", { name: WORDS.caption });

    fireEvent.click(filterButton());

    expect(await region().findByText(WORDS.noneSmall)).toBeDefined();
    expect(kindsListed()).toEqual([]);
    expect(region().getByText("0 of 1 kind")).toBeDefined();

    const clear = region().getByRole("button", { name: "Clear Filters" });
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => expect(kindsListed()).toEqual(["Policy"]));
    expect(searchOf(router)).not.toContain(`${KINDS_LIST}.tail`);
    expect(document.activeElement).toBe(filterButton());
  });

  it("opens a kind to list its counts per collection", async () => {
    await openAt(PAGE, aKindsApi());
    await screen.findByRole("table", { name: WORDS.caption });
    const policy = disclosureOf("Policy");
    expect(policy.getAttribute("aria-expanded")).toBe("false");
    expect(region().queryByRole("list", { name: WORDS.collectionsOf("Policy") })).toBeNull();

    fireEvent.click(policy);

    const list = await region().findByRole("list", { name: WORDS.collectionsOf("Policy") });
    expect(policy.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((each) => [...each.children].map((part) => part.textContent)),
      "the collections differ from the kind's, or the unnamed one has no plain word",
    ).toEqual([
      ["hr", "2"],
      [WORDS.noCollection, "1"],
    ]);
    expect(disclosureOf("Ledger").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(policy);

    await waitFor(() => expect(policy.getAttribute("aria-expanded")).toBe("false"));
    expect(region().queryByRole("list", { name: WORDS.collectionsOf("Policy") })).toBeNull();
  });

  it("keeps an opened kind open through a sort", async () => {
    await openAt(PAGE, aKindsApi());
    await screen.findByRole("table", { name: WORDS.caption });
    fireEvent.click(disclosureOf("Role"));
    await region().findByRole("list", { name: WORDS.collectionsOf("Role") });

    fireEvent.click(sortHead("Concepts"));

    await waitFor(() => expect(kindsListed()).toEqual(["Procedure", "Ledger", "Role", "Policy"]));
    expect(disclosureOf("Role").getAttribute("aria-expanded")).toBe("true");
    expect(region().getByRole("list", { name: WORDS.collectionsOf("Role") })).toBeDefined();
  });

  it("opens and closes the kind in focus by its keystroke", async () => {
    await openAt(PAGE, aKindsApi());
    await screen.findByRole("table", { name: WORDS.caption });
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
    await screen.findByRole("table", { name: WORDS.caption });

    fireEvent.keyDown(document.body, { key: KEY.open.key });

    expect(await region().findByText(WORDS.selectFirst)).toBeDefined();
    expect(disclosures().filter((each) => each.getAttribute("aria-expanded") === "true")).toEqual(
      [],
    );
  });

  it("reads without a rename, a merge or an editable cell", async () => {
    await openAt(PAGE, aKindsApi());
    await screen.findByRole("table", { name: WORDS.caption });

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

  it("words an empty knowledge base", async () => {
    await openAt(PAGE, aKindsApi([]));

    expect(await region().findByText(WORDS.none)).toBeDefined();
    expect(region().queryByRole("table")).toBeNull();
    expect(region().queryByRole("button", { name: WORDS.tail })).toBeNull();
    expect(region().getByText("0 kinds")).toBeDefined();
  });

  it("says the kinds are loading until the read answers", async () => {
    const api = aKindsApi();
    const held = heldBack(api, "knowledge.kinds");
    await openAt(PAGE, api);

    expect(await region().findByText(WORDS.loading)).toBeDefined();
    expect(region().queryByRole("table")).toBeNull();

    held.resolve();

    expect(await region().findByRole("table", { name: WORDS.caption })).toBeDefined();
    expect(region().queryByText(WORDS.loading)).toBeNull();
  });

  it.each([
    ["owner-forbids", WORDS.refusals["owner-forbids"]],
    ["role-forbids", WORDS.refusals["role-forbids"]],
  ])("words the %s refusal of the read", async (word, sentence) => {
    const api = aKindsApi();
    api.set("knowledge.kinds", () => aRefusalAnswer(word, "forbidden", 403));
    await openAt(PAGE, api);

    await saidInAnAlert(sentence);
    expect(region().queryByRole("table")).toBeNull();
  });

  it("words a failed read and retries it", async () => {
    const api = aKindsApi();
    api.set("knowledge.kinds", () => LOST);
    await openAt(PAGE, api);

    await saidInAnAlert(STOCK.notLoaded);

    api.set("knowledge.kinds", () => read({ kinds: KINDS }));
    fireEvent.click(region().getByRole("button", { name: "Retry" }));

    expect(await region().findByRole("table", { name: WORDS.caption })).toBeDefined();
  });

  it("leaves the page when its reader stops owning a collection", async () => {
    const api = aKindsApi();
    const person = { id: ADA.personId, name: ADA.displayName, email: ADA.address };
    const asAnOwner = (collections: string[]) =>
      read({ workspace: NORTHERN, person, role: "Editor", owns: { collections, concepts: 0 } });
    api.set("session.member", () => asAnOwner(["policy"]));
    api.set("knowledge.kinds", () => aRefusalAnswer("owner-forbids", "forbidden", 403));
    const refused = heldBack(api, "knowledge.kinds");
    await openAt(PAGE, api);
    await region().findByText(WORDS.loading);

    api.set("session.member", () => asAnOwner([]));
    refused.resolve();

    await waitFor(() => expect(screen.queryByRole("region", { name: "Kinds" })).toBeNull());
  });
});
