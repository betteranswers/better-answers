import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { FAILED_PAGE } from "@/app/words.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { HOMES, NEW_QUESTION, type Role } from "@/shared/navigation.ts";
import { SIGN_OUT } from "@/shared/words.ts";
import { server, type Asked } from "@test/stub-server.ts";
import { addressOf, type Api, holdProcedure, settlingAfter } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  aRefusalAnswer,
  HOLME,
  NORTHERN,
  openPageOutsideShell,
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

const holding = (workspaces: readonly unknown[]): Api => {
  const api = adaAnAdmin();
  api.set("/get-session", () => SIGNED_IN_WITH_NONE_OPEN);
  api.set("session.member", () => NEEDS_A_PICK);
  api.set("person.workspaces", () => read(workspaces));
  api.set("person.invitations", () => read([]));
  return api;
};

const picksOpenAs = (api: Api, role: Role) => {
  api.set(SET_ACTIVE, () => {
    api.set("session.member", () => adaAt(role));
    api.set("/get-session", () => ({
      ...SIGNED_IN_WITH_NONE_OPEN,
      session: { id: "s", activeOrganizationId: NORTHERN.id },
    }));
    return {};
  });
};

const pickBody = z.object({ organizationId: z.string() });

const watchingPicks = () => {
  const picked: string[] = [];
  const watching = (asked: Asked, init?: RequestInit) => {
    if (addressOf(asked).pathname !== SET_ACTIVE) return;
    const body = typeof init?.body === "string" ? init.body : "";
    picked.push(pickBody.parse(JSON.parse(body)).organizationId);
  };
  return { picked, watching };
};

const removedFrom = (workspace: { readonly id: string }) => {
  const answering = server.answer;
  server.answer = async (asked, init) => {
    const answered = await answering(asked, init);
    const body = typeof init?.body === "string" ? init.body : "";
    return addressOf(asked).pathname === SET_ACTIVE &&
      pickBody.parse(JSON.parse(body)).organizationId === workspace.id
      ? Response.json(
          { code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION", message: "not a member" },
          { status: 403 },
        )
      : answered;
  };
};

const picksRefused = (api: Api): (() => number) => {
  let asked = 0;
  api.set(SET_ACTIVE, () => {
    asked += 1;
    throw new TypeError("the network is down");
  });
  return () => asked;
};

const openedWithTwo = async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  picksOpenAs(api, "Admin");
  const { picked, watching } = watchingPicks();
  const router = await openPageOutsideShell("/choose-workspace", api, watching);
  return { api, picked, router };
};

const thePicker = () => screen.findByRole("heading", { level: 1, name: PICKER_WORDS.heading });

const refusal = () => screen.getByRole("alert").textContent;

it("shows a member of two workspaces their role in each", async () => {
  const { picked, router } = await openedWithTwo();

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
  expect(await screen.findByRole("heading", { level: 1, name: "Members" })).toBeDefined();
  expect(await switcher(NORTHERN)).toBeDefined();
  expect(picked, "the button opened a different workspace").toEqual([NORTHERN.id]);
});

it("skips the picker for a workspace joined after sign-in", async () => {
  const api = holding([{ workspace: NORTHERN, role: "Editor" }]);
  picksOpenAs(api, "Editor");
  const { picked, watching } = watchingPicks();
  const router = await openPageOutsideShell("/choose-workspace", api, watching);

  await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Editor.path));
  expect(await screen.findByRole("heading", { level: 1, name: NEW_QUESTION.name })).toBeDefined();
  expect(await switcher(NORTHERN)).toBeDefined();
  const you = within(screen.getByRole("banner")).getByRole("button", { name: ADA.displayName });
  fireEvent.keyDown(you, { key: "Enter" });
  expect((await screen.findByRole("menu", { name: ADA.displayName })).textContent).toContain(
    "Editor",
  );
  expect(screen.queryByRole("heading", { level: 1, name: PICKER_WORDS.heading })).toBeNull();
  expect(picked, "the only workspace was opened with a different id").toEqual([NORTHERN.id]);
});

it("does not retry a refused pick of the only workspace", async () => {
  const api = holding([NORTHERN_ROW]);
  const picks = picksRefused(api);
  const workspaces = holdProcedure(api, "person.workspaces");
  await openPageOutsideShell("/choose-workspace", api);
  await workspaces.asked;

  await settlingAfter(() => {
    workspaces.resolve();
  });

  expect(refusal()).toMatch(/\S/);
  expect(await thePicker()).toBeDefined();
  expect(picks(), "a refused pick was sent again").toBe(1);
});

it("keeps the list and alerts when a pick is refused", async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  picksRefused(api);
  await openPageOutsideShell("/choose-workspace", api);
  const picked = await screen.findByRole("button", { name: HOLME.name });
  picked.focus();

  fireEvent.click(picked);

  await waitFor(() => expect(refusal()).toMatch(/\S/));
  expect(document.activeElement).toBe(picked);
  expect(screen.getByRole("button", { name: NORTHERN.name })).toBeDefined();
});

it("sends a person with no workspace to No Workspace Yet", async () => {
  const api = holding([]);
  const router = await openPageOutsideShell("/choose-workspace", api);

  expect(
    await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
  ).toBeDefined();
  expect(router.state.location.pathname).toBe("/no-workspace");
  expect(screen.getByRole("button", { name: SIGN_OUT })).toBeDefined();
});

it("offers Try Again when the workspace list fails to load", async () => {
  const api = holding([NORTHERN_ROW, HOLME_ROW]);
  const listed = api.get("person.workspaces");
  api.set("person.workspaces", () => {
    throw new TypeError("the network is down");
  });
  const unread = holdProcedure(api, "person.workspaces");
  await openPageOutsideShell("/choose-workspace", api);
  await unread.asked;

  await settlingAfter(() => {
    unread.resolve();
  });

  expect(refusal()).toMatch(/\S/);
  expect(await thePicker()).toBeDefined();
  expect(screen.queryByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeNull();

  api.set("person.workspaces", () => listed?.());
  fireEvent.click(screen.getByRole("button", { name: FAILED_PAGE.retry }));

  expect(await screen.findByRole("button", { name: NORTHERN.name })).toBeDefined();
  expect(screen.getByRole("button", { name: HOLME.name })).toBeDefined();
});

it("hides and names a workspace the person was removed from", async () => {
  const { api, picked, router } = await openedWithTwo();
  const taken = await screen.findByRole("button", { name: HOLME.name });
  removedFrom(HOLME);
  api.set("person.workspaces", () => read([NORTHERN_ROW]));
  taken.focus();

  fireEvent.click(taken);

  await waitFor(() => expect(refusal()).toContain(HOLME.name));
  expect(await thePicker()).toBeDefined();
  expect(screen.queryByRole("button", { name: HOLME.name })).toBeNull();
  const stillMine = screen.getByRole("button", { name: NORTHERN.name });
  expect(document.activeElement, "focus is not on the remaining workspace").toBe(stillMine);

  await userEvent.keyboard("{Enter}");

  await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Admin.path));
  expect(picked, "Enter opened a different workspace from the one remaining").toEqual([
    HOLME.id,
    NORTHERN.id,
  ]);
});
