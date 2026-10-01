import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterRow } from "@/shared/filter-row.tsx";
import { RowLink } from "@/shared/grid-table.tsx";
import { ListPages } from "@/shared/list-pages.tsx";

import { placedWithoutMeasuring } from "./measuring.ts";
import { BareList, MEMBERS, MembersList } from "./members-list.tsx";

placedWithoutMeasuring();

const headers = () => screen.getAllByRole("columnheader").map((header) => header.textContent);

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

describe("the shared table", () => {
  it("draws only the screen's columns when nothing is opted in", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
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
    const acts: string[] = [];
    render(<MembersList onAct={(act) => acts.push(act)} />);

    const trigger = screen.getByRole("button", { name: "Acts for Bo Diddley" });
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
    expect(acts).toEqual(["open bo"]);
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
});

describe("the list's states", () => {
  it("offers the screen's primary act when nothing is listed", () => {
    render(<MembersList members={[]} />);

    expect(screen.getByText("No one belongs to this workspace yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Invite people" })).toBeTruthy();
  });

  it("offers Clear filters when a search empties the list", () => {
    render(<MembersList />);
    const search = screen.getByRole("searchbox", { name: "Search by name or address" });

    fireEvent.change(search, { target: { value: "Zed" } });
    expect(screen.getByText("No one matches “Zed”.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(people()).toHaveLength(MEMBERS.length);
  });

  it("offers Retry when the read fails", () => {
    const retry = vi.fn<() => void>();
    render(<MembersList read="failed" onRetry={retry} />);

    expect(screen.getByRole("alert").textContent).toBe("The members could not be read.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says the list is loading on its first read", () => {
    render(<MembersList read="loading" />);

    expect(screen.getByText("The members are still loading.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the list's pages", () => {
  it("turns pages and says where the reader is", () => {
    render(<MembersList pageSize={2} />);
    const pages = screen.getByRole("navigation", { name: "Pages of members" });

    expect(within(pages).getByText("Showing 1–2 of 5.")).toBeTruthy();
    expect(within(pages).getByText("Page 1 of 3")).toBeTruthy();
    const previous = within(pages).getByRole("button", { name: "Previous page" });
    expect(previous.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    fireEvent.click(within(pages).getByRole("button", { name: "Next page" }));
    expect(within(pages).getByText("Showing 5–5 of 5.")).toBeTruthy();
    expect(people()).toEqual(["Diana Featherstonehaugh-Whittingham"]);
    const next = within(pages).getByRole("button", { name: "Next page" });
    expect(next.getAttribute("aria-disabled")).toBe("true");
  });

  it("draws no pages when one page holds the list", () => {
    render(<MembersList pageSize={25} />);

    expect(screen.queryByRole("navigation", { name: "Pages of members" })).toBeNull();
  });

  it("loads more until nothing is left", () => {
    const more = vi.fn<() => void>();
    const { rerender } = render(
      <ListPages
        pages={{ kind: "more", label: "Older events", more: true, loading: false, onMore: more }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(more).toHaveBeenCalledTimes(1);

    rerender(
      <ListPages
        pages={{ kind: "more", label: "Older events", more: false, loading: false, onMore: more }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
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
            anyLabel: "Any role",
            choices: [{ value: "Admin", label: "Admin" }],
            onChange: () => undefined,
          },
        ]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Filter by role" }).textContent).toBe("Any role");
  });

  it("switches status, saying each status's count", () => {
    const picked: string[] = [];
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
          onChange: (value) => picked.push(value),
        }}
      />,
    );
    const statuses = screen.getByRole("radiogroup", { name: "Status" });

    expect(
      within(statuses).getByRole("radio", { name: "Waiting 3" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(statuses).getByRole("radio", { name: "Expired 1" }));
    expect(picked).toEqual(["expired"]);
  });
});
