import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { useAsking } from "@/features/console/everyone/everyone-search.tsx";
import {
  NAMES_WAITING_KEYSTROKES,
  PEOPLE_KEYSTROKES,
} from "@/features/console/people-keystrokes.ts";
import { NOT_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { openApp } from "@test/open-app.tsx";
import { addressOf, answered } from "@test/stubbed-api.ts";

const REFUSED_CODE = -32_001;

type Answer = { readonly result: { readonly data: unknown } } | { readonly error: unknown };

const NO_SESSION: Answer = {
  error: {
    message: "no-session",
    code: REFUSED_CODE,
    data: {
      code: "UNAUTHORIZED",
      httpStatus: 401,
      refusal: { word: "no-session", class: "unauthenticated" },
    },
  },
};

const FORBIDDEN: Answer = {
  error: {
    message: NOT_THE_OPERATOR,
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: NOT_THE_OPERATOR, class: "forbidden" },
    },
  },
};

const NO_SUCH_USER = "no-such-user";

const ERASED: Answer = {
  error: {
    message: NO_SUCH_USER,
    code: -32_004,
    data: {
      code: "NOT_FOUND",
      httpStatus: 404,
      refusal: { word: NO_SUCH_USER, class: "absent" },
    },
  },
};

const answering =
  (
    standing: Answer,
    held: Readonly<Record<string, unknown>> = {},
    refused: ReadonlyMap<string, Answer> = new Map(),
  ) =>
  (input: string | URL | Request) => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered(null);

    const answerTo = (name: string): Answer => {
      if (name === "session.operator") return standing;
      return (
        refused.get(name) ?? {
          result: { data: held[name] ?? (name === "person.secondFactor" ? NOTHING_HELD : []) },
        }
      );
    };
    return answered(pathname.replace("/trpc/", "").split(",").map(answerTo));
  };

const THE_OPERATOR: Answer = { result: { data: { operator: true, name: "Ada" } } };

const NOTHING_HELD = {
  mustHoldOne: false,
  operator: false,
  promoted: false,
  passkeys: [],
  authenticator: "none",
  codesAcknowledged: true,
  passkeyOfferDismissed: false,
  restoreRequired: false,
  waits: { authenticator: 0, "recovery-code": 0, "restore-code": 0 },
  thisSession: {
    confirmed: false,
    confirmedAt: null,
    setupGranted: false,
    adminOf: null,
    standing: "not-required",
  },
};

const ACME = {
  id: "01K5T0000000000000000000A1",
  name: "Acme Holdings",
  shortName: "ah-north",
  memberCount: 2,
  createdAt: "2026-03-03T09:00:00.000Z",
};

const DALES = {
  id: "01K5T0000000000000000000B2",
  name: "Dales Engineering",
  shortName: "dales",
  memberCount: 1,
  createdAt: "2026-03-04T09:00:00.000Z",
};

const flaggedBy = (workspace: { readonly id: string; readonly name: string }) => ({
  workspace: { id: workspace.id, name: workspace.name },
  raisedAt: "2026-03-05T09:00:00.000Z",
});

const NAMES_WAITING = [
  { personId: "p1", displayName: "Priya Shah", flags: [flaggedBy(ACME)] },
  { personId: "p2", displayName: "Sam Okoro", flags: [flaggedBy(DALES)] },
];

const rowsOf = (list: HTMLElement): readonly HTMLElement[] =>
  within(list)
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 0);

const textOf = (each: HTMLElement): string => each.textContent;

