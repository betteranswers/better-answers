import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { placedWithoutMeasuring } from "@test/measuring.ts";
import { asked, MEMBERS, rowOf, SAM, siteLeads } from "@test/people/members-roster.ts";
import { ADA, adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const SITE_LEADS = siteLeads(0);

const apiOf = () => {
  const api = adaAnAdmin();
  api.set("members.list", () => read([ADA, SAM]));
  api.set("members.groups", () => read([SITE_LEADS]));
  return api;
};

const thePage = () => within(screen.getByRole("main"));

const cellOf = (name: string, column: number): string | undefined =>
  within(rowOf(name)).getAllByRole("cell").at(column)?.textContent;

const rowMenuOpened = async (name: string) => {
  fireEvent.keyDown(await screen.findByRole("button", { name: `Actions for ${name}` }), {
    key: "Enter",
  });
  return screen.findByRole("menu");
};

describe("bulk actions on the members ticked", () => {
  it("the row menu's Change Role changes its one member alone", async () => {
    const api = apiOf();
    api.set("members.changeRole", () => {
      api.set("members.list", () => read([ADA, { ...SAM, role: "Editor" }]));
      return read({ personId: SAM.personId, previousRole: "Viewer", role: "Editor" });
    });
    const router = await openAt(MEMBERS, api);
    const menu = await rowMenuOpened(SAM.displayName);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Open", "Change Role", "Add to Group", "Remove"]);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Change Role" }));

    await screen.findByRole("heading", { level: 2, name: SAM.displayName });
    expect(router.state.location.pathname).toMatch(/\/people\/members\/[0-9A-HJKMNP-TV-Z]{26}$/v);
    await waitFor(() => {
      expect(document.activeElement).toBe(thePage().getByRole("radio", { name: "Viewer" }));
    });
    fireEvent.click(thePage().getByRole("radio", { name: "Editor" }));
    const roleCard = within(screen.getByRole("region", { name: "Role" }));
    fireEvent.click(roleCard.getByRole("button", { name: "Change Role" }));
    await waitFor(() => {
      expect(roleCard.getByRole("status").textContent).toMatch(/Sam Okoro.*Editor/v);
    });
    expect(asked("members.changeRole")).toEqual([{ personId: SAM.personId, role: "Editor" }]);
    router.history.back();

    await screen.findByRole("heading", { level: 2, name: "Members" });
    await waitFor(() => {
      expect(cellOf(SAM.displayName, 2)).toBe("Editor");
    });
    expect(screen.queryByRole("toolbar", { name: "Selected Members" })).toBeNull();
  });

  it("the row menu's Add to Group opens the page's groups", async () => {
    const api = apiOf();
    api.set("members.addToGroup", () => {
      api.set("members.list", () =>
        read([ADA, { ...SAM, groups: [{ groupId: SITE_LEADS.id, name: SITE_LEADS.name }] }]),
      );
      return read({});
    });
    const router = await openAt(MEMBERS, api);
    const menu = await rowMenuOpened(SAM.displayName);

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Add to Group" }));

    await screen.findByRole("heading", { level: 2, name: SAM.displayName });
    const box = await thePage().findByRole("checkbox", { name: "Site leads" });
    await waitFor(() => {
      expect(document.activeElement).toBe(box);
    });
    fireEvent.click(box);
    await waitFor(() => {
      expect(box.getAttribute("aria-checked")).toBe("true");
    });
    expect(
      thePage().getAllByText("Site leads", { exact: true }),
      "the group is named outside its checklist",
    ).toHaveLength(1);
    router.history.back();

    await screen.findByRole("heading", { level: 2, name: "Members" });
    await waitFor(() => {
      expect(cellOf(SAM.displayName, 3)).toBe("Site leads");
    });
  });
});
