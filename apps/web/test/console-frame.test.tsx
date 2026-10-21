import { act, cleanup, fireEvent, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAsking } from "@/features/console/everyone-search.tsx";
import {
  EVERYONE_WORDS,
  NAMES_WAITING_WORDS,
  WORKSPACES_WORDS,
} from "@/features/console/list-words.ts";
import {
  NAMES_WAITING_KEYSTROKES,
  SELECT_A_NAME_FIRST,
} from "@/features/console/people-keystrokes.ts";
import { NOT_THE_OPERATOR } from "@/features/console/refusal-words.ts";
import { CONSOLE, HOMES, menuGroupIn } from "@/shared/navigation.ts";
import { STOCK } from "@/shared/refusal-words.ts";

import { openApp } from "./open-app.tsx";
import { addressOf, answered } from "./stubbed-api.ts";

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

const WITHOUT_THE_MARK: Answer = {
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

const SINCE_ERASED: Answer = {
  error: {
    message: "no-such-user",
    code: -32_004,
    data: {
      code: "NOT_FOUND",
      httpStatus: 404,
      refusal: { word: "no-such-user", class: "absent" },
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

const readsInOrder = (page: HTMLElement, words: readonly string[]): boolean => {
  let from = 0;
  for (const each of words) {
    const at = page.textContent.indexOf(each, from);
    if (at === -1) return false;
    from = at + each.length;
  }
  return true;
};

const listAt = async (path: string, name: string, held: Readonly<Record<string, unknown>>) => {
  vi.stubGlobal("fetch", answering(THE_OPERATOR, held));
  await openApp(path);
  const list = await screen.findByRole("region", { name });
  await within(list).findByRole("table");
  return list;
};

const searchFor = (list: HTMLElement, label: string, typed: string): void => {
  fireEvent.change(within(list).getByRole("searchbox", { name: label }), {
    target: { value: typed },
  });
};

/** The query library reads every list on the page again as the network comes back. */
const readAgainInPlace = (): void => {
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

describe("the console's shell", () => {
  it("draws the console's area, groups and pages for the operator", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: true, name: "Ada" } } }));

    const { router } = await openApp("/console");
    const nav = await screen.findByRole("navigation", { name: "Console" });
    const namesIn = (region: HTMLElement, role: "link" | "heading") =>
      within(region)
        .getAllByRole(role, role === "heading" ? { level: 3 } : {})
        .map((each) => each.textContent);

    expect(router.state.location.pathname).toBe("/console/workspaces/every-workspace");
    expect(namesIn(screen.getByRole("navigation", { name: "Areas" }), "link")).toEqual(["Console"]);
    expect(namesIn(nav, "heading")).toEqual(["People", "Workspaces"]);
    expect(namesIn(nav, "link")).toEqual(["Everyone", "Names Waiting", "Every Workspace"]);
    expect(screen.queryByRole("navigation", { name: "Control Centre" })).toBeNull();
  });

  it("reads Console and the person's name, with no role", async () => {
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

  it("shows a person without the mark the refused state alone", async () => {
    vi.stubGlobal("fetch", answering({ result: { data: { operator: false } } }));

    await openApp("/console/workspaces/every-workspace");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Access Denied",
      }),
    ).toBeDefined();
    const refused = screen.getByRole("alert").textContent;
    expect(refused).toBe(STOCK.permission);
    expect(refused).not.toContain(NOT_THE_OPERATOR);
    expect(screen.queryByRole("navigation", { name: "Console" })).toBeNull();
  });

  it("sends a sessionless person to sign in, then back", async () => {
    vi.stubGlobal("fetch", answering(NO_SESSION));

    const { router } = await openApp("/console/people/everyone");

    expect(router.state.location.href).toBe("/sign-in?redirect=%2Fconsole%2Fpeople%2Feveryone");
  });
});

const EVERY_WORKSPACE = "/console/workspaces/every-workspace";

const NAMES_WAITING_PAGE = "/console/people/names-waiting";

const WORKSPACES_LIST = { heading: "Every Workspace", search: "Search by name or short name" };

const NAMES_WAITING_LIST = { heading: "Names Waiting", search: "Search by name or workspace" };

