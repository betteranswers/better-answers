import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { HOMES } from "@/shared/navigation.ts";
import type { Api } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  aRefusalAnswer,
  HOLME,
  NORTHERN,
  openOutsideTheShellAt,
  read,
  switcher,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(cleanup);

const SET_ACTIVE = "/organization/set-active";

const NORTHERN_ROW = { workspace: NORTHERN, role: "Admin" };

const HOLME_ROW = { workspace: HOLME, role: "Viewer" };

const SIGNED_IN_WITH_NONE_OPEN = {
  session: { id: "s" },
  user: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
};

const NEEDS_A_PICK = aRefusalAnswer("no-active-workspace", "unauthenticated", 401);

const aTurnLater = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve);
  });

const holding = (workspaces: readonly unknown[]): Api => {
  const api = adaAnAdmin();
  api.set("/get-session", () => SIGNED_IN_WITH_NONE_OPEN);
  api.set("session.member", () => NEEDS_A_PICK);
  api.set("person.workspaces", () => read(workspaces));
  api.set("person.invitations", () => read([]));
  return api;
};

const picksOpenAsAdmin = (api: Api) => {
  api.set(SET_ACTIVE, () => {
    api.set("session.member", () => adaAt("Admin"));
    return {};
  });
};

const picksRefused = (api: Api): (() => number) => {
  let asked = 0;
  api.set(SET_ACTIVE, () => {
    asked += 1;
    throw new TypeError("the network is down");
  });
  return () => asked;
};

const thePicker = () => screen.findByRole("heading", { level: 1, name: PICKER_WORDS.heading });

const refusal = () => screen.getByRole("alert").textContent;

it("shows a member of two workspaces their role in each", async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  picksOpenAsAdmin(api);
  const router = await openOutsideTheShellAt("/choose-workspace", api);

  const list = await within(screen.getByRole("main")).findByRole("list");

  const rows = within(list).getAllByRole("listitem");
  expect(rows.map((row) => within(row).getByRole("button").textContent)).toEqual([
    NORTHERN.name,
    HOLME.name,
  ]);
  expect(rows[0]?.textContent, "a row does not show the role held there").toContain("Admin");
  expect(rows[1]?.textContent, "a row does not show the role held there").toContain("Viewer");
  const acme = screen.getByRole("button", {
    name: NORTHERN.name,
    description: "Admin",
  });

  fireEvent.click(acme);

  await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Admin.path));
  expect(await screen.findByRole("heading", { level: 1, name: "People" })).toBeDefined();
  expect(await switcher(NORTHERN)).toBeDefined();
});

it("stops at one refused pick of a sole workspace", async () => {
  const api = holding([NORTHERN_ROW]);
  const picks = picksRefused(api);
  await openOutsideTheShellAt("/choose-workspace", api);

  await waitFor(() => expect(refusal()).toMatch(/\S/));
  await aTurnLater();

  expect(await thePicker()).toBeDefined();
  expect(picks(), "a refused pick was asked again").toBe(1);
});

it("keeps the list, saying so, when a pick is refused", async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  picksRefused(api);
  await openOutsideTheShellAt("/choose-workspace", api);
  const picked = await screen.findByRole("button", { name: HOLME.name });
  picked.focus();

  fireEvent.click(picked);

  await waitFor(() => expect(refusal()).toMatch(/\S/));
  expect(document.activeElement).toBe(picked);
  expect(screen.getByRole("button", { name: NORTHERN.name })).toBeDefined();
});

it("sends a non-member from the picker to the refused page", async () => {
  const api = holding([]);
  const router = await openOutsideTheShellAt("/choose-workspace", api);

  expect(
    await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
  ).toBeDefined();
  expect(router.state.location.pathname).toBe("/no-workspace");
  expect(screen.getByRole("button", { name: "Sign Out" })).toBeDefined();
});

it("separates an unread workspace list from no workspace, offering retry", async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  const listed = api.get("person.workspaces");
  api.set("person.workspaces", () => {
    throw new TypeError("the network is down");
  });
  await openOutsideTheShellAt("/choose-workspace", api);

  await waitFor(() => expect(refusal()).toMatch(/\S/));
  await aTurnLater();
  expect(await thePicker()).toBeDefined();
  expect(screen.queryByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeNull();

  api.set("person.workspaces", () => listed?.());
  fireEvent.click(screen.getByRole("button", { name: PICKER_WORDS.tryAgain }));

  expect(await screen.findByRole("button", { name: NORTHERN.name })).toBeDefined();
  expect(screen.getByRole("button", { name: HOLME.name })).toBeDefined();
});
