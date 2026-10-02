import { useNavigate } from "@tanstack/react-router";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMBERS_FIELDS,
  MEMBERS_LIST,
  useSettledSearch,
} from "@/features/people/members-address.ts";
import { useListAddress } from "@/shared/list-address.ts";

import { openScreens } from "./address-router.tsx";

afterEach(cleanup);

/** Members' search box: the draft in the box, the settled search in the address. */
function Searched() {
  const { state, write } = useListAddress(MEMBERS_LIST, MEMBERS_FIELDS);
  const navigate = useNavigate();
  const [search, setSearch, flush] = useSettledSearch(state.search, (settled) => {
    write({ search: settled, page: 1 });
  });
  return (
    <>
      <input
        aria-label="Search the members"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          flush();
          void navigate({ href: "/a-member" });
        }}
      >
        Open a member
      </button>
    </>
  );
}

const openMembers = (entry: string) =>
  openScreens({ "/people/members": Searched, "/a-member": () => null }, ["/elsewhere", entry]);

const box = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Search the members" });

const typeIn = (typed: string) => {
  act(() => {
    fireEvent.change(box(), { target: { value: typed } });
  });
};

describe("Members' search, settled into the address", () => {
  it("keeps every key while the address waits for the burst", async () => {
    const { router, at } = await openMembers("/people/members");

    for (const typed of ["p", "pr", "pri"]) typeIn(typed);

    expect(box().value).toBe("pri");
    expect(router.state.location.searchStr, "a key mid-burst reached the address").toBe("");
    await at("/people/members?members.search=pri");
    expect(box().value).toBe("pri");
  });

  it("takes a search the address gained from outside the box", async () => {
    const { router, at } = await openMembers("/people/members?members.search=priya");
    expect(box().value).toBe("priya");

    await act(() => router.navigate({ href: "/people/members?members.search=sam" }));

    await at("/people/members?members.search=sam");
    expect(box().value).toBe("sam");
  });

  it("sends a search still settling before the reader leaves", async () => {
    const { router, at } = await openMembers("/people/members");

    typeIn("sam");
    fireEvent.click(screen.getByRole("button", { name: "Open a member" }));
    await at("/a-member");
    act(() => {
      router.history.back();
    });

    await at("/people/members?members.search=sam");
    expect(box().value).toBe("sam");
  });

  it("starts the page again once a search settles", async () => {
    const { router, at } = await openMembers("/people/members?members.page=3");

    typeIn("ada");

    await at("/people/members?members.search=ada");
    expect(router.state.location.searchStr, "the old page outlived the search").not.toContain(
      "members.page",
    );
  });
});
