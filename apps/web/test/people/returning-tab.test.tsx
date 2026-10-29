import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { switchedInAnotherTab } from "@/app/words.ts";
import { MEMBERS_LOADING } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack, type Api } from "@test/stubbed-api.ts";
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

const SAID = switchedInAnotherTab(HOLME.name);

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
  const list = heldBack(api, "members.list", answer);
  // Asked apart from the member read: two reads in one request are answered together.
  openTab("Invitations");
  openTab("Members");
  await list.asked;
  return { router, list };
};

describe("a tab shown again after a switch in another tab", () => {
  it("draws no row of the workspace left", async () => {
    const api = adaAnAdmin();
    const { router, list } = await openMembersWithTheListOnItsWay(api, read([ADA, HEDY]));
    expect(tickOf(GRACE.displayName)).not.toBeNull();
    api.set("session.member", () => adaAt("Admin", HOLME));

    shownAgain();

    await switcher(HOLME);
    expect(tickOf(GRACE.displayName), "a row of the workspace left is drawn").toBeNull();
    expect(await screen.findByText(MEMBERS_LOADING)).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBERS);
    await waitFor(() => expect(band().getByRole("status").textContent).toBe(SAID));

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("redraws a member page as the person is there", async () => {
    const api = adaAnAdmin();
    const router = await openAt(GRACES_PAGE, api);
    await screen.findByRole("radio", { name: "Admin", checked: true });
    aSwitchInAnotherTab(api, "Admin", [ADA, { ...GRACE, role: "Viewer" }]);

    shownAgain();

    await switcher(HOLME);
    expect(await screen.findByRole("radio", { name: "Viewer", checked: true })).toBeDefined();
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(said()).toBe(SAID);
  });

  it("says it no longer once the person moves on", async () => {
    const api = adaAnAdmin();
    const router = await openAt(MEMBERS, api);
    aSwitchInAnotherTab(api, "Admin");
    shownAgain();
    await waitFor(() => expect(said()).toBe(SAID));

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

    await waitFor(() => expect(adminsAreaOffered(), "the role is read again").toBeNull());
    expect(tickOf(GRACE.displayName), "the list held was dropped").not.toBeNull();
    expect(said()).toBe("");

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName), "the read on its way").not.toBeNull());
  });
});

describe("a tab that changes workspace itself", () => {
  it("says nothing of another tab after its own switch", async () => {
    const api = adaAnAdmin();
    movingTheSession(api, SET_ACTIVE, { id: HOLME.id });
    const router = await openAt(MEMBERS, api);

    fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });

  it("says nothing of another tab after a pick", async () => {
    const api = adaAnAdmin();
    movingTheSession(api, SET_ACTIVE, { id: HOLME.id });
    const router = await openAt(MEMBERS, api);

    await router.navigate({ to: "/choose-workspace" });
    fireEvent.click(await screen.findByRole("button", { name: HOLME.name }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });

  it("says nothing of another tab after a join", async () => {
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
