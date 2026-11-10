import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { GROUP_WORDS } from "@/features/people/groups/group-words.ts";
import { GROUPS_KEYSTROKES } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { CLEAR_WORDS } from "@/shared/words.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { idOf } from "@test/people/member-pages.ts";
import { server } from "@test/stub-server.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const GROUPS_PAGE = pageById(menuGroupIn(CONTROL_CENTRE, "people"), "groups").path;

type Group = {
  readonly id: string;
  readonly name: string;
  readonly origin: "admin-curated";
  readonly memberCount: number;
};

const aGroup = (stem: string, name: string, memberCount: number): Group => ({
  id: idOf(stem),
  name,
  origin: "admin-curated",
  memberCount,
});

const HR_TEAM = aGroup("HRTEAM", "HR team", 2);

const BID_WRITERS = aGroup("BIDS", "Bid writers", 0);

const TEAM_42 = aGroup("T42", "Team 42", 0);

const NAMED = z.object({ name: z.string() });

const OF_A_GROUP = z.object({ groupId: z.string() });

const lastAsked = (procedure: string): unknown =>
  server.asks.findLast((ask) => ask.procedure === procedure)?.input;

const apiHolding = (...groups: readonly Group[]) => {
  let held = [...groups];
  const api = adaAnAdmin();
  api.set("members.groups", () => read(held));
  api.set("members.createGroup", () => {
    const { name } = NAMED.parse(lastAsked("members.createGroup"));
    const created = aGroup(`NEW${String(held.length)}`, name, 0);
    held = [...held, created];
    return read({ groupId: created.id });
  });
  api.set("members.renameGroup", () => {
    const { groupId, name } = OF_A_GROUP.extend(NAMED.shape).parse(
      lastAsked("members.renameGroup"),
    );
    held = held.map((group) => (group.id === groupId ? { ...group, name } : group));
    return read({});
  });
  api.set("members.deleteGroup", () => {
    const { groupId } = OF_A_GROUP.parse(lastAsked("members.deleteGroup"));
    held = held.filter((group) => group.id !== groupId);
    return read({});
  });
  return api;
};

const groupsRegion = () => within(screen.getByRole("region", { name: "Groups" }));

const openedWith = async (first: Group, ...others: readonly Group[]) => {
  const router = await openAt(GROUPS_PAGE, apiHolding(first, ...others));
  await groupsRegion().findByRole("button", { name: first.name });
  return router;
};

const groupButton = (name: string) => groupsRegion().getByRole("button", { name });

const groupRows = (): HTMLElement[] =>
  groupsRegion()
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 1);

const searchBox = () => groupsRegion().getByRole("searchbox", { name: "Search by name" });

const heading = () => groupsRegion().getByRole("heading", { level: 2, name: "Groups" });

const count = (): string => groupsRegion().getAllByRole("status")[0]?.textContent ?? "";

const saying = (): HTMLElement[] =>
  groupsRegion()
    .getAllByRole("status")
    .filter((line) => line.textContent.trim() !== "");

const focused = (element: HTMLElement) =>
  waitFor(() => {
    expect(document.activeElement).toBe(element);
  });

const pressedOnFocus = (key: string) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

