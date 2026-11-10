import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import type { Api } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, GRACE, read } from "@test/two-workspaces.ts";

export const MEMBERS_PAGE = pageById(menuGroupIn(CONTROL_CENTRE, "people"), "members").path;

export const idOf = (seed: string): string => `01J${seed}`.padEnd(26, "0");

export const PRIYA = {
  ...GRACE,
  personId: idOf("PRYA"),
  displayName: "Priya Shah",
  address: "priya@calder.example.test",
  role: "Editor",
};

export const SAM = {
  ...GRACE,
  personId: idOf("SAM"),
  displayName: "Sam Okoro",
  address: "sam@calder.example.test",
  role: "Viewer",
  joinedAt: "2026-04-17T09:00:00.000Z",
};

export const TEST_PERSON = {
  ...ADA,
  displayName: "Test person",
  address: "admin@calder.example.test",
};

export const anAdminOver = (members: readonly object[]): Api => {
  const api = adaAnAdmin();
  api.set("members.list", () => read(members));
  api.set("members.groups", () => read([]));
  api.set("members.activity", () => read({ events: [], nextCursor: null }));
  return api;
};

export const thePage = () => within(screen.getByRole("main"));

export const changeRoleButton = () =>
  within(thePage().getByRole("region", { name: "Role" })).getByRole("button", {
    name: MEMBER_PAGE_WORDS.changeRole,
  });

export const removalOf = () =>
  within(thePage().getByRole("region", { name: MEMBER_PAGE_WORDS.removal }));

export const removeMemberButton = () =>
  removalOf().getByRole("button", { name: MEMBER_PAGE_WORDS.removeMember });

export const changeRolePressed = () => {
  fireEvent.click(changeRoleButton());
};

export const removeMemberPressed = async () => {
  fireEvent.click(await waitFor(removeMemberButton));
};

export const membersRegion = () => within(screen.getByRole("region", { name: "Members" }));

export const personHeading = (name: string) =>
  waitFor(() => {
    const heading = thePage()
      .getAllByRole("heading", { level: 1 })
      .find((each) => each.textContent === name);
    expect(heading, `no heading for ${name}`).toBeDefined();
    return heading ?? document.body;
  });
