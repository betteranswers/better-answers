import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
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

describe("changes to your own membership", () => {
  it("sends an Admin who removes themself to the workspace chooser", async () => {
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

    await waitFor(() =>
      expect(switcherDrawn(), "the top band still names the workspace that was left").toBeNull(),
    );
    expect(adminsAreaOffered(), "the rail still offers the Admin area").toBeNull();

    landing.resolve();
    expect(await screen.findByRole("button", { name: HOLME.name })).toBeDefined();
    expect(router.state.location.pathname).toBe("/choose-workspace");
    expect(screen.queryByRole("navigation", { name: "Areas" })).toBeNull();
  });

  it("hides the old workspace's name when a switch fails", async () => {
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

  it("sends an Admin who demotes themself to the Editor home", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => adaAt("Editor"));

    await waitFor(() => expect(router.state.location.pathname).toBe(HOMES.Editor.path));
    expect(
      await screen.findByText(/\bEditor\b/, { selector: "output" }),
      "the home page did not say the new role",
    ).toBeDefined();
    expect(adminsAreaOffered(), "the rail still offers the Admin area").toBeNull();
  });

  it("keeps a demoted Admin on the page when reading fails", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => LOST);

    const roleCard = within(screen.getByRole("region", { name: "Role" }));
    await waitFor(() => expect(roleCard.getByRole("alert").textContent).toMatch(/\S/));
    expect(roleCard.getByRole("status").textContent).toBe("");
    expect(router.state.location.pathname).toBe(MEMBER_PAGE);
    expect(switcherDrawn(), "the workspace switcher disappeared").not.toBeNull();
    expect(adminsAreaOffered(), "the Admin area disappeared from the rail").not.toBeNull();
  });
});