const describedBy = (element: HTMLElement): string =>
  document.getElementById(element.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

const rowMenuOpenedFor = async (name: string) => {
  fireEvent.keyDown(groupsRegion().getByRole("button", { name: `Actions for ${name}` }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
};

const renamingFromTheRowMenu = async (name: string) => {
  fireEvent.click(within(await rowMenuOpenedFor(name)).getByRole("menuitem", { name: "Rename" }));
  const dialog = await screen.findByRole("dialog", { name: `Rename ${name}` });
  return { dialog, field: within(dialog).getByRole("textbox", { name: "Name" }) };
};

describe("the Groups page", () => {
  it("searches the groups by name, then clears the search", async () => {
    const router = await openedWith(HR_TEAM, BID_WRITERS);

    pressedOnFocus(GROUPS_KEYSTROKES.search.key);
    await focused(searchBox());
    await userEvent.keyboard("HR");

    expect(groupRows()).toHaveLength(1);
    expect(groupButton("HR team")).toBeDefined();
    expect(count(), "the count did not say one of two match").toMatch(/\b1\b\D+\b2\b/);
    await waitFor(() => {
      expect(router.state.location.href).toMatch(/groups\.search=HR/);
    });

    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), "Payroll");
    expect(groupRows()).toHaveLength(0);
    expect(groupsRegion().getByRole("cell").textContent, "the empty table has no message").toMatch(
      /\S/,
    );
    await userEvent.click(groupsRegion().getByRole("button", { name: CLEAR_WORDS.search }));

    expect(groupRows()).toHaveLength(2);
    await focused(searchBox());
    expect(count()).toMatch(/\b2\b/);
  });

  it("reads a search typed into the address", async () => {
    await openAt(`${GROUPS_PAGE}?groups.search=42`, apiHolding(HR_TEAM, BID_WRITERS, TEAM_42));

    await groupsRegion().findByRole("button", { name: "Team 42" });
    expect(searchBox()).toHaveProperty("value", "42");
    expect(groupRows()).toHaveLength(1);
    expect(count(), "the count did not say one of three match").toMatch(/\b1\b\D+\b3\b/);
  });

  it("keeps focus in search while a new group is filtered", async () => {
    await openedWith(HR_TEAM, BID_WRITERS);
    await userEvent.click(
      groupsRegion().getByRole("button", { name: GROUPS_KEYSTROKES.create.action }),
    );
    const dialog = await screen.findByRole("dialog", { name: GROUPS_KEYSTROKES.create.action });

    await userEvent.type(
      within(dialog).getByRole("textbox", { name: GROUP_WORDS.create.field }),
      "Site leads{Enter}",
    );

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await focused(await groupsRegion().findByRole("button", { name: "Site leads" }));
    await userEvent.type(searchBox(), "Bid");
    expect(groupsRegion().queryByRole("button", { name: "Site leads" })).toBeNull();
    await userEvent.clear(searchBox());

    expect(groupButton("Site leads")).toBeDefined();
    expect(document.activeElement, "focus moved to the new group's row").toBe(searchBox());
  });

  it("focuses the heading once a rename hides the row", async () => {
    await openedWith(HR_TEAM, BID_WRITERS);
    await userEvent.type(searchBox(), "HR");
    expect(groupRows()).toHaveLength(1);
    const { field } = await renamingFromTheRowMenu("HR team");

    await userEvent.clear(field);
    await userEvent.type(field, "People team{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(
      groupsRegion().queryByRole("button", { name: "People team" }),
      "the renamed group still shows despite the search",
    ).toBeNull();
    await focused(heading());
  });

  it("says the name is unchanged and keeps the dialog open", async () => {
    await openedWith(HR_TEAM, BID_WRITERS);
    const { dialog, field } = await renamingFromTheRowMenu("HR team");

    await userEvent.type(field, "{Enter}");

    expect(within(dialog).getByRole("status").textContent).toContain("HR team");
    expect(lastAsked("members.renameGroup"), "an unchanged name sent a rename").toBeUndefined();
    expect(field).toHaveProperty("value", "HR team");
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await focused(groupsRegion().getByRole("button", { name: "Actions for HR team" }));
    expect(saying(), "the dialog's message also appeared on the page").toHaveLength(1);
  });

  it("deletes a group from its row menu after a warning", async () => {
    await openedWith(HR_TEAM, BID_WRITERS);

    fireEvent.click(
      within(await rowMenuOpenedFor("HR team")).getByRole("menuitem", { name: "Delete" }),
    );

    const confirming = await screen.findByRole("alertdialog", { name: "Delete HR team" });
    expect(describedBy(confirming), "the warning did not count the group's 2 members").toMatch(
      /\b2\b/,
    );
    await focused(within(confirming).getByRole("button", { name: GROUP_WORDS.keep }));
    act(() => {
      within(confirming).getByRole("button", { name: "Delete" }).focus();
    });
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(groupRows()).toHaveLength(1);
    await focused(heading());
    await waitFor(() => {
      expect(saying().map((line) => line.textContent)).toEqual([
        expect.stringMatching(/\b1\b/),
        expect.stringMatching(/HR team/),
      ]);
    });
  });

  it("opens no group by key after focus leaves the list", async () => {
    await openedWith(HR_TEAM, BID_WRITERS);
    expect(saying(), "a message besides the count appeared before any action").toHaveLength(1);
    act(() => {
      groupButton("HR team").focus();
      heading().focus();
    });

    pressedOnFocus(GROUPS_KEYSTROKES.open.key);

    expect(screen.queryByRole("dialog"), "the key opened a group with none in focus").toBeNull();
    await waitFor(() => {
      expect(saying()).toHaveLength(2);
    });
    expect(saying().at(1)?.textContent, "the key with no group in focus showed no message").toMatch(
      /\S/,
    );
  });
});
