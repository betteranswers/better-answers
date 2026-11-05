import { useNavigate } from "@tanstack/react-router";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { PAGE_NUMBER, searchText, type SearchText } from "@/shared/address/list-address.ts";
import { useSearchedList } from "@/shared/list/searched-list.ts";
import { openPages } from "@test/address-router.tsx";

afterEach(cleanup);

const ROLES = ["Admin", "Viewer"] as const;

const SORTS = ["name", "-name"] as const;

const FAMILIES = ["people", "sources"] as const;

const PAGED = {
  search: searchText(),
  role: z.enum(ROLES).optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  page: PAGE_NUMBER,
};

const UNPAGED = {
  search: searchText(),
  family: z.enum(FAMILIES).optional().catch(undefined),
};

const KEPT_ON_CLEAR = ["sort"] as const;

const ROWS = 12;

const PAGE_SIZE = 5;

function Searched() {
  const list = useSearchedList("list", PAGED, KEPT_ON_CLEAR);
  const navigate = useNavigate();
  return (
    <>
      <input
        aria-label="Search the list"
        value={list.search}
        onChange={(event) => {
          list.setSearch(event.target.value);
        }}
      />
      <output aria-label="Page shown">{list.pageIndex(PAGE_SIZE, ROWS) + 1}</output>
      <button
        type="button"
        onClick={() => {
          list.flush();
          void navigate({ href: "/a-row" });
        }}
      >
        Open a row
      </button>
      <button type="button" onClick={list.clear}>
        Clear Filters
      </button>
    </>
  );
}

function SearchedWithoutPages() {
  const list = useSearchedList("older", UNPAGED);
  return (
    <>
      <input
        aria-label="Search the list"
        value={list.search}
        onChange={(event) => {
          list.setSearch(event.target.value);
        }}
      />
      <button type="button" onClick={list.clear}>
        Clear Filters
      </button>
    </>
  );
}

const openList = (entry: string) =>
  openPages({ "/list": Searched, "/a-row": () => null }, ["/elsewhere", entry]);

const searchBox = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Search the list" });

const pageShown = () => screen.getByRole("status", { name: "Page shown" }).textContent;

const typeIn = (typed: string) => {
  act(() => {
    fireEvent.change(searchBox(), { target: { value: typed } });
  });
};

const waitPastDebounce = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 450);
  });

describe("a searched list with a debounced URL search", () => {
  it("keeps every keystroke while the URL update is debounced", async () => {
    const { router, at } = await openList("/list");

    for (const typed of ["p", "pr", "pri"]) typeIn(typed);

    expect(searchBox().value).toBe("pri");
    expect(router.state.location.searchStr, "the URL updated before typing paused").toBe("");
    await at("/list?list.search=pri");
    expect(searchBox().value).toBe("pri");
  });

  it.each(["1.5", "true", "null", "42"])("reads %s typed into the URL by hand", async (typed) => {
    await openList(`/list?list.search=${typed}`);

    expect(searchBox().value).toBe(typed);
  });

  it("accepts only a SearchText field for search", () => {
    type Fields = Parameters<typeof useSearchedList>[1];
    expectTypeOf<{ search: SearchText }>().toExtend<Fields>();
    // @ts-expect-error — a plain string field would lose searches the router parsed as JSON.
    expectTypeOf<{ search: z.ZodCatch<z.ZodString> }>().toExtend<Fields>();
  });

  it("updates the box when the URL search changes", async () => {
    const { router, at } = await openList("/list?list.search=priya");
    expect(searchBox().value).toBe("priya");

    await act(() => router.navigate({ href: "/list?list.search=sam" }));

    await at("/list?list.search=sam");
    expect(searchBox().value).toBe("sam");
  });

  it("restores a search when the user goes back", async () => {
    const { router, at } = await openList("/list");

    typeIn("ab");
    await at("/list?list.search=ab");
    await act(() => router.navigate({ href: "/list" }));
    await at("/list");
    expect(searchBox().value).toBe("");
    act(() => {
      router.history.back();
    });

    await at("/list?list.search=ab");
    expect(searchBox().value, "the box did not show the search restored by Back").toBe("ab");
    await act(waitPastDebounce);
    expect(router.state.location.href, "the box overwrote the history entry restored by Back").toBe(
      "/list?list.search=ab",
    );
  });

  it("saves a pending search before navigating away", async () => {
    const { router, at } = await openList("/list");

    typeIn("sam");
    fireEvent.click(screen.getByRole("button", { name: "Open a row" }));
    await at("/a-row");
    act(() => {
      router.history.back();
    });

    await at("/list?list.search=sam");
    expect(searchBox().value).toBe("sam");
  });

  it("shows the first page while a search is pending", async () => {
    await openList("/list?list.page=2");
    expect(pageShown()).toBe("2");

    typeIn("ada");

    expect(pageShown(), "a pending search showed the old page").toBe("1");
  });

  it("resets the page after a search is saved", async () => {
    const { router, at } = await openList("/list?list.page=3");

    typeIn("ada");

    await at("/list?list.search=ada");
    expect(
      router.state.location.searchStr,
      "the URL kept the old page after the search",
    ).not.toContain("list.page");
  });

  it("limits the page to the last page", async () => {
    await openList("/list?list.page=9");

    expect(pageShown()).toBe("3");
  });

  it("clears the search and filters but keeps the sort", async () => {
    const { at } = await openList(
      "/list?list.search=ada&list.role=Admin&list.sort=-name&list.page=2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    await at("/list?list.sort=-name");
    expect(searchBox().value).toBe("");
  });

  it("saves an unpaged list's search without a page", async () => {
    const { router, at } = await openPages({ "/older": SearchedWithoutPages }, ["/older"]);

    typeIn("export");

    await at("/older?older.search=export");
    expect(router.state.location.searchStr).not.toContain("page");
  });

  it("clears an unpaged list to a URL with no query", async () => {
    const { at } = await openPages({ "/older": SearchedWithoutPages }, [
      "/older?older.search=export&older.family=people",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    await at("/older");
    expect(searchBox().value).toBe("");
  });
});