describe("the console's lists", () => {
  it("opens Every workspace as a table under its head", async () => {
    const workspaces = menuGroupIn(CONSOLE, "workspaces");
    const list = await listAt(EVERY_WORKSPACE, WORKSPACES_LIST.heading, {
      "console.workspaces.list": [ACME, DALES],
    });

    expect(within(list).getAllByRole("columnheader").map(textOf)).toEqual([
      "Workspace",
      "Short Name",
      "Members",
      "Provisioned",
    ]);
    const [acme] = rowsOf(list);
    if (acme === undefined) throw new Error("no workspace is listed");
    expect(within(acme).getAllByRole("cell").slice(1).map(textOf)).toEqual([
      ACME.shortName,
      "2 members",
      "3 March 2026",
    ]);
    expect(
      readsInOrder(screen.getByRole("main"), [
        "Workspaces",
        workspaces.summary,
        WORKSPACES_LIST.heading,
        WORKSPACES_WORDS.description,
        WORKSPACES_WORDS.counted(2),
        ACME.name,
      ]),
    ).toBe(true);

    expect(within(list).queryByText(ACME.id)).toBeNull();
    fireEvent.click(within(acme).getByRole("button", { name: `More About ${ACME.name}` }));
    expect(within(acme).getByText(ACME.id)).toBeDefined();
  });

  it("narrows Every workspace by name or short name", async () => {
    const list = await listAt(EVERY_WORKSPACE, WORKSPACES_LIST.heading, {
      "console.workspaces.list": [ACME, DALES],
    });

    searchFor(list, WORKSPACES_LIST.search, "NORTH");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining(ACME.name)]);
    expect(within(list).getByText(WORKSPACES_WORDS.matching(1, "NORTH"))).toBeDefined();

    searchFor(list, WORKSPACES_LIST.search, "nowhere");
    expect(within(list).getByText(WORKSPACES_WORDS.noneMatch("nowhere"))).toBeDefined();
    fireEvent.click(within(list).getByRole("button", { name: "Clear Search" }));
    expect(rowsOf(list)).toHaveLength(2);
    expect(within(list).getByText(WORKSPACES_WORDS.counted(2))).toBeDefined();
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
  ])("keeps the search of $page through a refused re-read", async (listed) => {
    const { words, read } = listed;
    const list = await listAt(listed.path, words.heading, { [read]: listed.rows });
    const search = within(list).getByRole("searchbox", { name: words.search });
    search.focus();
    searchFor(list, words.search, "acme");

    vi.stubGlobal("fetch", answering(THE_OPERATOR, {}, new Map([[read, WITHOUT_THE_MARK]])));
    readAgainInPlace();

    expect(await within(list).findByText(STOCK.permission)).toBeDefined();
    expect(within(list).queryByRole("table")).toBeNull();
    expect(within(list).getByRole("searchbox", { name: words.search })).toBe(search);
    expect(within(list).getByDisplayValue("acme")).toBe(search);
    expect(document.activeElement).toBe(search);
  });

  it("narrows Names waiting by name or flagging workspace", async () => {
    const list = await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });

    searchFor(list, NAMES_WAITING_LIST.search, "priya");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining("Priya Shah")]);

    searchFor(list, NAMES_WAITING_LIST.search, "dales");
    expect(rowsOf(list).map(textOf)).toEqual([expect.stringContaining("Sam Okoro")]);
    expect(within(list).getByText(NAMES_WAITING_WORDS.matching(1, "dales"))).toBeDefined();

    searchFor(list, NAMES_WAITING_LIST.search, "nobody");
    expect(within(list).getByText(NAMES_WAITING_WORDS.noneMatch("nobody"))).toBeDefined();
  });

  it("keeps the correct keystroke off a name the search hid", async () => {
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
    expect(within(list).getByText(SELECT_A_NAME_FIRST)).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();

    searchFor(list, NAMES_WAITING_LIST.search, "");
    pressCorrect();
    expect(screen.queryByRole("dialog"), "a name shown again kept focus it lost").toBeNull();

    within(list).getByRole("button", { name: toCorrectPriya }).focus();
    pressCorrect();
    expect(await screen.findByRole("dialog", { name: toCorrectPriya })).toBeDefined();
  });

  it("keeps the description of Everyone off Names waiting", async () => {
    const people = menuGroupIn(CONSOLE, "people");
    await listAt(NAMES_WAITING_PAGE, NAMES_WAITING_LIST.heading, {
      "console.people.namesWaiting": NAMES_WAITING,
    });
    const page = screen.getByRole("main");

    expect(
      readsInOrder(page, [
        "People",
        people.summary,
        NAMES_WAITING_LIST.heading,
        NAMES_WAITING_WORDS.description,
        NAMES_WAITING_WORDS.counted(2),
        "Priya Shah",
      ]),
    ).toBe(true);
    expect(page.textContent).not.toContain(EVERYONE_WORDS.description);
  });

  it("describes Everyone once, above its search", async () => {
    vi.stubGlobal(
      "fetch",
      answering(THE_OPERATOR, { "console.people.list": { people: [], total: 0 } }),
    );
    await openApp("/console/people/everyone");
    const label = "Search by name or address";
    const list = await screen.findByRole("region", { name: "Everyone" });
    const search = await within(list).findByRole("searchbox", { name: label });

    expect(screen.getByRole("main").textContent.split(EVERYONE_WORDS.description)).toHaveLength(2);
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

const sheetRefusedWith = async (refusal: Answer) => {
  vi.stubGlobal(
    "fetch",
    answering(
      THE_OPERATOR,
      { "console.people.list": { people: [PRIYA], total: 1 } },
      new Map([["console.people.inspect", refusal]]),
    ),
  );
  await openApp("/console/people/everyone");
  fireEvent.click(await screen.findByRole("button", { name: PRIYA.displayName }));
  return within(await screen.findByRole("dialog"));
};

describe("a person's sheet whose read is refused", () => {
  it("says a person since erased is no longer available", async () => {
    const sheet = await sheetRefusedWith(SINCE_ERASED);

    expect(await sheet.findByText(STOCK.gone)).toBeDefined();
    expect(sheet.queryByText(STOCK.permission)).toBeNull();
  });

  it("says a forbidden read is not the reader's to see", async () => {
    const sheet = await sheetRefusedWith(WITHOUT_THE_MARK);

    expect(await sheet.findByText(STOCK.permission)).toBeDefined();
  });
});

describe("what the search on Everyone asks the api", () => {
  it("asks for everyone at once when its box empties", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAsking("tom"));

    act(() => {
      result.current.type("priya");
    });
    expect(result.current.asked, "a key asked before its pause").toEqual({
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
    expect(result.current.asked, "the dropped pause asked after all").toEqual({
      search: "",
      offset: 0,
    });
  });
});
