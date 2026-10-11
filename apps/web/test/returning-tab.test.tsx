import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import { MEMBERS_LOADING } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members-address.ts";
import { HOMES } from "@/shared/navigation.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  adminsAreaOffered,
  band,
  GRACE,
  HEDY,
  heldBack,
  HOLME,
  openAt,
  openTab,
  read,
  switchedInAnotherTab,
  switcher,
  switcherDrawn,
  tickOf,
  type Api,
} from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

const SAID = `You switched to ${HOLME.name} in another tab.`;

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

const INVITATION = "/invitations/01JINVITED0000000000000000";

const SET_ACTIVE = "/organization/set-active";

const said = () => band().getByRole("status").textContent;

/** The session moves to Holme Valley Tools as this tab's own request for it is answered. */
const movingTheSession = (api: Api, request: string, answer: unknown) => {
  api.set(request, () => {
    switchedInAnotherTab(api, "Viewer");
    return answer;
  });
};

/** Landed in Holme Valley Tools by this tab's own doing, which another tab had no part in. */
const landedAtHome = async (router: Awaited<ReturnType<typeof openAt>>) => {
  // Found afresh at each look: a pick and a join are made on a page with a band of its own.
  await waitFor(() => expect(switcherDrawn(HOLME)).not.toBeNull());
  expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
};

/** The hidden tab is shown again, so each read a page is drawing is asked again. */
const shownAgain = () => {
  globalThis.dispatchEvent(new Event("visibilitychange"));
};

/** Members under Northern Tooling, its list asked again and that answer held back. */
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
    expect(screen.getByText(MEMBERS_LOADING)).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBERS);
    await waitFor(() => expect(band().getByRole("status").textContent).toBe(SAID));

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("redraws a member page as the person is there", async () => {
    const api = adaAnAdmin();
    const router = await openAt(GRACES_PAGE, api);
    await screen.findByRole("radio", { name: "Admin", checked: true });
    switchedInAnotherTab(api, "Admin", [ADA, { ...GRACE, role: "Viewer" }]);

    shownAgain();

    await switcher(HOLME);
    expect(await screen.findByRole("radio", { name: "Viewer", checked: true })).toBeDefined();
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(said()).toBe(SAID);
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
    fireEvent.click(await screen.findByRole("button", { name: INVITATION_WORDS.join(HOLME.name) }));

    await landedAtHome(router);
    await waitFor(() => expect(said()).toBe(""));
  });
});
