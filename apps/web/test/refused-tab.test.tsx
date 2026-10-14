import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INVITATIONS_WORDS } from "@/features/people/invitation-words.ts";
import { MEMBERS_LOADING } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members-address.ts";
import { HOMES } from "@/shared/navigation.ts";
import { refusalSentence, STOCK } from "@/shared/refusal-words.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  aRefusalAnswer,
  aSwitchInAnotherTab,
  band,
  changeTheTickedToViewer,
  drawnWithNoWorkspace,
  GRACE,
  HEDY,
  heldBack,
  HOLME,
  LOST,
  NORTHERN,
  openAt,
  openTab,
  read,
  switcher,
  switcherDrawn,
  tickOf,
  type Api,
} from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

/** What the api answers an action from a tab whose workspace the session has left. */
const SWITCHED = aRefusalAnswer("workspace-switched", "conflict", 409);

const SAID = refusalSentence({}, "workspace-switched", "conflict");

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

/** Waiting in Northern Tooling only. */
const KAYS = {
  invitationId: "01JKAY0000000000000000000A",
  address: "kay@example.test",
  role: "Viewer",
  status: "waiting",
  invitedAt: "2026-10-01T09:00:00.000Z",
  expiresAt: "2026-10-08T09:00:00.000Z",
  invitedBy: ADA.displayName,
};

/** Grace's page under Northern Tooling, drawn as far as her role. */
const openGracesPage = async (api: Api) => {
  const router = await openAt(GRACES_PAGE, api);
  await screen.findByRole("radio", { name: "Editor" });
  return router;
};

const changeGracesRole = () => {
  fireEvent.click(screen.getByRole("radio", { name: "Editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Change Role" }));
};

/** The band names the session's workspace and says why the tab moved. */
const landedInHolme = async () => {
  await switcher(HOLME);
  await waitFor(() => expect(band().getByRole("alert").textContent).toBe(SAID));
};

/** Refused once another browser tab took the session to Holme Valley Tools, Ada a Viewer there. */
const refusedAfterASwitch = async () => {
  const api = adaAnAdmin();
  const router = await openGracesPage(api);
  aSwitchInAnotherTab(api, "Viewer");
  api.set("members.changeRole", () => SWITCHED);
  changeGracesRole();
  return router;
};

/** Refused while the member read fails, so no role is held to take the tab home. */
const refusedWithTheMemberUnread = async () => {
  const api = adaAnAdmin();
  const router = await openGracesPage(api);
  api.set("session.member", () => LOST);
  api.set("members.changeRole", () => SWITCHED);
  changeGracesRole();
  return { api, router };
};

