import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  anAdminOver,
  MEMBERS_PAGE,
  membersRegion,
  personHeading,
  thePage,
} from "@test/people/member-pages.ts";
import { holdProcedure, type Api } from "@test/stubbed-api.ts";
import { ADA, adaAt, aRefusalAnswer, HEDY, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const NOT_A_MEMBER = aRefusalAnswer("not-a-member", "unauthenticated", 401);

const ROLE_CHANGED = read({ personId: ADA.personId, previousRole: "Admin", role: "Editor" });

const anAdminBesideAnother = () => anAdminOver([ADA, HEDY]);

const openedByName = async (name: string) => {
  fireEvent.click(await waitFor(() => membersRegion().getByRole("link", { name })));
  await personHeading(name);
};

const backToMembers = async (router: Awaited<ReturnType<typeof openAt>>) => {
  act(() => {
    router.history.back();
  });
  await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS_PAGE));
  await waitFor(() => membersRegion().getByRole("heading", { level: 2, name: "Members" }));
};

const leftForNoWorkspace = async (router: Awaited<ReturnType<typeof openAt>>) => {
  await waitFor(() => expect(router.state.location.pathname).toBe("/no-workspace"));
  expect(await screen.findByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeDefined();
};

const describing = (control: HTMLElement): string =>
  document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

const describingWhoever = (control: HTMLElement, name: string): string =>
  describing(control).replaceAll(name, "…");

const removalOf = () => within(thePage().getByRole("region", { name: "Removal" }));

const leavingTheWorkspace = (api: Api, removed: () => unknown) => {
  api.set("members.remove", () => {
    api.set("session.member", () => NOT_A_MEMBER);
    api.set("members.list", () => NOT_A_MEMBER);
    api.set("person.workspaces", () => read([]));
    return removed();
  });
};

describe("a member's own page", () => {
  it("demoting yourself warns you, then opens the Editor home", async () => {
    const api = anAdminBesideAnother();
    api.set("members.changeRole", () => {
      api.set("session.member", () => adaAt("Editor"));
      api.set("members.list", () => read([{ ...ADA, role: "Editor" }, HEDY]));
      return ROLE_CHANGED;
    });
    const router = await openAt(MEMBERS_PAGE, api);

    await openedByName(HEDY.displayName);
    fireEvent.click(thePage().getByRole("radio", { name: "Editor" }));
    const changeHedy = within(thePage().getByRole("region", { name: "Role" })).getByRole("button", {
      name: "Change Role",
    });
    const ofAnother = describingWhoever(changeHedy, HEDY.displayName);
    await backToMembers(router);
    await openedByName(ADA.displayName);
    fireEvent.click(thePage().getByRole("radio", { name: "Editor" }));
    const commit = within(thePage().getByRole("region", { name: "Role" })).getByRole("button", {
      name: "Change Role",
    });
    expect(describing(commit)).toMatch(/\S/);
    expect(
      describingWhoever(commit, ADA.displayName),
      "your own demotion has the same description as another member's",
    ).not.toBe(ofAnother);
    fireEvent.click(commit);

    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Editor.path));
    expect(screen.getByRole("heading", { level: 1, name: "New Question" })).toBeDefined();
    const said = screen.getAllByRole("status").filter((each) => /\S/.test(each.textContent));
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toMatch(/\bEditor\b/);

    const avatar = within(screen.getByRole("banner")).getByRole("button", {
      name: new RegExp(ADA.displayName),
    });
    fireEvent.keyDown(avatar, { key: "Enter" });
    const you = await screen.findByRole("menu", { name: new RegExp(ADA.displayName) });
    expect(you.textContent).toContain("Editor");
    expect(you.textContent).not.toContain("Admin");
    fireEvent.keyDown(you, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    act(() => {
      router.history.back();
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS_PAGE));
    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to New Question" })).toBeDefined();
  });
});

describe("removing yourself from your member page", () => {
  it("an Admin who removes themself passes through the workspace chooser", async () => {
    const api = anAdminBesideAnother();
    leavingTheWorkspace(api, () => read({}));
    const router = await openAt(MEMBERS_PAGE, api);

    await openedByName(HEDY.displayName);
    fireEvent.click(removalOf().getByRole("button", { name: "Remove Member" }));
    const ofAnother = describingWhoever(
      await waitFor(() => removalOf().getByRole("button", { name: "Remove" })),
      HEDY.displayName,
    );
    await backToMembers(router);
    await openedByName(ADA.displayName);
    const asked = removalOf().getByRole("button", { name: "Remove Member" });
    expect(describing(asked)).toMatch(/\S/);
    expect(
      describing(asked),
      "your own removal's description names you in the third person",
    ).not.toContain(ADA.displayName);
    fireEvent.click(asked);
    const confirm = await waitFor(() => removalOf().getByRole("button", { name: "Remove" }));
    expect(describing(confirm)).toMatch(/\S/);
    expect(
      describingWhoever(confirm, ADA.displayName),
      "your own removal has the same confirmation as another member's",
    ).not.toBe(ofAnother);
    const visited: string[] = [];
    router.subscribe("onResolved", ({ toLocation }) => {
      visited.push(toLocation.pathname);
    });
    fireEvent.click(confirm);

    await leftForNoWorkspace(router);
    expect(visited, "the person never reached the workspace chooser").toContain(
      "/choose-workspace",
    );
  });

  it("pressing Remove twice on yourself sends one request", async () => {
    const api = anAdminBesideAnother();
    leavingTheWorkspace(api, () => read({}));
    const removal = holdProcedure(api, "members.remove");
    const router = await openAt(memberPageOf(ADA.personId), api);
    await personHeading(ADA.displayName);
    fireEvent.click(removalOf().getByRole("button", { name: "Remove Member" }));
    const confirm = await waitFor(() => removalOf().getByRole("button", { name: "Remove" }));

    act(() => {
      confirm.focus();
    });
    fireEvent.click(confirm);
    await removal.asked;
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(confirm);
    removal.resolve();

    await leftForNoWorkspace(router);
    expect(removal.asks, "the second press sent another remove request").toBe(1);
  });
});
