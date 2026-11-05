import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure, type Api } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  adminsAreaOffered,
  aSwitchInAnotherTab,
  band,
  GRACE,
  HEDY,
  HOLME,
  openAt,
  openTab,
  read,
  switcher,
  switcherDrawn,
  tickOf,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS = HOMES.Admin.path;

const GROUPS = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Groups");

const GRACES_PAGE = memberPageOf(GRACE.personId);

const INVITATION = "/invitations/01JINVITED0000000000000000";

const SET_ACTIVE = "/organization/set-active";

const said = () => band().getByRole("status").textContent;

const movingTheSession = (api: Api, request: string, answer: unknown) => {
  api.set(request, () => {
    aSwitchInAnotherTab(api, "Viewer");
    return answer;
  });
};

const landedAtHome = async (router: Awaited<ReturnType<typeof openAt>>) => {
  await waitFor(() => expect(switcherDrawn(HOLME)).not.toBeNull());
  expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
};

const shownAgain = () => {
  globalThis.dispatchEvent(new Event("visibilitychange"));
};

const openMembersWithTheListOnItsWay = async (api: Api, answer: unknown) => {
  const router = await openAt(MEMBERS, api);
  await waitFor(() => expect(tickOf(GRACE.displayName)).not.toBeNull());
  const list = holdProcedure(api, "members.list", answer);
  // Read the list separately, because reads batched in one request get one answer.
  openTab("Invitations");
  openTab("Members");
  await list.asked;
  return { router, list };
};

describe("a tab shown again after another tab switched workspace", () => {
  it("shows no rows from the old workspace", async () => {
    const api = adaAnAdmin();
    const { router, list } = await openMembersWithTheListOnItsWay(api, read([ADA, HEDY]));
    expect(tickOf(GRACE.displayName)).not.toBeNull();
    api.set("session.member", () => adaAt("Admin", HOLME));

    shownAgain();

    await switcher(HOLME);
    expect(tickOf(GRACE.displayName), "a row from the old workspace is shown").toBeNull();
    expect(
      tickOf(HEDY.displayName),
      "the list showed rows before the new read finished",
    ).toBeNull();
    expect(router.state.location.pathname).toBe(MEMBERS);
    await waitFor(() => expect(band().getByRole("status").textContent).toContain(HOLME.name));

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("reloads a member page with the member's new details", async () => {
    const api = adaAnAdmin();
    const router = await openAt(GRACES_PAGE, api);
    await screen.findByRole("radio", { name: "Admin", checked: true });
    aSwitchInAnotherTab(api, "Admin", [ADA, { ...GRACE, role: "Viewer" }]);

    shownAgain();

    await switcher(HOLME);
    expect(await screen.findByRole("radio", { name: "Viewer", checked: true })).toBeDefined();
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(said(), "the top band did not name the new workspace").toContain(HOLME.name);
  });

  it("clears the message once the person goes to another page", async () => {
    const api = adaAnAdmin();
    const router = await openAt(MEMBERS, api);
    aSwitchInAnotherTab(api, "Admin");
    shownAgain();
    await waitFor(() => expect(said()).toContain(HOLME.name));

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Control Centre" })).getByRole("link", {
        name: "Groups",
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe(GROUPS.path));
    expect(said()).toBe("");
  });

  it("keeps the list when only the role changes", async () => {
    const api = adaAnAdmin();
    const { list } = await openMembersWithTheListOnItsWay(api, read([ADA, GRACE, HEDY]));
    api.set("session.member", () => adaAt("Editor"));

    shownAgain();

    await waitFor(() =>
      expect(adminsAreaOffered(), "the Admin area stayed after the role changed").toBeNull(),
    );
    expect(
      tickOf(GRACE.displayName),
      "the list was cleared though only the role changed",
    ).not.toBeNull();
    expect(said()).toBe("");

    list.resolve();
    await waitFor(() =>
      expect(tickOf(HEDY.displayName), "the pending list read never finished").not.toBeNull(),
    );
  });
});

describe("a tab that switches workspace itself", () => {
  it("shows no other-tab message after its own switch", async () => {
    const api = adaAnAdmin();
    movingTheSession(api, SET_ACTIVE, { id: HOLME.id });
    const router = await openAt(MEMBERS, api);

    fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });

  it("shows no other-tab message after choosing a workspace", async () => {
    const api = adaAnAdmin();
    movingTheSession(api, SET_ACTIVE, { id: HOLME.id });
    const router = await openAt(MEMBERS, api);

    await router.navigate({ to: "/choose-workspace" });
    fireEvent.click(await screen.findByRole("button", { name: HOLME.name }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });

  it("shows no other-tab message after joining a workspace", async () => {
    const api = adaAnAdmin();
    api.set("person.invitation", () =>
      read({ workspaceName: HOLME.name, invitedBy: GRACE.displayName, role: "Viewer" }),
    );
    movingTheSession(api, "person.acceptInvitation", read({}));
    const router = await openAt(MEMBERS, api);

    await router.navigate({ href: INVITATION });
    fireEvent.click(await screen.findByRole("button", { name: "Join Workspace" }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });
});