const inDocumentOrder = (nodes: readonly Node[]): boolean =>
  nodes.every((each, index) => {
    const before = nodes[index - 1];
    return (
      before === undefined ||
      (before.compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });

const countIn = (list: HTMLElement): HTMLElement => {
  const [count] = within(list).getAllByRole("status");
  assert(count !== undefined, "the list shows no count");
  return count;
};

const outcomeIn = (list: HTMLElement): HTMLElement => {
  const line = within(list).getByRole("alert").previousElementSibling;
  assert(line instanceof HTMLOutputElement, "the list has no outcome line");
  return line;
};

const liveRegionIn = (list: HTMLElement): HTMLElement => {
  const region = list.querySelector<HTMLElement>('[aria-live="polite"]');
  assert(region !== null, "the list has no aria-live region");
  return region;
};

const listAt = async (path: string, name: string, held: Readonly<Record<string, unknown>>) => {
  vi.stubGlobal("fetch", answering(THE_OPERATOR, held));
  await openApp(path);
  const list = await screen.findByRole("region", { name });
  await within(list).findByRole("table");
  return list;
};

const press = (key: string): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

const searchFor = (list: HTMLElement, label: string, typed: string): void => {
  fireEvent.change(within(list).getByRole("searchbox", { name: label }), {
    target: { value: typed },
  });
};

/** The query library loads every list on the page again when the network comes back. */
const reloadLists = (): void => {
  act(() => {
    globalThis.dispatchEvent(new Event("offline"));
    globalThis.dispatchEvent(new Event("online"));
  });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const linksIn = (region: HTMLElement) =>
  within(region)
    .getAllByRole("link")
    .map((each) => each.textContent);

const groupHeadingsIn = (region: HTMLElement) =>
  within(region)
    .getAllByRole("heading", { level: 3 })
    .map((each) => each.textContent);

describe("the console's shell", () => {
  it("shows the operator the console's menu groups and pages", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: true, name: "Ada" } } }));

    const { router } = await openApp("/console");
    const nav = await screen.findByRole("navigation", { name: "Console" });

    expect(router.state.location.pathname).toBe("/console/workspaces/every-workspace");
    expect(linksIn(screen.getByRole("navigation", { name: "Areas" }))).toEqual(["Console"]);
    expect(groupHeadingsIn(nav)).toEqual(["People", "Workspaces"]);
    expect(linksIn(nav)).toEqual(["Everyone", "Flagged Names", "Every Workspace"]);
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });

  it("shows Console and the operator's name without a role", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: true, name: "Ada" } } }));

    await openApp("/console/workspaces/every-workspace");
    const bar = await screen.findByRole("banner");

    expect(within(bar).getByRole("button", { name: "Console" })).toBeDefined();
    const you = within(bar).getByRole("button", { name: "Ada" });
    expect(within(you).getByText("A", { exact: true })).toBeDefined();
    expect(you.textContent).not.toMatch(/Admin|Editor|Viewer/);
    const logo = within(bar).getByRole("link", { name: "better-answers" });
    expect(logo.getAttribute("href")).toBe(HOMES.operator.path);
  });

  it("shows Access Denied to anyone but the operator", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: false } } }));

    await openApp("/console/workspaces/every-workspace");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Access Denied",
      }),
    ).toBeDefined();
    const refused = screen.getByRole("alert").textContent;
    expect(refused, "the refusal alert is empty").toMatch(/\S/);
    expect(refused, "the alert shows the api's refusal word").not.toContain(NOT_THE_OPERATOR);
    expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  });

  it("sends a signed-out person to sign in, then back", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const { router } = await openApp("/console/people/everyone");

    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fconsole%2Fpeople%2Feveryone");
  });
});

const EVERY_WORKSPACE = "/console/workspaces/every-workspace";

const EVERYONE_PAGE = "/console/people/everyone";

const NAMES_WAITING_PAGE = "/console/people/names-waiting";

const WORKSPACES_LIST = { heading: "Every Workspace", search: "Search by name or short name" };

const NAMES_WAITING_LIST = { heading: "Flagged Names", search: "Search by name or workspace" };

const EVERYONE_LIST = { heading: "Everyone", search: "Search by name or address" };

