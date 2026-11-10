import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterRow } from "@/shared/list/filter-row.tsx";
import { GridTable, RowLink } from "@/shared/list/grid-table.tsx";
import { ListPages } from "@/shared/list/list-pages.tsx";
import { rowInFocus } from "@/shared/list/row-focus.ts";
import { CLEAR_WORDS, LIST_WORDS, filterBy } from "@/shared/words.ts";
import { choosing, placedWithoutMeasuring } from "@test/measuring.ts";
import { BareList, LIST_SAYS, MEMBERS, MembersList } from "@test/members-list.tsx";

placedWithoutMeasuring();

const headers = () => screen.getAllByRole("columnheader").map((header) => header.textContent);

const headRows = () => {
  const rows = screen.getAllByRole("row");
  return rows
    .filter((row) => row.parentElement?.tagName === "THEAD")
    .map((row) => [...row.querySelectorAll("th")].map((head) => head.textContent));
};

const people = () => screen.getAllByRole("link").map((link) => link.textContent);

const rowCheckbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });

const pageCheckbox = () =>
  screen.getByRole("checkbox", { name: "Select every member on this page" });

/** The menus open on a key or pointer press, never on a click. */
const openMenu = (trigger: HTMLElement) => {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
};

const escape = () => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
};

/** The select opens on a key press; a touch or key picks a choice. */
const chooseFilter = (filter: string, choice: string) => {
  choosing(screen.getByRole("combobox", { name: filter }), choice);
};

const pickRole = (role: string) => {
  chooseFilter(filterBy("Role"), role);
};

const searchBox = () => screen.getByRole("searchbox", { name: "Search by name or address" });

const numbersIn = (element: HTMLElement): readonly string[] =>
  element.textContent.match(/\d+/g) ?? [];

const PAGES_OF_TWELVE = {
  kind: "pages",
  label: "Pages of Members",
  pageSize: 5,
  total: 12,
} as const;

const PAGE_KEYSTROKES = {
  previous: { key: "[", action: "Show the Previous Page of Members" },
  next: { key: "]", action: "Show the Next Page of Members" },
};

/** jsdom's click does not focus the button, unlike a browser's. */
const clickWithFocus = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

describe("the shared table", () => {
  it("renders only data columns when no features are enabled", () => {
    render(<BareList />);

    expect(headers()).toEqual(["Person", "Role", "Joined"]);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getAllByRole("row")[1]?.textContent).toBe("Cy TwomblyViewer3 March 2026");
  });

  it("selects only the current page from the header checkbox", () => {
    render(<MembersList pageSize={2} />);

    fireEvent.click(pageCheckbox());
    expect(rowCheckbox("Cy Twombly").getAttribute("aria-checked")).toBe("true");
    expect(rowCheckbox("Ada Lovelace").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.nextPage }));
    expect(rowCheckbox("Ed Ruscha").getAttribute("aria-checked")).toBe("false");
    expect(rowCheckbox("Bo Diddley").getAttribute("aria-checked")).toBe("false");
    expect(pageCheckbox().getAttribute("aria-checked")).toBe("false");
  });

  it("shows the header checkbox as mixed for partial selection", () => {
    render(<MembersList pageSize={2} />);

    fireEvent.click(rowCheckbox("Ada Lovelace"));
    expect(pageCheckbox().getAttribute("aria-checked")).toBe("mixed");

    fireEvent.click(rowCheckbox("Cy Twombly"));
    expect(pageCheckbox().getAttribute("aria-checked")).toBe("true");
  });

  it("sorts ascending then descending and sets aria-sort", () => {
    render(<MembersList />);
    const person = screen.getByRole("columnheader", { name: "Person" });
    expect(person.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(within(person).getByRole("button", { name: "Person" }));
    expect(person.getAttribute("aria-sort")).toBe("ascending");
    expect(people()).toEqual([
      "Ada Lovelace",
      "Bo Diddley",
      "Cy Twombly",
      "Diana Featherstonehaugh-Whittingham",
      "Ed Ruscha",
    ]);

    fireEvent.click(within(person).getByRole("button", { name: "Person" }));
    expect(person.getAttribute("aria-sort")).toBe("descending");
    expect(people()[0]).toBe("Ed Ruscha");
    expect(screen.getByRole("columnheader", { name: "Joined" }).hasAttribute("aria-sort")).toBe(
      false,
    );
  });

  it("hides optional columns from the Columns menu", () => {
    render(<MembersList />);

    const control = openMenu(screen.getByRole("button", { name: "Columns" }));
    const offered = within(control).getAllByRole("menuitemcheckbox");
    expect(offered.map((item) => item.textContent)).toEqual(["Role", "Groups", "Joined"]);

    fireEvent.click(within(control).getByRole("menuitemcheckbox", { name: "Role" }));
    escape();
    expect(headers()).not.toContain("Role");
    expect(headers()).toContain("Person");
  });

  it("names the row menu after its row; Escape restores focus", async () => {
    const actions: string[] = [];
    render(<MembersList onAction={(action) => actions.push(action)} />);

    const trigger = screen.getByRole("button", { name: "Actions for Bo Diddley" });
    trigger.focus();
    const menu = openMenu(trigger);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open", "Remove from workspace"]);

    escape();
    expect(screen.queryByRole("menu")).toBeNull();
    // The menu restores focus one task after it closes.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    fireEvent.click(within(openMenu(trigger)).getByRole("menuitem", { name: "Open" }));
    expect(actions).toEqual(["open bo"]);
  });

  it("has one header row for checkbox, columns and actions", () => {
    render(<MembersList />);

    expect(headRows()).toEqual([["", "Person", "Role", "Groups", "Joined", "Actions"]]);
  });
});

