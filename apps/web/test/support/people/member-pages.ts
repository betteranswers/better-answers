import { screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";

import type { Api } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, GRACE, read } from "@test/two-workspaces.ts";

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

export const membersRegion = () => within(screen.getByRole("region", { name: "Members" }));

export const personHeading = (name: string) =>
  waitFor(() => {
    const heading = thePage()
      .getAllByRole("heading", { level: 2 })
      .find((each) => each.textContent === name);
    expect(heading, `no heading for ${name}`).toBeDefined();
    return heading ?? document.body;
  });