describe("the console's lists", () => {
  it("shows Every Workspace as a table below its heading", async () => {
    const list = await listAt(EVERY_WORKSPACE, WORKSPACES_LIST.heading, {
      "console.workspaces.list": [ACME, DALES],
    });

    expect(within(list).getAllByRole("columnheader").map(textOf)).toEqual([
      "Workspace",
      "Short Name",
      "Members",
      "Created",
    ]);
    const [acme] = rowsOf(list);
    assert(acme !== undefined, "no workspace is listed");
    expect(within(acme).getAllByRole("cell").slice(1).map(textOf)).toEqual([
      ACME.shortName,
      "2 members",
      "3 March 2026",
    ]);
    const pageHeading = screen.getByRole("heading", { level: 1, name: WORKSPACES_LIST.heading });
    const listHeading = within(list).getByRole("heading", {
      level: 2,
      name: WORKSPACES_LIST.heading,
    });
    expect(countIn(list).textContent).toMatch(/\b2\b/);
    expect(
      inDocumentOrder([pageHeading, listHeading, countIn(list), acme]),
      "the headings, count and rows are out of order",
    ).toBe(true);

    expect(within(list).queryByText(ACME.id)).toBeNull();
    fireEvent.click(within(acme).getByRole("button", { name: `More About ${ACME.name}` }));
    expect(within(acme).getByText(ACME.id)).toBeDefined();
  });

  it("filters Every Workspace by name or short name", async () => {
    const list = await listAt(EVERY_WORKSPACE, WORKSPACES_LIST.heading, {
      "console.workspaces.list": [ACME, DALES],
    });

    searchFor(list, WORKSPACES_LIST.search, "NORTH");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining(ACME.name)]);
    expect(countIn(list).textContent).toMatch(/\b1\b.*NORTH/);

    searchFor(list, WORKSPACES_LIST.search, "nowhere");
    expect(countIn(list).textContent).toMatch(/\b0\b.*nowhere/);
    fireEvent.click(within(list).getByRole("button", { name: "Clear Search" }));
    expect(rowsOf(list)).toHaveLength(2);
    expect(countIn(list).textContent).toMatch(/\b2\b/);
  });

  it.each([
    {
      page: WORKSPACES_LIST.heading,
      path: EVERY_WORKSPACE,
      words: WORKSPACES_LIST,
      read: "console.workspaces.list",
      rows: [ACME, DALES],
    },
    {
      page: NAMES_WAITING_LIST.heading,
      path: NAMES_WAITING_PAGE,
      words: NAMES_WAITING_LIST,
      read: "console.people.namesWaiting",
      rows: NAMES_WAITING,
    },
  ])("keeps the $page search when a reload is refused", async (listed) => {
    const { words, read } = listed;
    const list = await listAt(listed.path, words.heading, { [read]: listed.rows });
    const search = within(list).getByRole("searchbox", { name: words.search });
    search.focus();
    searchFor(list, words.search, "acme");

    vi.stubGlobal("fetch", answering(THE_OPERATOR, {}, new Map([[read, FORBIDDEN]])));
    reloadLists();

    await waitFor(() => {
      expect(within(list).queryByRole("table"), "the refused list still shows rows").toBeNull();
    });
    const said = liveRegionIn(list).textContent;
    expect(said, "the list shows no message in place of its rows").toMatch(/\S/);
    expect(said, "the list shows the api's refusal word").not.toContain(NOT_THE_OPERATOR);
    expect(within(list).getByRole("searchbox", { name: words.search })).toBe(search);
    expect(within(list).getByDisplayValue("acme")).toBe(search);
    expect(document.activeElement).toBe(search);
  });

  it("filters Flagged Names by name or flagging workspace", async () => {
    const list = await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });

    searchFor(list, NAMES_WAITING_LIST.search, "priya");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining("Priya Shah")]);

    searchFor(list, NAMES_WAITING_LIST.search, "dales");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining("Sam Okoro")]);
    expect(countIn(list).textContent).toMatch(/\b1\b.*dales/);

    searchFor(list, NAMES_WAITING_LIST.search, "nobody");
    expect(countIn(list).textContent).toMatch(/\b0\b.*nobody/);
    expect(within(list).getByRole("button", { name: "Clear Search" })).toBeDefined();
  });

  it("does not correct a focused name the search hid", async () => {
    const list = await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });
    const toCorrectPriya = "Correct Priya Shah’s Display Name";
    const pressCorrect = () => {
      fireEvent.keyDown(document.body, { key: NAMES_WAITING_KEYSTROKES.correct.key });
    };
    within(list).getByRole("button", { name: toCorrectPriya }).focus();

    searchFor(list, NAMES_WAITING_LIST.search, "sam");
    pressCorrect();
    expect(outcomeIn(list).textContent, "c with Priya hidden showed no message").toMatch(/\S/);
    expect(screen.queryByRole("dialog")).toBeNull();

    searchFor(list, NAMES_WAITING_LIST.search, "");
    pressCorrect();
    expect(
      screen.queryByRole("dialog"),
      "c opened a dialog for a name that lost focus while hidden",
    ).toBeNull();

    within(list).getByRole("button", { name: toCorrectPriya }).focus();
    pressCorrect();
    expect(await screen.findByRole("dialog", { name: toCorrectPriya })).toBeDefined();
  });

  it("asks for a person first when no row has focus", async () => {
    const list = await listAt(EVERYONE_PAGE, EVERYONE_LIST.heading, {
      "console.people.list": { people: [PRIYA], total: 1 },
    });
    expect(outcomeIn(list).textContent, "the list shows a message before any key").toBe("");
    within(list).getByRole("button", { name: PRIYA.displayName }).focus();
    screen.getByRole("button", { name: "Keyboard Shortcuts" }).focus();

    for (const { key } of [
      PEOPLE_KEYSTROKES.open,
      PEOPLE_KEYSTROKES.revoke,
      PEOPLE_KEYSTROKES.correct,
    ]) {
      press(key);
      expect(outcomeIn(list).textContent, `${key} with no row in focus showed no message`).toMatch(
        /\S/,
      );
      expect(
        screen.queryByRole("dialog"),
        `${key} opened a dialog with no row in focus`,
      ).toBeNull();
    }
  });

  it("asks for a name first when no row has focus", async () => {
    const list = await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });
    expect(outcomeIn(list).textContent, "the list shows a message before any key").toBe("");
    within(list).getByRole("button", { name: "Correct Priya Shah’s Display Name" }).focus();
    screen.getByRole("button", { name: "Keyboard Shortcuts" }).focus();

    press(NAMES_WAITING_KEYSTROKES.correct.key);

    expect(outcomeIn(list).textContent, "c with no row in focus showed no message").toMatch(/\S/);
    expect(screen.queryByRole("dialog"), "c opened a dialog with no row in focus").toBeNull();
  });

  it("titles Flagged Names with its own name, then the count", async () => {
    const list = await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });
    const pageHeading = screen.getByRole("heading", { level: 1, name: NAMES_WAITING_LIST.heading });

    expect(countIn(list).textContent).toMatch(/\b2\b/);
    expect(inDocumentOrder([pageHeading, countIn(list)])).toBe(true);
  });

  it("shows Everyone's search with its label as the placeholder", async () => {
    vi.stubGlobal(
      "fetch",
      answering(THE_OPERATOR, { "console.people.list": { people: [], total: 0 } }),
    );
    await openApp(EVERYONE_PAGE);
    const { heading, search: label } = EVERYONE_LIST;
    const list = await screen.findByRole("region", { name: heading });
    const search = await within(list).findByRole("searchbox", { name: label });

    expect(search.getAttribute("placeholder")).toBe(label);
    expect(within(list).queryByText(label)).toBeNull();
  });
});