describe("a row link", () => {
  it("opens in place but keeps its href", () => {
    const open = vi.fn<() => void>();
    render(
      <RowLink href="/people/members?person=ada" onOpen={open}>
        Ada Lovelace
      </RowLink>,
    );
    const link = screen.getByRole("link", { name: "Ada Lovelace" });
    expect(link.getAttribute("href")).toBe("/people/members?person=ada");

    expect(fireEvent.click(link)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);

    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("lets the browser handle new tabs and downloads", () => {
    const open = vi.fn<() => void>();
    render(
      <>
        <RowLink href="/people/members?person=ada" target="_blank" onOpen={open}>
          Ada in a new tab
        </RowLink>
        <RowLink href="/people/members?person=ada" download onOpen={open}>
          Ada's card
        </RowLink>
        <RowLink href="/people/members?person=ada" target="_self" onOpen={open}>
          Ada here
        </RowLink>
      </>,
    );

    expect(fireEvent.click(screen.getByRole("link", { name: "Ada in a new tab" }))).toBe(true);
    expect(fireEvent.click(screen.getByRole("link", { name: "Ada's card" }))).toBe(true);
    expect(open).not.toHaveBeenCalled();

    expect(fireEvent.click(screen.getByRole("link", { name: "Ada here" }))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("the list's empty, loading and failed states", () => {
  it("offers the page's primary action when the list is empty", () => {
    render(<MembersList members={[]} />);

    expect(screen.getByText(LIST_SAYS.none)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite people" })).toBeTruthy();
  });

  it("offers Clear filters when a search empties the list", () => {
    render(<MembersList />);
    const search = screen.getByRole("searchbox", { name: "Search by name or address" });

    fireEvent.change(search, { target: { value: "Zed" } });
    expect(screen.getByText(LIST_SAYS.noneMatching("Zed"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: CLEAR_WORDS.filters }));
    expect(people()).toHaveLength(MEMBERS.length);
  });

  it("offers Retry after a failed read, then focuses search", () => {
    const retry = vi.fn<() => void>();
    render(<MembersList read="failed" onRetry={retry} />);

    expect(screen.getByRole("alert").textContent).toBe(LIST_SAYS.failed);
    clickWithFocus(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(searchBox());
  });

  it("shows a loading status on the first read", () => {
    render(<MembersList read="loading" />);

    expect(screen.getByRole("status").textContent).toBe(LIST_SAYS.loading);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers Clear filters when a role filter empties the list", () => {
    render(<MembersList members={MEMBERS.filter((member) => member.role !== "Admin")} />);

    pickRole("Admin");
    expect(screen.getByText(LIST_SAYS.noneFiltered)).toBeTruthy();

    clickWithFocus(screen.getByRole("button", { name: CLEAR_WORDS.filters }));
    expect(people()).toHaveLength(MEMBERS.length - 1);
    expect(document.activeElement).toBe(searchBox());
  });

  it("keeps focus in place when Clear Filters was not focused", () => {
    render(<MembersList />);
    const role = screen.getByRole("combobox", { name: filterBy("Role") });
    fireEvent.change(searchBox(), { target: { value: "Zed" } });
    role.focus();

    fireEvent.click(screen.getByRole("button", { name: CLEAR_WORDS.filters }));
    expect(people()).toHaveLength(MEMBERS.length);
    expect(document.activeElement).toBe(role);
  });
});

describe("list pagination", () => {
  it("changes pages and shows the current range and page", () => {
    render(<MembersList pageSize={2} />);
    const pages = screen.getByRole("navigation", { name: "Pages of Members" });

    expect(numbersIn(within(pages).getByRole("status"))).toEqual(["1", "2", "5"]);
    expect(numbersIn(pages)).toEqual(["1", "2", "5", "1", "3"]);
    const previous = within(pages).getByRole("button", { name: LIST_WORDS.previousPage });
    expect(previous.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(within(pages).getByRole("button", { name: LIST_WORDS.nextPage }));
    fireEvent.click(within(pages).getByRole("button", { name: LIST_WORDS.nextPage }));
    expect(numbersIn(within(pages).getByRole("status"))).toEqual(["5", "5", "5"]);
    expect(people()).toEqual(["Diana Featherstonehaugh-Whittingham"]);
    const next = within(pages).getByRole("button", { name: LIST_WORDS.nextPage });
    expect(next.getAttribute("aria-disabled")).toBe("true");
  });

  it("announces the new range in a single live status", () => {
    render(<MembersList pageSize={2} />);
    const pages = screen.getByRole("navigation", { name: "Pages of Members" });

    fireEvent.click(within(pages).getByRole("button", { name: LIST_WORDS.nextPage }));
    expect(
      within(pages)
        .getAllByRole("status")
        .map((status) => numbersIn(status)),
    ).toEqual([["3", "4", "5"]]);
  });

  it("shows no pagination when the list fits one page", () => {
    render(<MembersList pageSize={25} />);

    expect(screen.queryByRole("navigation", { name: "Pages of Members" })).toBeNull();
  });

  it("moves to the last page when later rows are removed", () => {
    const { rerender } = render(<MembersList pageSize={2} />);
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.nextPage }));
    expect(people()).toEqual(["Ed Ruscha", "Bo Diddley"]);

    rerender(<MembersList pageSize={2} members={MEMBERS.slice(0, 2)} />);
    expect(people()).toEqual(["Cy Twombly", "Ada Lovelace"]);
    expect(screen.queryByRole("navigation", { name: "Pages of Members" })).toBeNull();
  });

  it("returns to the first page when a filter narrows", () => {
    render(<MembersList pageSize={1} />);
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.nextPage }));
    expect(people()).toEqual(["Ada Lovelace"]);

    pickRole("Editor");
    expect(people()).toEqual(["Ed Ruscha"]);
    expect(numbersIn(screen.getByRole("navigation", { name: "Pages of Members" }))).toEqual([
      "1",
      "1",
      "2",
      "1",
      "2",
    ]);
  });

  it("loads more on its keystroke, except while loading", () => {
    const more = vi.fn<() => void>();
    const keystroke = { key: "m", action: "Load older events" };
    const { rerender } = render(
      <ListPages
        pages={{
          kind: "more",
          label: "Older Events",
          more: true,
          loading: false,
          onMore: more,
          keystroke,
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: LIST_WORDS.loadMore }).getAttribute("aria-keyshortcuts"),
    ).toBe("m");

    fireEvent.keyDown(document.body, { key: "m" });
    expect(more).toHaveBeenCalledTimes(1);

    rerender(
      <ListPages
        pages={{
          kind: "more",
          label: "Older Events",
          more: true,
          loading: true,
          onMore: more,
          keystroke,
        }}
      />,
    );
    fireEvent.keyDown(document.body, { key: "m" });
    expect(more).toHaveBeenCalledTimes(1);
  });

  it("changes page with the page keystrokes", () => {
    const turn = vi.fn<(pageIndex: number) => void>();
    render(
      <ListPages
        pages={{ ...PAGES_OF_TWELVE, pageIndex: 1, onTurn: turn, keystrokes: PAGE_KEYSTROKES }}
      />,
    );
    expect(
      screen.getByRole("button", { name: LIST_WORDS.nextPage }).getAttribute("aria-keyshortcuts"),
    ).toBe("]");

    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "[" });
    expect(turn.mock.calls).toEqual([[2], [0]]);
  });

  it("stays within the first and last pages", () => {
    const turn = vi.fn<(pageIndex: number) => void>();
    const { rerender } = render(
      <ListPages
        pages={{ ...PAGES_OF_TWELVE, pageIndex: 0, onTurn: turn, keystrokes: PAGE_KEYSTROKES }}
      />,
    );
    fireEvent.keyDown(document.body, { key: "[" });

    rerender(
      <ListPages
        pages={{ ...PAGES_OF_TWELVE, pageIndex: 2, onTurn: turn, keystrokes: PAGE_KEYSTROKES }}
      />,
    );
    fireEvent.keyDown(document.body, { key: "]" });
    expect(turn).not.toHaveBeenCalled();
  });

  it("loads more until nothing is left", () => {
    const more = vi.fn<() => void>();
    const { rerender } = render(
      <ListPages
        pages={{ kind: "more", label: "Older Events", more: true, loading: false, onMore: more }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.loadMore }));
    expect(more).toHaveBeenCalledTimes(1);

    rerender(
      <ListPages
        pages={{ kind: "more", label: "Older Events", more: false, loading: false, onMore: more }}
      />,
    );
    expect(screen.queryByRole("button", { name: LIST_WORDS.loadMore })).toBeNull();
  });
});

describe("the filter row", () => {
  it("clears its search on Escape", () => {
    const typed: string[] = [];
    render(
      <FilterRow
        search={{
          label: "Search by address",
          value: "ada",
          onChange: (value) => typed.push(value),
        }}
      />,
    );

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search by address" }), {
      key: "Escape",
    });
    expect(typed).toEqual([""]);
  });

  it("names each filter after its field", () => {
    render(
      <FilterRow
        search={{ label: "Search by address", value: "", onChange: () => undefined }}
        filters={[
          {
            label: "Role",
            value: undefined,
            anyLabel: "Any Role",
            choices: [{ value: "Admin", label: "Admin" }],
            onChange: () => undefined,
          },
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: filterBy("Role") }).textContent).toBe("Any Role");
  });

  it("distinguishes a choice valued “any” from no filter", () => {
    const chose: (string | undefined)[] = [];
    const colourOf = (value: string | undefined) => (
      <FilterRow
        search={{ label: "Search by address", value: "", onChange: () => undefined }}
        filters={[
          {
            label: "Colour",
            value,
            anyLabel: "Every colour",
            choices: [
              { value: "any", label: "Any colour at all" },
              { value: "red", label: "Red" },
            ],
            onChange: (choice) => chose.push(choice),
          },
        ]}
      />
    );
    const { rerender } = render(colourOf("any"));
    const trigger = () => screen.getByRole("combobox", { name: filterBy("Colour") });
    expect(trigger().textContent).toBe("Any colour at all");

    rerender(colourOf(undefined));
    expect(trigger().textContent).toBe("Every colour");

    chooseFilter(filterBy("Colour"), "Any colour at all");
    rerender(colourOf("any"));
    chooseFilter(filterBy("Colour"), "Every colour");
    expect(chose).toEqual(["any", undefined]);
  });

  it("switches status and shows each status's count", () => {
    const chosen: string[] = [];
    render(
      <FilterRow
        search={{ label: "Search by address", value: "", onChange: () => undefined }}
        status={{
          label: "Status",
          value: "waiting",
          choices: [
            { value: "waiting", label: "Waiting", count: 3 },
            { value: "expired", label: "Expired", count: 1 },
          ],
          onChange: (value) => chosen.push(value),
        }}
      />,
    );
    const statuses = screen.getByRole("radiogroup", { name: "Status" });

    expect(
      within(statuses).getByRole("radio", { name: "Waiting 3" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(statuses).getByRole("radio", { name: "Expired 1" }));
    expect(chosen).toEqual(["expired"]);
  });
});

const FOCUS_FEATURES = tableFeatures({});

const focusColumn = createColumnHelper<typeof FOCUS_FEATURES, (typeof MEMBERS)[number]>();

const FOCUS_COLUMNS = focusColumn.columns([
  focusColumn.accessor("name", { id: "person", header: "Person" }),
]);

function FocusedList(properties: { readonly members: typeof MEMBERS }) {
  const table = useTable({
    features: FOCUS_FEATURES,
    columns: FOCUS_COLUMNS,
    data: [...properties.members],
    getRowId: (member) => member.id,
  });
  return (
    <GridTable
      table={table}
      caption="Members of this workspace."
      empty={null}
      rowMenu={(member) => (
        <>
          <button type="button">Resend to {member.name}</button>
          <button type="button">Cancel for {member.name}</button>
        </>
      )}
    />
  );
}

describe("the focused row", () => {
  it("returns the focused row, or nothing once it is removed", () => {
    const { rerender } = render(<FocusedList members={MEMBERS} />);
    const inFocus = () => rowInFocus(MEMBERS, (member) => member.id)?.id;

    expect(inFocus()).toBeUndefined();
    screen.getByRole("button", { name: "Resend to Cy Twombly" }).focus();
    expect(inFocus()).toBe("cy");
    screen.getByRole("button", { name: "Cancel for Ada Lovelace" }).focus();
    expect(inFocus()).toBe("ada");
    screen.getByRole("button", { name: "Cancel for Ada Lovelace" }).blur();
    expect(inFocus()).toBeUndefined();

    screen.getByRole("button", { name: "Resend to Cy Twombly" }).focus();
    rerender(<FocusedList members={MEMBERS.filter((member) => member.id !== "cy")} />);
    expect(inFocus(), "a removed row was still reported as focused").toBeUndefined();
  });
});