describe("a tab whose workspace the session has left", () => {
  it("lands a refused tab home, its band saying why", async () => {
    const router = await refusedAfterASwitch();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
    expect(screen.queryByText(NORTHERN.name, { exact: false })).toBeNull();
  });

  it("lands home when the refusal follows the person elsewhere", async () => {
    const api = adaAnAdmin();
    const refusal = heldBack(api, "members.changeRole", SWITCHED);
    const router = await openGracesPage(api);

    changeGracesRole();
    await router.navigate({ to: "/people/groups" });
    aSwitchInAnotherTab(api, "Viewer");
    refusal.resolve();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
  });

  it("reads the member once when reads are refused together", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");
    for (const [procedure, after] of [
      ["members.list", read([ADA, HEDY])],
      ["members.groups", read([])],
    ] as const) {
      let refused = false;
      api.set(procedure, () => {
        if (refused) return after;
        refused = true;
        return SWITCHED;
      });
    }
    const member = heldBack(api, "session.member", adaAt("Admin", HOLME));
    const answer = api.get("session.member");
    let memberReads = 0;
    api.set("session.member", () => {
      memberReads += 1;
      return answer?.();
    });

    await router.navigate({ to: MEMBERS });
    await member.asked;
    member.resolve();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(memberReads, "each refusal read the member again").toBe(1);
  });

  it("keeps the band drawn when a refusal lands mid-follow", async () => {
    const api = adaAnAdmin();
    const second = heldBack(api, "members.endEverySignInAndToken", SWITCHED);
    await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");
    api.set("members.changeRole", () => SWITCHED);
    const member = heldBack(api, "session.member", adaAt("Admin", HOLME));

    fireEvent.click(screen.getByRole("button", { name: "End Every Sign-In and Token Here" }));
    await second.asked;
    changeGracesRole();
    await member.asked;
    second.resolve();
    // Over the stub server, so the second refusal is heard only after a turn of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(switcherDrawn(NORTHERN), "the band blanked while the member was read").not.toBeNull();
    member.resolve();
    await landedInHolme();
  });

  it("draws no name of the workspace left when unread", async () => {
    const { router } = await refusedWithTheMemberUnread();

    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");
  });

  it("keeps the sentence when the member read answers later", async () => {
    const { api, router } = await refusedWithTheMemberUnread();
    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");

    aSwitchInAnotherTab(api, "Viewer");
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
  });

  it("says it no longer once the person moves on", async () => {
    const router = await refusedAfterASwitch();
    await landedInHolme();

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Areas" })).getByRole("link", {
        name: "Knowledge",
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).not.toBe(HOMES.Viewer.path));
    expect(band().getByRole("alert").textContent).toBe("");
  });

  it("draws no row of the workspace left, refused twice", async () => {
    const api = adaAnAdmin();
    api.set("members.changeRole", () => SWITCHED);
    const second = heldBack(api, "members.endEverySignInAndToken", SWITCHED);
    const router = await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");

    fireEvent.click(screen.getByRole("button", { name: "End Every Sign-In and Token Here" }));
    // Sent apart: two actions in one request are answered together, so both would be held back.
    await second.asked;
    changeGracesRole();
    await landedInHolme();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());

    await router.navigate({ to: "/people/groups" });
    const list = heldBack(api, "members.list", read([ADA, HEDY]));
    second.resolve();

    await screen.findByRole("tab", { name: "Members" });
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName), "a refused change put the left rows back").toBeNull();
    expect(screen.getByText(MEMBERS_LOADING)).toBeDefined();

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("draws no invitation of the workspace left once refused", async () => {
    const api = adaAnAdmin();
    api.set("members.invitations", () => read([KAYS]));
    const refusal = heldBack(api, "members.cancelInvitation", SWITCHED);
    await openAt(MEMBERS, api);
    openTab("Invitations");

    fireEvent.keyDown(await screen.findByRole("button", { name: `Actions for ${KAYS.address}` }), {
      key: "Enter",
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel" }));
    openTab("Members");
    aSwitchInAnotherTab(api, "Admin");
    refusal.resolve();
    await landedInHolme();

    const invitations = heldBack(api, "members.invitations", read([]));
    openTab("Invitations");

    await screen.findByRole("radio", { name: /^Waiting/ });
    expect(tickOf(KAYS.address), "a refused cancel put the left rows back").toBeNull();
    expect(screen.getByText(INVITATIONS_WORDS.loading)).toBeDefined();

    invitations.resolve();
    expect(await screen.findByText(INVITATIONS_WORDS.noneIn.waiting)).toBeDefined();
  });

  it("stays put on another refusal of class conflict", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    api.set("members.changeRole", () => aRefusalAnswer("changed-meanwhile", "conflict", 409));

    changeGracesRole();

    expect(await screen.findByText(STOCK.changed)).toBeDefined();
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(await switcher()).toBeDefined();
    expect(band().getByRole("alert").textContent).toBe("");
  });

  it("leaves no row marked or ticked once home", async () => {
    const api = adaAnAdmin();
    api.set("members.bulkChangeRole", () => SWITCHED);
    await openAt(MEMBERS, api);
    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${GRACE.displayName}` }));
    aSwitchInAnotherTab(api, "Admin", [ADA, GRACE, HEDY]);

    await changeTheTickedToViewer();

    await landedInHolme();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
    expect(tickOf(GRACE.displayName)?.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getAllByText(SAID, { exact: false }),
      "a row or the page says it too",
    ).toHaveLength(1);
  });
});