const PRIYA = {
  id: "p1",
  displayName: "Priya Shah",
  email: "priya@example.test",
  workspaces: [],
  lastSignedInAt: null,
  credentialsRevokedAt: null,
};

const CREDENTIALS_PART = "Sessions and Assistant Access";

/** Holds the person's details back until the part has drawn its loading state. */
const sheetSaysWhenRefused = async (refusal: Answer): Promise<string> => {
  const loaded = Promise.withResolvers<void>();
  const answer = answering(
    THE_OPERATOR,
    { "console.people.list": { people: [PRIYA], total: 1 } },
    new Map([["console.people.inspect", refusal]]),
  );
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    if (addressOf(input).pathname.includes("console.people.inspect")) await loaded.promise;
    return answer(input);
  });
  await openApp(EVERYONE_PAGE);
  fireEvent.click(await screen.findByRole("button", { name: PRIYA.displayName }));
  const sheet = within(await screen.findByRole("dialog"));
  const loading = (await sheet.findByRole("region", { name: CREDENTIALS_PART })).textContent;

  loaded.resolve();
  await waitFor(() => {
    expect(sheet.getByRole("region", { name: CREDENTIALS_PART }).textContent).not.toBe(loading);
  });
  const said = within(sheet.getByRole("region", { name: CREDENTIALS_PART })).getByRole(
    "paragraph",
  ).textContent;
  cleanup();
  vi.unstubAllGlobals();
  return said;
};

describe("a person's sheet when loading their details is refused", () => {
  it("explains an erased person and a forbidden read differently", async () => {
    const erased = await sheetSaysWhenRefused(ERASED);
    const forbidden = await sheetSaysWhenRefused(FORBIDDEN);

    expect(erased, "the erased person's sheet shows no message").toMatch(/\S/);
    expect(forbidden, "the forbidden sheet shows no message").toMatch(/\S/);
    expect(erased, "both refusals show the same message").not.toBe(forbidden);
    expect(erased, "the sheet shows the api's refusal word").not.toContain(NO_SUCH_USER);
    expect(forbidden, "the sheet shows the api's refusal word").not.toContain(NOT_THE_OPERATOR);
  });
});

describe("what the Everyone search sends to the api", () => {
  it("asks for everyone at once when the search is cleared", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAsking("tom"));

    act(() => {
      result.current.type("priya");
    });
    expect(result.current.asked, "the search was sent before the typing pause ended").toEqual({
      search: "tom",
      offset: 0,
    });

    act(() => {
      result.current.type("");
    });
    expect(result.current.asked).toEqual({ search: "", offset: 0 });

    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.asked, "the cancelled search was sent after the clear").toEqual({
      search: "",
      offset: 0,
    });
  });
});
