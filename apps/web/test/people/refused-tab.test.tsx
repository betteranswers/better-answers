import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { holdProcedure, type Api } from "@test/stubbed-api.ts";
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
  HOLME,
  LOST,
  NORTHERN,
  openAt,
  openTab,
  read,
  switcher,
  switcherDrawn,
  tickOf,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const SWITCHED = aRefusalAnswer("workspace-switched", "conflict", 409);

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

const KAYS = {
  invitationId: "01JKAY0000000000000000000A",
  address: "kay@example.test",
  role: "Viewer",
  status: "waiting",
  invitedAt: "2026-10-01T09:00:00.000Z",
  expiresAt: "2026-10-08T09:00:00.000Z",
  invitedBy: ADA.displayName,
};

const switchedOnceThen = (api: Api, procedure: string, after: unknown) => {
  let refused = false;
  api.set(procedure, () => {
    if (refused) return after;
    refused = true;
    return SWITCHED;
  });
};

const openGracesPage = async (api: Api) => {
  const router = await openAt(GRACES_PAGE, api);
  await screen.findByRole("radio", { name: "Editor" });
  return router;
};

const changeGracesRole = () => {
  fireEvent.click(screen.getByRole("radio", { name: "Editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Change Role" }));
};

const landedInHolme = async () => {
  await switcher(HOLME);
  await waitFor(() => expect(band().getByRole("alert").textContent).toMatch(/\S/));
};

const bandBlanksWatched = () => {
  let blanked = false;
  const watching = new MutationObserver(() => {
    if (switcherDrawn(NORTHERN) === null && switcherDrawn(HOLME) === null) blanked = true;
  });
  watching.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => {
    watching.disconnect();
    return blanked;
  };
};

const memberHeldAndCounted = (api: Api) => {
  const member = holdProcedure(api, "session.member", adaAt("Admin", HOLME));
  const answer = api.get("session.member");
  let reads = 0;
  api.set("session.member", () => {
    reads += 1;
    return answer?.();
  });
  const askedAgainOnceSettled = async (refusal: { readonly resolve: () => void }) => {
    const before = reads;
    refusal.resolve();
    await waitFor(() =>
      expect(reads, "the refused action did not reload the membership").toBeGreaterThan(before),
    );
  };
  return { ...member, askedAgainOnceSettled };
};

const refusedAfterASwitch = async () => {
  const api = adaAnAdmin();
  const router = await openGracesPage(api);
  aSwitchInAnotherTab(api, "Viewer");
  api.set("members.changeRole", () => SWITCHED);
  changeGracesRole();
  return router;
};

const refusedWithTheMemberUnread = async () => {
  const api = adaAnAdmin();
  const router = await openGracesPage(api);
  api.set("session.member", () => LOST);
  api.set("members.changeRole", () => SWITCHED);
  changeGracesRole();
  return { api, router };
};

