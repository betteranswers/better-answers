import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PAGE_NUMBER, useListAddress } from "@/shared/list-address.ts";

import { openScreens } from "./address-router.tsx";

afterEach(cleanup);

const ROLE_FILTERS = ["Admin", "Editor", "Viewer"] as const;

const FIELDS = {
  search: z.string().catch(""),
  role: z.enum(ROLE_FILTERS).optional().catch(undefined),
  page: PAGE_NUMBER,
};

/** A search box, a role filter and a page, each held in the address under the list's prefix. */
function List(properties: { readonly prefix: string }) {
  const { prefix } = properties;
  const { state, write } = useListAddress(prefix, FIELDS);

  return (
    <>
      <input
        aria-label={`Search ${prefix}`}
        value={state.search}
        onChange={(event) => {
          write({ search: event.target.value, page: 1 });
        }}
      />
      <button
        type="button"
        onClick={() => {
          write({ role: "Editor" });
        }}
      >
        Editors
      </button>
      <button
        type="button"
        onClick={() => {
          write({ page: state.page + 1 });
        }}
      >
        Next page
      </button>
      <button
        type="button"
        onClick={() => {
          write({ role: "Viewer" });
          write({ page: 2 });
        }}
      >
        Viewers, page 2
      </button>
      <output>{`${state.role ?? "every role"}, page ${String(state.page)}`}</output>
    </>
  );
}

const MEMBERS = () => <List prefix="members" />;

/** Two tabs of one screen; the open tab is the screen's own state, never the address. */
function Tabs() {
  const [open, setOpen] = useState("members");

  return (
    <>
      <button type="button" onClick={() => setOpen("members")}>
        Members tab
      </button>
      <button type="button" onClick={() => setOpen("invitations")}>
        Invitations tab
      </button>
      <List key={open} prefix={open} />
    </>
  );
}

const ELSEWHERE = () => null;

const openMembers = (...entries: readonly string[]) =>
  openScreens({ "/members": MEMBERS, "/elsewhere": ELSEWHERE }, entries);

const searchBox = (prefix = "members") =>
  screen.getByRole<HTMLInputElement>("textbox", {
    name: `Search ${prefix}`,
  });

const typeIn = (box: HTMLInputElement, typed: string) => {
  act(() => {
    fireEvent.change(box, { target: { value: typed } });
  });
};

const shown = () => screen.getByRole("status").textContent;

describe("a list's state in the address", () => {
  it("keeps a search and a role filter across a reload", async () => {
    const { at } = await openMembers("/members");

    typeIn(searchBox(), "priya");
    fireEvent.click(screen.getByRole("button", { name: "Editors" }));
    await at("/members?members.search=priya&members.role=Editor");
    cleanup();
    await openMembers("/members?members.search=priya&members.role=Editor");

    expect(searchBox().value).toBe("priya");
    expect(shown()).toBe("Editor, page 1");
  });

  it.each(["abc", "0", "-2", "2.5", ""])("reads page %j as page 1", async (page) => {
    await openMembers(`/members?members.page=${page}`);

    expect(shown()).toBe("every role, page 1");
  });

  it("reads page 3, and an unknown role as every role", async () => {
    await openMembers("/members?members.page=3&members.role=Owner");

    expect(shown()).toBe("every role, page 3");
  });

  it("replaces the history entry on each keystroke", async () => {
    const { history, at } = await openMembers("/elsewhere", "/members");

    for (const typed of ["p", "pr", "pri"]) typeIn(searchBox(), typed);
    await at("/members?members.search=pri");

    expect(history.length, "a keystroke pushed an entry of its own").toBe(2);
  });

  it("keeps a number-like search exactly as typed", async () => {
    const { router } = await openMembers("/members");

    typeIn(searchBox(), "0.50");
    await vi.waitFor(() => expect(router.state.location.searchStr).not.toBe(""));
    cleanup();
    await openMembers(router.state.location.href);

    expect(searchBox().value).toBe("0.50");
  });

  it("drops a value back at its default from the address", async () => {
    const { at } = await openMembers("/members?members.search=priya&members.page=2");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await at("/members?members.search=priya&members.page=3");
    typeIn(searchBox(), "");

    await at("/members");
    expect(shown()).toBe("every role, page 1");
  });

  it("lands both of two writes made in one handler", async () => {
    const { at } = await openMembers("/members?members.search=priya");

    fireEvent.click(screen.getByRole("button", { name: "Viewers, page 2" }));

    await at("/members?members.search=priya&members.role=Viewer&members.page=2");
    expect(shown()).toBe("Viewer, page 2");
  });

  it("holds each tab's search under its own prefix", async () => {
    const { at } = await openScreens({ "/people": Tabs }, ["/people"]);

    typeIn(searchBox("members"), "priya");
    fireEvent.click(screen.getByRole("button", { name: "Invitations tab" }));
    expect(searchBox("invitations").value).toBe("");
    typeIn(searchBox("invitations"), "tom");
    await at("/people?members.search=priya&invitations.search=tom");
    fireEvent.click(screen.getByRole("button", { name: "Members tab" }));

    expect(searchBox("members").value).toBe("priya");
  });
});
