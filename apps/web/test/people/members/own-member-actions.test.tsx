import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { homeNowSaid } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { anAdminOver, membersRegion, personHeading, thePage } from "@test/people/member-pages.ts";
import { heldBack, type Api } from "@test/stubbed-api.ts";
import { ADA, adaAt, aRefusalAnswer, HEDY, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

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
  it("demoting yourself says so, then lands on Editor's home", async () => {
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
      "their own demotion is described as another member's is",
    ).not.toBe(ofAnother);
    fireEvent.click(commit);

    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Editor.path));
    expect(screen.getByRole("heading", { level: 1, name: "Ask" })).toBeDefined();
    const said = screen.getAllByRole("status").filter((each) => /\S/.test(each.textContent));
    expect(said).toHaveLength(1);
    expect(said[0]?.textContent).toBe(homeNowSaid("Editor"));
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

describe("removing a member from their page", () => {
  it("an Admin removing themself leaves through the workspace chooser", async () => {
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
    expect(describing(asked), "their own removal names them as it would another").not.toContain(
      ADA.displayName,
    );
    fireEvent.click(asked);
    const confirm = await waitFor(() => removalOf().getByRole("button", { name: "Remove" }));
    expect(describing(confirm)).toMatch(/\S/);
    expect(
      describingWhoever(confirm, ADA.displayName),
      "their own removal is confirmed as another member's is",
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

  it("removing yourself, pressed twice, asks once and still leaves", async () => {
    const api = anAdminBesideAnother();
    leavingTheWorkspace(api, () => read({}));
    const removal = heldBack(api, "members.remove");
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
    expect(removal.asks, "the second press asked the api again").toBe(1);
  });
});
