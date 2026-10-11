import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INVITATIONS_WORDS } from "@/features/people/invitation-words.ts";
import {
  BULK_WORDS,
  MEMBER_PAGE_WORDS,
  MEMBERS_LOADING,
} from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members-address.ts";
import { HOMES, type Role } from "@/shared/navigation.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  band,
  drawnWithNoWorkspace,
  GRACE,
  HOLME,
  LOST,
  NORTHERN,
  openAt,
  read,
  refusedWith,
  switcher,
  type Api,
} from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

/** What the api answers an action from a tab whose workspace the session has left. */
const SWITCHED = refusedWith("workspace-switched", "conflict", 409);

const SAID =
  "You changed workspace in another tab, so nothing was done here. Check which workspace this tab shows before you do it again.";

const MEMBERS = HOMES.Admin.path;

const GRACES_PAGE = memberPageOf(GRACE.personId);

/** In Holme Valley Tools only, so a row of hers is never one of the workspace left. */
const HEDY = { ...ADA, personId: "01JHEDY000000000000000000A", displayName: "Hedy" };

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

/** Another tab points the session at Holme Valley Tools, where Ada holds `role`. */
const switchedInAnotherTab = (api: Api, role: Role, members = [ADA, HEDY]) => {
  api.set("session.member", () => adaAt(role, HOLME));
  api.set("members.list", () => read(members));
  api.set("members.invitations", () => read([]));
};

/** An answer the api gives only once the test lets it; `asked` settles when the request arrives. */
const heldBack = (api: Api, procedure: string, answer: unknown) => {
  const asked = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  api.set(procedure, () => {
    asked.resolve();
    return held.promise.then(() => answer);
  });
  return { asked: asked.promise, resolve: held.resolve };
};

/** Grace's page under Northern Tooling, drawn as far as her role. */
const openGracesPage = async (api: Api) => {
  const router = await openAt(GRACES_PAGE, api);
  await screen.findByRole("radio", { name: "Editor" });
  return router;
};

const changeGracesRole = () => {
  fireEvent.click(screen.getByRole("radio", { name: "Editor" }));
  fireEvent.click(
    screen.getByRole("button", { name: MEMBER_PAGE_WORDS.makeRole(GRACE.displayName, "Editor") }),
  );
};

const tickOf = (name: string) => screen.queryByRole("checkbox", { name: `Select ${name}` });

const openTab = (name: string) => {
  const tab = screen.getByRole("tab", { name });
  // The registry's tabs open on a press, never on a click.
  fireEvent.mouseDown(tab);
};

/** The band names the session's workspace and says why the tab moved. */
const landedInHolme = async () => {
  await switcher(HOLME);
  await waitFor(() => expect(band().getByRole("alert").textContent).toBe(SAID));
};

describe("a tab whose workspace the session has left", () => {
  it("lands a refused tab home, its band saying why", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    switchedInAnotherTab(api, "Viewer");
    api.set("members.changeRole", () => SWITCHED);

    changeGracesRole();

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
    switchedInAnotherTab(api, "Viewer");
    refusal.resolve();

    await landedInHolme();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
  });

  it("draws no name of the workspace left when unread", async () => {
    const api = adaAnAdmin();
    const router = await openGracesPage(api);
    api.set("session.member", () => LOST);
    api.set("members.changeRole", () => SWITCHED);

    changeGracesRole();

    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");
  });

  it("draws no row of the workspace left, refused twice", async () => {
    const api = adaAnAdmin();
    api.set("members.changeRole", () => SWITCHED);
    const second = heldBack(api, "members.endEverySignInAndToken", SWITCHED);
    const router = await openGracesPage(api);
    switchedInAnotherTab(api, "Admin");

    fireEvent.click(screen.getByRole("button", { name: MEMBER_PAGE_WORDS.endEverySignInAndToken }));
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
    fireEvent.click(screen.getByRole("menuitem", { name: INVITATIONS_WORDS.cancel }));
    openTab("Members");
    switchedInAnotherTab(api, "Admin");
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
    api.set("members.changeRole", () => refusedWith("changed-meanwhile", "conflict", 409));

    changeGracesRole();

    expect(
      await screen.findByText("Another change to these members was made at the same moment.", {
        exact: false,
      }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe(GRACES_PAGE);
    expect(await switcher()).toBeDefined();
    expect(band().getByRole("alert").textContent).toBe("");
  });

  it("leaves no row marked or ticked once home", async () => {
    const api = adaAnAdmin();
    api.set("members.bulkChangeRole", () => SWITCHED);
    await openAt(MEMBERS, api);
    fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${GRACE.displayName}` }));
    switchedInAnotherTab(api, "Admin", [ADA, GRACE, HEDY]);

    fireEvent.click(screen.getByRole("button", { name: BULK_WORDS.changeRole.action }));
    fireEvent.click(
      await screen.findByRole("button", { name: BULK_WORDS.changeRole.commit(1, "Viewer") }),
    );

    await landedInHolme();
    await waitFor(() => expect(tickOf(HEDY.displayName)).not.toBeNull());
    expect(tickOf(GRACE.displayName)?.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getAllByText(SAID, { exact: false }),
      "a row or the page says it too",
    ).toHaveLength(1);
  });
});
