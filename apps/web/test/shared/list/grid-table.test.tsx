import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterRow } from "@/shared/list/filter-row.tsx";
import { GridTable, RowLink } from "@/shared/list/grid-table.tsx";
import { ListPages } from "@/shared/list/list-pages.tsx";
import { rowInFocus } from "@/shared/list/row-focus.ts";
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

const tickOf = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });

const pageTick = () => screen.getByRole("checkbox", { name: "Select every member on this page" });

/** The registry's menus open on a key or a press, never on a click. */
const opened = (trigger: HTMLElement) => {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
};

const escape = () => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
};

/** The registry's select opens on a key, and a touch or a key picks a choice. */
const picked = (filter: string, choice: string) => {
  choosing(screen.getByRole("combobox", { name: filter }), choice);
};

const pickRole = (role: string) => {
  picked("Filter by Role", role);
};

const searchBox = () => screen.getByRole("searchbox", { name: "Search by name or address" });

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

/** jsdom's click moves no focus, where a browser's press leaves it on the button. */
const pressedWithFocus = (button: HTMLElement) => {
  button.focus();
  fireEvent.click(button);
};

describe("the shared table", () => {
  it("draws only the page's columns when nothing is opted in", () => {
    render(<BareList />);

    expect(headers()).toEqual(["Person", "Role", "Joined"]);
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.getAllByRole("row")[1]?.textContent).toBe("Cy TwomblyViewer3 March 2026");
  });

  it("ticks only the current page's rows from the header tick", () => {
    render(<MembersList pageSize={2} />);

    fireEvent.click(pageTick());
    expect(tickOf("Cy Twombly").getAttribute("aria-checked")).toBe("true");
    expect(tickOf("Ada Lovelace").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(tickOf("Ed Ruscha").getAttribute("aria-checked")).toBe("false");
    expect(tickOf("Bo Diddley").getAttribute("aria-checked")).toBe("false");
    expect(pageTick().getAttribute("aria-checked")).toBe("false");
  });

  it("shows the header tick as mixed when some are ticked", () => {
    render(<MembersList pageSize={2} />);

    fireEvent.click(tickOf("Ada Lovelace"));
    expect(pageTick().getAttribute("aria-checked")).toBe("mixed");

    fireEvent.click(tickOf("Cy Twombly"));
    expect(pageTick().getAttribute("aria-checked")).toBe("true");
  });

  it("sorts ascending then descending, and says so in aria-sort", () => {
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

  it("hides a column from the column control, never the person", () => {
    render(<MembersList />);

    const control = opened(screen.getByRole("button", { name: "Columns" }));
    const offered = within(control).getAllByRole("menuitemcheckbox");
    expect(offered.map((item) => item.textContent)).toEqual(["Role", "Groups", "Joined"]);

    fireEvent.click(within(control).getByRole("menuitemcheckbox", { name: "Role" }));
    escape();
    expect(headers()).not.toContain("Role");
    expect(headers()).toContain("Person");
  });

  it("names the row menu by its row; Escape returns focus", async () => {
    const actions: string[] = [];
    render(<MembersList onAction={(action) => actions.push(action)} />);

    const trigger = screen.getByRole("button", { name: "Actions for Bo Diddley" });
    trigger.focus();
    const menu = opened(trigger);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open", "Remove from workspace"]);

    escape();
    expect(screen.queryByRole("menu")).toBeNull();
    // The registry hands focus back a task after the menu closes.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    fireEvent.click(within(opened(trigger)).getByRole("menuitem", { name: "Open" }));
    expect(actions).toEqual(["open bo"]);
  });

  it("heads the tick, columns and actions in one row", () => {
    render(<MembersList />);

    expect(headRows()).toEqual([["", "Person", "Role", "Groups", "Joined", "Actions"]]);
  });
});

describe("a row's link", () => {
  it("opens in place, and still leads to its address", () => {
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

  it("leaves a new window or a download to the browser", () => {
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

describe("the list's states", () => {
  it("offers the page's primary action when nothing is listed", () => {
    render(<MembersList members={[]} />);

    expect(screen.getByText(LIST_SAYS.none)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite people" })).toBeTruthy();
  });

  it("offers Clear filters when a search empties the list", () => {
    render(<MembersList />);
    const search = screen.getByRole("searchbox", { name: "Search by name or address" });

    fireEvent.change(search, { target: { value: "Zed" } });
    expect(screen.getByText(LIST_SAYS.noneMatching("Zed"))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(people()).toHaveLength(MEMBERS.length);
  });

  it("offers Retry on a failed read, handing its focus on", () => {
    const retry = vi.fn<() => void>();
    render(<MembersList read="failed" onRetry={retry} />);

    expect(screen.getByRole("alert").textContent).toBe(LIST_SAYS.failed);
    pressedWithFocus(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(searchBox());
  });

  it("says the list is loading on its first read", () => {
    render(<MembersList read="loading" />);

    expect(screen.getByRole("status").textContent).toBe(LIST_SAYS.loading);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("offers Clear filters when a role filter empties the list", () => {
    render(<MembersList members={MEMBERS.filter((member) => member.role !== "Admin")} />);

    pickRole("Admin");
    expect(screen.getByText(LIST_SAYS.noneFiltered)).toBeTruthy();

    pressedWithFocus(screen.getByRole("button", { name: "Clear Filters" }));
    expect(people()).toHaveLength(MEMBERS.length - 1);
    expect(document.activeElement).toBe(searchBox());
  });

  it("leaves focus alone when Clear filters is pressed without it", () => {
    render(<MembersList />);
    const role = screen.getByRole("combobox", { name: "Filter by Role" });
    fireEvent.change(searchBox(), { target: { value: "Zed" } });
    role.focus();

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));
    expect(people()).toHaveLength(MEMBERS.length);
    expect(document.activeElement).toBe(role);
  });
});

describe("the list's pages", () => {
  it("turns pages and says where the reader is", () => {
    render(<MembersList pageSize={2} />);
    const pages = screen.getByRole("navigation", { name: "Pages of Members" });

    expect(within(pages).getByText("Showing 1–2 of 5.")).toBeTruthy();
    expect(within(pages).getByText("Page 1 of 3")).toBeTruthy();
    const previous = within(pages).getByRole("button", { name: "Previous Page" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(within(pages).getByRole("button", { name: "Next Page" }));
    fireEvent.click(within(pages).getByRole("button", { name: "Next Page" }));
    expect(within(pages).getByText("Showing 5–5 of 5.")).toBeTruthy();
    expect(people()).toEqual(["Diana Featherstonehaugh-Whittingham"]);
    const next = within(pages).getByRole("button", { name: "Next Page" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
  });

  it("says where a turn landed in one live status", () => {
    render(<MembersList pageSize={2} />);
    const pages = screen.getByRole("navigation", { name: "Pages of Members" });

    fireEvent.click(within(pages).getByRole("button", { name: "Next Page" }));
    expect(
      within(pages)
        .getAllByRole("status")
        .map((status) => status.textContent),
    ).toEqual(["Showing 3–4 of 5."]);
  });

  it("draws no pages when one page holds the list", () => {
    render(<MembersList pageSize={25} />);

    expect(screen.queryByRole("navigation", { name: "Pages of Members" })).toBeNull();
  });

  it("shows the last page when rows leave a later one", () => {
    const { rerender } = render(<MembersList pageSize={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(people()).toEqual(["Ed Ruscha", "Bo Diddley"]);

    rerender(<MembersList pageSize={2} members={MEMBERS.slice(0, 2)} />);
    expect(people()).toEqual(["Cy Twombly", "Ada Lovelace"]);
    expect(screen.queryByRole("navigation", { name: "Pages of Members" })).toBeNull();
  });

  it("starts again from the first page when a filter narrows", () => {
    render(<MembersList pageSize={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));
    expect(people()).toEqual(["Ada Lovelace"]);

    pickRole("Editor");
    expect(people()).toEqual(["Ed Ruscha"]);
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  });

  it("loads more on the page's keystroke, and not while loading", () => {
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
      screen.getByRole("button", { name: "Load More" }).getAttribute("aria-keyshortcuts"),
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

  it("turns the page on the page's keystrokes", () => {
    const turn = vi.fn<(pageIndex: number) => void>();
    render(
      <ListPages
        pages={{ ...PAGES_OF_TWELVE, pageIndex: 1, onTurn: turn, keystrokes: PAGE_KEYSTROKES }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Next Page" }).getAttribute("aria-keyshortcuts"),
    ).toBe("]");

    fireEvent.keyDown(document.body, { key: "]" });
    fireEvent.keyDown(document.body, { key: "[" });
    expect(turn.mock.calls).toEqual([[2], [0]]);
  });

  it("turns no page past the first or the last", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Load More" }));
    expect(more).toHaveBeenCalledTimes(1);

    rerender(
      <ListPages
        pages={{ kind: "more", label: "Older Events", more: false, loading: false, onMore: more }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Load More" })).toBeNull();
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

  it("names each filter by what it narrows", () => {
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

    expect(screen.getByRole("combobox", { name: "Filter by Role" }).textContent).toBe("Any Role");
  });

  it("tells a choice valued “any” from no narrowing at all", () => {
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
    const trigger = () => screen.getByRole("combobox", { name: "Filter by Colour" });
    expect(trigger().textContent).toBe("Any colour at all");

    rerender(colourOf(undefined));
    expect(trigger().textContent).toBe("Every colour");

    picked("Filter by Colour", "Any colour at all");
    rerender(colourOf("any"));
    picked("Filter by Colour", "Every colour");
    expect(chose).toEqual(["any", undefined]);
  });

  it("switches status, saying each status's count", () => {
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

describe("the row in focus", () => {
  it("answers the row holding focus, none once it is gone", () => {
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
    expect(inFocus(), "a row taken off the page stayed in focus").toBeUndefined();
  });
});
