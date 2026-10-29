import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  GRACE,
  HOLME,
  LOST,
  NORTHERN,
  openAt,
  read,
  switcher,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const SET_ACTIVE = "/organization/set-active";

const aLineAbout = (group: string) => ({
  id: "01JEVNT0000000000000000001",
  at: "2026-10-01T09:30:00.000Z",
  action: "people.group.created",
  by: { kind: "person", displayName: ADA.displayName, address: ADA.address },
  subject: { kind: "group", name: group },
  detail: {},
  named: {},
  direction: "by",
});

const readOf = (...lines: readonly unknown[]) => read({ events: lines, nextCursor: null });

const thePage = () => within(screen.getByRole("main"));

const activityRegion = () => thePage().getByRole("region", { name: "Activity" });

const activityOf = () => within(activityRegion());

const linesOf = () => activityOf().queryAllByRole("listitem");

const alertsSaid = (region: HTMLElement): number =>
  within(region)
    .queryAllByRole("alert")
    .filter((alert) => alert.textContent !== "").length;

const openedByName = async (name: string) => {
  fireEvent.click(
    await waitFor(() =>
      within(screen.getByRole("region", { name: "Members" })).getByRole("link", { name }),
    ),
  );
  await waitFor(() =>
    expect(
      thePage()
        .getAllByRole("heading", { level: 2 })
        .map((each) => each.textContent),
    ).toContain(name),
  );
};

describe("a member's Activity", () => {
  it("draws nothing of the workspace left after a switch", async () => {
    const api = adaAnAdmin();
    api.set("person.workspaces", () =>
      read([
        { workspace: NORTHERN, role: "Admin" },
        { workspace: HOLME, role: "Admin" },
      ]),
    );
    api.set("members.groups", () => read([]));
    api.set("members.activity", () => readOf(aLineAbout("Northern leads")));
    api.set(SET_ACTIVE, () => {
      api.set("session.member", () => adaAt("Admin", HOLME));
      return { id: HOLME.id };
    });
    const router = await openAt(MEMBERS_PAGE, api);
    await openedByName(ADA.displayName);
    await waitFor(() => expect(linesOf()).toHaveLength(1));
    expect(linesOf()[0]?.textContent).toContain("Northern leads");

    fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: `${HOLME.name} Admin` }));
    await switcher(HOLME);
    await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS_PAGE));
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeDefined();
    const activity = heldBack(api, "members.activity", readOf());
    await openedByName(ADA.displayName);

    await activity.asked;
    expect(activityOf().getByRole("status").textContent, "the held read says nothing").toMatch(
      /\S/,
    );
    expect(
      thePage().queryByText("Northern leads", { exact: false }),
      "drew the left workspace's Activity",
    ).toBeNull();

    activity.resolve();
    await waitFor(() => expect(activityOf().queryAllByRole("status")).toHaveLength(0));
    expect(activityOf().getByText(ADA.displayName, { exact: false })).toBeDefined();
    expect(alertsSaid(activityRegion())).toBe(0);
    expect(linesOf()).toHaveLength(0);
    expect(thePage().queryByText("Northern leads", { exact: false })).toBeNull();
  });

  it("says a failed read in Activity alone, then retries it", async () => {
    const api = adaAnAdmin();
    api.set("members.list", () => read([ADA, GRACE]));
    api.set("members.groups", () => read([]));
    api.set("members.activity", () => LOST);
    await openAt(memberPageOf(ADA.personId), api);

    await waitFor(() => expect(alertsSaid(activityRegion())).toBe(1));
    expect(thePage().getByRole("region", { name: "Access" })).toBeDefined();
    expect(
      thePage().getByRole("region", { name: "Remove and End Every Sign-In" }),
      "a failed Activity took Remove and end every sign-in with it",
    ).toBeDefined();

    api.set("members.activity", () => readOf(aLineAbout("Northern leads")));
    const retry = activityOf().getByRole("button", { name: "Retry" });
    act(() => {
      retry.focus();
    });
    fireEvent.click(retry);

    await waitFor(() => expect(linesOf()).toHaveLength(1));
    const heading = activityOf().getByRole("heading", { level: 2, name: "Activity" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
