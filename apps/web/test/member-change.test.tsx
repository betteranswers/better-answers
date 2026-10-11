import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RAIL } from "@/app/words.ts";
import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members-address.ts";
import { CONTROL_CENTRE, HOMES } from "@/shared/navigation.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  drawnWithNoWorkspace,
  FORBIDDEN,
  GRACE,
  HOLME,
  LOST,
  openAt,
  read,
  refusedWith,
  switcher,
  switcherDrawn,
  type Api,
} from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

const CALDER = { id: "c", name: "Calder Pressings" };

/** What the api answers every read of a workspace the session names and the person has left. */
const NOT_A_MEMBER = refusedWith("not-a-member", "unauthenticated", 401);

const SET_ACTIVE = "/organization/set-active";

/** An Admin's own area, which the rail offers no other role. */
const adminsAreaOffered = () =>
  within(screen.getByRole("navigation", { name: RAIL })).queryByRole("link", {
    name: CONTROL_CENTRE.name,
  });

const MEMBER_PAGE = memberPageOf(ADA.personId);

/** Ada's own page, with Editor picked and the change pressed. */
const ROLE_CHANGED = read({ personId: ADA.personId, previousRole: "Admin", role: "Editor" });

/** `memberAfter` is what the member read answers once the change has landed. */
const demotingHerself = async (api: Api, memberAfter: Parameters<Api["set"]>[1]) => {
  api.set("members.changeRole", () => {
    api.set("session.member", memberAfter);
    api.set("members.list", () => read([{ ...ADA, role: "Editor" }, GRACE]));
    return ROLE_CHANGED;
  });
  const router = await openAt(MEMBER_PAGE, api);
  fireEvent.click(await screen.findByRole("radio", { name: "Editor" }));
  fireEvent.click(
    screen.getByRole("button", { name: MEMBER_PAGE_WORDS.makeRole(ADA.displayName, "Editor") }),
  );
  return router;
};

describe("a change to the reader's own member", () => {
  it("lands a self-removed Admin at the chooser, drawing no role", async () => {
    const api = adaAnAdmin();
    const landing = Promise.withResolvers<void>();
    api.set("members.remove", () => {
      api.set("session.member", () => NOT_A_MEMBER);
      api.set("members.list", () => NOT_A_MEMBER);
      // Two are left, so the chooser stands rather than opening the only one.
      api.set("person.workspaces", () =>
        read([
          { workspace: HOLME, role: "Viewer" },
          { workspace: CALDER, role: "Viewer" },
        ]),
      );
      // The chooser reads this before it draws, so the frame stands until the test lets it answer.
      api.set("person.secondFactor", () => landing.promise.then(() => FORBIDDEN));
      return read({});
    });
    const router = await openAt(MEMBER_PAGE, api);

    fireEvent.click(await screen.findByRole("button", { name: "Remove Ada" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada from this workspace" }));

    await waitFor(() => expect(switcherDrawn(), "the band names the workspace left").toBeNull());
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();

    landing.resolve();
    expect(await screen.findByRole("button", { name: HOLME.name })).toBeDefined();
    expect(router.state.location.pathname).toBe("/choose-workspace");
    expect(screen.queryByRole("navigation", { name: RAIL })).toBeNull();
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

    expect(
      await screen.findByText(
        "You changed your own role to Editor. People is for Admins, so this is your home now.",
      ),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe(HOMES.Editor.path);
    expect(adminsAreaOffered(), "the rail offers the role lost").toBeNull();
  });

  it("keeps a self-demoted Admin put, told the role is unread", async () => {
    const router = await demotingHerself(adaAnAdmin(), () => LOST);

    expect(
      await screen.findByText(
        "Your role changed, but it couldn’t be read again. Reload the page in a moment.",
      ),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe(MEMBER_PAGE);
    expect(switcherDrawn(), "the page lost the workspace it was drawn for").not.toBeNull();
    expect(adminsAreaOffered(), "the page lost the role it was drawn for").not.toBeNull();
  });
});
