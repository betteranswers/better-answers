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

const box = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Search the list" });

const pageShown = () => screen.getByRole("status", { name: "Page shown" }).textContent;

const typeIn = (typed: string) => {
  act(() => {
    fireEvent.change(box(), { target: { value: typed } });
  });
};

const pastTheSettle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 450);
  });

describe("a searched list, its search settled into the address", () => {
  it("keeps every key while the address waits for the burst", async () => {
    const { router, at } = await openList("/list");

    for (const typed of ["p", "pr", "pri"]) typeIn(typed);

    expect(box().value).toBe("pri");
    expect(router.state.location.searchStr, "a key mid-burst reached the address").toBe("");
    await at("/list?list.search=pri");
    expect(box().value).toBe("pri");
  });

  it.each(["1.5", "true", "null", "42"])(
    "takes %s written into the address by hand",
    async (typed) => {
      await openList(`/list?list.search=${typed}`);

      expect(box().value).toBe(typed);
    },
  );

  it("takes a search field only as the text written", () => {
    type Fields = Parameters<typeof useSearchedList>[1];
    expectTypeOf<{ search: SearchText }>().toExtend<Fields>();
    // @ts-expect-error — a bare string field empties a search the router read as JSON.
    expectTypeOf<{ search: z.ZodCatch<z.ZodString> }>().toExtend<Fields>();
  });

  it("takes a search the address gained from outside the box", async () => {
    const { router, at } = await openList("/list?list.search=priya");
    expect(box().value).toBe("priya");

    await act(() => router.navigate({ href: "/list?list.search=sam" }));

    await at("/list?list.search=sam");
    expect(box().value).toBe("sam");
  });

  it("takes back a settled search Back returns to", async () => {
    const { router, at } = await openList("/list");

    typeIn("ab");
    await at("/list?list.search=ab");
    await act(() => router.navigate({ href: "/list" }));
    await at("/list");
    expect(box().value).toBe("");
    act(() => {
      router.history.back();
    });

    await at("/list?list.search=ab");
    expect(box().value, "the box lost the search Back restored").toBe("ab");
    await act(pastTheSettle);
    expect(router.state.location.href, "the box wrote over the entry Back restored").toBe(
      "/list?list.search=ab",
    );
  });

  it("sends a search still settling before the reader leaves", async () => {
    const { router, at } = await openList("/list");

    typeIn("sam");
    fireEvent.click(screen.getByRole("button", { name: "Open a row" }));
    await at("/a-row");
    act(() => {
      router.history.back();
    });

    await at("/list?list.search=sam");
    expect(box().value).toBe("sam");
  });

  it("shows the first page while a typed search settles", async () => {
    await openList("/list?list.page=2");
    expect(pageShown()).toBe("2");

    typeIn("ada");

    expect(pageShown(), "a search still settling showed the old page").toBe("1");
  });

  it("starts the page again once a search settles", async () => {
    const { router, at } = await openList("/list?list.page=3");

    typeIn("ada");

    await at("/list?list.search=ada");
    expect(router.state.location.searchStr, "the old page outlived the search").not.toContain(
      "list.page",
    );
  });

  it("keeps the page within the last page", async () => {
    await openList("/list?list.page=9");

    expect(pageShown()).toBe("3");
  });

  it("clears the search and every filter, keeping a kept field", async () => {
    const { at } = await openList(
      "/list?list.search=ada&list.role=Admin&list.sort=-name&list.page=2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    await at("/list?list.sort=-name");
    expect(box().value).toBe("");
  });

  it("settles a list with no pages without writing a page", async () => {
    const { router, at } = await openPages({ "/older": SearchedWithoutPages }, ["/older"]);

    typeIn("export");

    await at("/older?older.search=export");
    expect(router.state.location.searchStr).not.toContain("page");
  });

  it("clears a list with no pages to a bare address", async () => {
    const { at } = await openPages({ "/older": SearchedWithoutPages }, [
      "/older?older.search=export&older.family=people",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Clear Filters" }));

    await at("/older");
    expect(box().value).toBe("");
  });
});