describe("a tab after the workspace was switched in another tab", () => {
  it("sends a refused tab home with an alert explaining why", async () => {
    const router = await refusedAfterASwitch();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
    expect(screen.queryByText(NORTHERN.name, { exact: false })).toBeNull();
  });

  it("goes home when the refusal arrives on another page", async () => {
    const api = adaAnAdmin();
    const refusal = holdProcedure(api, "members.changeRole", SWITCHED);
    const router = await openGracesPage(api);

    changeGracesRole();
    await router.navigate({ to: "/people/groups" });
    aSwitchInAnotherTab(api, "Viewer");
    refusal.resolve();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
  });

  it("reloads the membership once when several reads are refused", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");
    switchedOnceThen(api, "members.list", read([ADA, HEDY]));
    switchedOnceThen(api, "members.groups", read([]));
    const member = holdProcedure(api, "session.member", adaAt("Admin", HOLME));
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
    expect(memberReads, "each refusal reloaded the membership").toBe(1);
  });

  it("keeps the top band when a refusal arrives mid-redirect", async () => {
    const api = adaAnAdmin();
    const second = holdProcedure(api, "members.endEverySignInAndToken", SWITCHED);
    await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");
    api.set("members.changeRole", () => SWITCHED);
    const member = memberHeldAndCounted(api);
    const blanked = bandBlanksWatched();

    fireEvent.click(screen.getByRole("button", { name: "Sign Out of This Workspace" }));
    await second.asked;
    changeGracesRole();
    await member.asked;
    await member.askedAgainOnceSettled(second);
    member.resolve();
    await landedInHolme();

    expect(blanked(), "the top band went blank while the membership reloaded").toBe(false);
  });

  it("keeps the top band when three refusals arrive mid-redirect", async () => {
    const api = adaAnAdmin();
    const ended = holdProcedure(api, "members.endEverySignInAndToken", SWITCHED);
    const changed = holdProcedure(api, "members.changeRole", SWITCHED);
    const removed = holdProcedure(api, "members.remove", SWITCHED);
    await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");
    const member = memberHeldAndCounted(api);
    const blanked = bandBlanksWatched();

    // Send these separately, because actions batched in one request get one answer.
    fireEvent.click(screen.getByRole("button", { name: "Sign Out of This Workspace" }));
    await ended.asked;
    changeGracesRole();
    await changed.asked;
    const removal = screen.getByRole("region", { name: /^Removal$/ });
    fireEvent.click(within(removal).getByRole("button", { name: "Remove Member" }));
    fireEvent.click(within(removal).getByRole("button", { name: /^Remove$/ }));
    await removed.asked;
    for (const refusal of [changed, ended, removed]) await member.askedAgainOnceSettled(refusal);
    member.resolve();
    await landedInHolme();

    expect(blanked(), "the top band went blank while the membership reloaded").toBe(false);
  });

  it("shows no workspace name when the membership cannot load", async () => {
    const { router } = await refusedWithTheMemberUnread();

    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");
  });

  it("shows the alert once the membership loads on retry", async () => {
    const { api, router } = await refusedWithTheMemberUnread();
    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");

    aSwitchInAnotherTab(api, "Viewer");
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
  });

  it("clears the alert once the person goes to another page", async () => {
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

  it("shows no rows from the old workspace after two refusals", async () => {
    const api = adaAnAdmin();
    api.set("members.changeRole", () => SWITCHED);
    const second = holdProcedure(api, "members.endEverySignInAndToken", SWITCHED);
    const router = await openGracesPage(api);
    aSwitchInAnotherTab(api, "Admin");

    fireEvent.click(screen.getByRole("button", { name: "Sign Out of This Workspace" }));
    // Send these separately, because batched actions share one answer and both would be held.
    await second.asked;
    changeGracesRole();
    await landedInHolme();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());

    await router.navigate({ to: "/people/groups" });
    const list = holdProcedure(api, "members.list", read([ADA, HEDY]));
    second.resolve();

    await screen.findByRole("tab", { name: "Members" });
    expect(router.state.location.pathname).toBe(MEMBERS);
    expect(tickOf(GRACE.displayName), "rows from the old workspace came back").toBeNull();
    expect(
      tickOf(HEDY.displayName),
      "the list showed rows before the new read finished",
    ).toBeNull();

    list.resolve();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
  });

  it("shows no invitations from the old workspace after a refusal", async () => {
    const api = adaAnAdmin();
    api.set("members.invitations", () => read([KAYS]));
    const refusal = holdProcedure(api, "members.cancelInvitation", SWITCHED);
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

    const invitations = holdProcedure(api, "members.invitations", read([]));
    openTab("Invitations");

    await screen.findByRole("radio", { name: /^Waiting/ });
    expect(tickOf(KAYS.address), "invitations from the old workspace came back").toBeNull();

    invitations.resolve();
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Invitations" })).getByRole("cell").textContent,
        "the empty list showed no message",
      ).toMatch(/\S/),
    );
  });

  it("stays on the page for a different conflict refusal", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    api.set("members.changeRole", () => aRefusalAnswer("changed-meanwhile", "conflict", 409));

    changeGracesRole();

    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Role" })).getByRole("alert").textContent,
      ).toMatch(/\S/),
    );
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(await switcher()).toBeDefined();
    expect(band().getByRole("alert").textContent).toBe("");
  });

  it("leaves no row marked or selected after going home", async () => {
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
      screen.getAllByRole("alert").filter((alert) => alert.textContent.trim() !== ""),
      "the refusal appeared in more than one alert",
    ).toHaveLength(1);
  });
});
