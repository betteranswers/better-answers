import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { homeNowSaid } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { ROLE_UNREAD } from "@/features/people/members/self-action.tsx";
import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { type Api } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  adminsAreaOffered,
  aRefusalAnswer,
  drawnWithNoWorkspace,
  FORBIDDEN,
  GRACE,
  HOLME,
  LOST,
  openAt,
  read,
  switcher,
  switcherDrawn,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const CALDER = { id: "c", name: "Calder Pressings" };

const NOT_A_MEMBER = aRefusalAnswer("not-a-member", "unauthenticated", 401);

const SET_ACTIVE = "/organization/set-active";

const MEMBER_PAGE = memberPageOf(ADA.personId);

const ROLE_CHANGED = read({ personId: ADA.personId, previousRole: "Admin", role: "Editor" });

const demotingHerself = async (api: Api, memberAfter: Parameters<Api["set"]>[1]) => {
  api.set("members.changeRole", () => {
    api.set("session.member", memberAfter);
    api.set("members.list", () => read([{ ...ADA, role: "Editor" }, GRACE]));
    return ROLE_CHANGED;
  });
  const router = await openAt(MEMBER_PAGE, api);
  fireEvent.click(await screen.findByRole("radio", { name: "Editor" }));
  fireEvent.click(screen.getByRole("button", { name: "Change Role" }));
  return router;
};

describe("a change to the reader's own member", () => {
  it("lands a self-removed Admin at the chooser, drawing no role", async () => {
    const api = adaAnAdmin();
    const landing = Promise.withResolvers<void>();
    api.set("members.remove", () => {
      api.set("session.member", () => NOT_A_MEMBER);
      api.set("members.list", () => NOT_A_MEMBER);
      api.set("person.workspaces", () =>
        read([
          { workspace: HOLME, role: "Viewer" },
          { workspace: CALDER, role: "Viewer" },
        ]),
      );
      api.set("person.secondFactor", () => landing.promise.then(() => FORBIDDEN));
      return read({});
    });
    const router = await openAt(MEMBER_PAGE, api);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Member" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(switcherDrawn(), "the band names the workspace left").toBeNull());
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();

    landing.resolve();
    expect(await screen.findByRole("button", { name: HOLME.name })).toBeDefined();
    expect(router.state.location.pathname).toBe("/choose-workspace");
    expect(screen.queryByRole("navigation", { name: "Areas" })).toBeNull();
  });

  it("drops the left workspace's name when a switch's re-read fails", async () => {
    const api = adaAnAdmin();
    api.set(SET_ACTIVE, () => {
      api.set("session.member", () => LOST);
      return { id: HOLME.id };
    });
    const router = await openAt("/people/members", api);

    fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: `${HOLME.name} Viewer` }));

    await drawnWithNoWorkspace();
    expect(router.state.location.pathname).toBe("/");
  });

  it("lands a self-demoted Admin at an Editor's home, saying why", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => adaAt("Editor"));

    const said = await screen.findByText(homeNowSaid("Editor"));
    expect(said.textContent).toContain("Editor");
    expect(router.state.location.pathname).toBe(HOMES.Editor.path);
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();
  });

  it("keeps a self-demoted Admin put, told the role is unread", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => LOST);

    const roleCard = within(screen.getByRole("region", { name: "Role" }));
    await waitFor(() => expect(roleCard.getByRole("alert").textContent).toBe(ROLE_UNREAD.words));
    expect(roleCard.getByRole("status").textContent).toBe("");
    expect(router.state.location.pathname).toBe(MEMBER_PAGE);
    expect(switcherDrawn(), "the page lost the workspace it was drawn for").not.toBeNull();
    expect(adminsAreaOffered(), "the page lost the role it was drawn for").not.toBeNull();
  });
});
