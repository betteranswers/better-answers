import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MEMBERS_WORDS, SELECTED_MEMBERS } from "@/features/people/member-action-words.ts";
import { PEOPLE_KEYSTROKES } from "@/features/people/people-state.ts";
import { choosing, placedWithoutMeasuring } from "@test/measuring.ts";
import {
  joined,
  listed,
  MEMBERS,
  namesShown,
  outcome,
  PRIYA,
  siteLeads,
} from "@test/people/members-roster.ts";
import { ADA, adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const SITE_LEADS = siteLeads(1);

const SAM = joined("01JSAM", "Sam Okoro", "Viewer", [
  { groupId: SITE_LEADS.id, name: SITE_LEADS.name },
]);

const thirtyEditors = Array.from({ length: 30 }, (_, index) =>
  joined(
    `01JPRS${String(index + 1).padStart(2, "0")}`,
    `Person ${String(index + 1).padStart(2, "0")}`,
    "Editor",
  ),
);

const apiOf = (...members: readonly object[]) => {
  const api = adaAnAdmin();
  api.set("members.list", () => read(members));
  api.set("members.groups", () => read([SITE_LEADS]));
  return api;
};

const memberLink = (name: string) => listed().getByRole("link", { name });

const pages = () => screen.getByRole("navigation", { name: MEMBERS_WORDS.pages });

const picked = (filter: string, choice: string) => {
  choosing(listed().getByRole("combobox", { name: filter }), choice);
};

const pressed = (key: string) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

describe("the Members list's address", () => {
  it("keeps the group filter and sort order in the address", async () => {
    const api = apiOf(ADA, PRIYA, SAM);
    const router = await openAt(MEMBERS, api);
    await screen.findByRole("link", { name: SAM.displayName });

    picked("Filter by Group", SITE_LEADS.name);
    await waitFor(() => {
      expect(namesShown()).toEqual([SAM.displayName]);
    });
    expect(
      listed().getAllByRole("status").at(0)?.textContent,
      "the count did not say one of three match",
    ).toMatch(/\b1\b\D+\b3\b/);
    picked("Filter by Group", MEMBERS_WORDS.anyGroup);
    await waitFor(() => {
      expect(namesShown()).toHaveLength(3);
    });

    const personHeader = listed().getByRole("columnheader", { name: "Person" });
    fireEvent.click(within(personHeader).getByRole("button"));
    await waitFor(() => {
      expect(personHeader.getAttribute("aria-sort")).toBe("ascending");
    });
    fireEvent.click(within(personHeader).getByRole("button"));
    await waitFor(() => {
      expect(personHeader.getAttribute("aria-sort")).toBe("descending");
    });
    expect(namesShown()).toEqual([SAM.displayName, PRIYA.displayName, ADA.displayName]);

    cleanup();
    await openAt(router.state.location.href, api);
    await screen.findByRole("link", { name: SAM.displayName });
    expect(namesShown()).toEqual([SAM.displayName, PRIYA.displayName, ADA.displayName]);
  });

  it("returns to page 2 of Editors on Back", async () => {
    const router = await openAt(MEMBERS, apiOf(ADA, ...thirtyEditors));
    await screen.findByRole("link", { name: "Person 01" });

    picked("Filter by Role", "Editor");
    fireEvent.click(within(pages()).getByRole("button", { name: "Next Page" }));
    const lastFiveOfThirty = /\b26\D+30\D+30\b/;
    await waitFor(() => {
      expect(namesShown()).toHaveLength(5);
    });
    expect(within(pages()).getByRole("status").textContent).toMatch(lastFiveOfThirty);

    fireEvent.click(memberLink("Person 27"));
    await screen.findByRole("heading", { level: 1, name: "Person 27" });
    expect(router.state.location.pathname).toMatch(/\/people\/members\/[0-9A-HJKMNP-TV-Z]{26}$/v);
    router.history.back();

    expect(await screen.findByRole("heading", { level: 2, name: "Members" })).toBeDefined();
    expect(namesShown()).toHaveLength(5);
    expect(memberLink("Person 26")).toBeDefined();
    expect(within(pages()).getByRole("status").textContent).toMatch(lastFiveOfThirty);
    expect(listed().getByRole("combobox", { name: "Filter by Role" }).textContent).toBe("Editor");
  });
});

describe("keys after paging away from the focused member", () => {
  const openedPagedAwayFromPersonOne = async () => {
    const router = await openAt(MEMBERS, apiOf(ADA, ...thirtyEditors));
    await screen.findByRole("link", { name: "Person 01" });
    memberLink("Person 01").focus();
    pressed(PEOPLE_KEYSTROKES.nextPage.key);
    await waitFor(() => {
      expect(listed().queryByRole("link", { name: "Person 01" })).toBeNull();
    });
    return router;
  };

  const asksToSelectAMemberAfter = async (
    key: string,
    router: Awaited<ReturnType<typeof openAt>>,
  ) => {
    expect(outcome()?.textContent).toBe("");
    pressed(key);
    await waitFor(() => {
      expect(outcome()?.textContent).toMatch(/\S/);
    });
    expect(router.state.location.pathname, "the key opened another page").toBe(MEMBERS);
    expect(
      screen.queryByRole("toolbar", { name: SELECTED_MEMBERS }),
      "the key selected a member on another page",
    ).toBeNull();
  };

  describe("ignores a member on another page", () => {
    it.each([
      PEOPLE_KEYSTROKES.open,
      PEOPLE_KEYSTROKES.changeRole,
      PEOPLE_KEYSTROKES.remove,
      PEOPLE_KEYSTROKES.tick,
    ])("$key asks you to select a member first", async ({ key }) => {
      const router = await openedPagedAwayFromPersonOne();
      await asksToSelectAMemberAfter(key, router);
      expect(outcome()?.textContent, "the key showed no message").toMatch(/\S/);
    });
  });

  it("acts on a member paged back to only once focused", async () => {
    const router = await openedPagedAwayFromPersonOne();
    pressed(PEOPLE_KEYSTROKES.previousPage.key);
    await screen.findByRole("link", { name: "Person 01" });
    await asksToSelectAMemberAfter(PEOPLE_KEYSTROKES.open.key, router);

    memberLink("Person 01").focus();
    pressed(PEOPLE_KEYSTROKES.open.key);
    expect(await screen.findByRole("heading", { level: 1, name: "Person 01" })).toBeDefined();
  });
});
