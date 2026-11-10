import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MEMBER_PAGE_WORDS } from "@/features/people/member-action-words.ts";
import { memberPageOf } from "@/features/people/members/members-address.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { MEMBERS_PAGE } from "@test/people/member-pages.ts";
import { holdProcedure } from "@test/stubbed-api.ts";
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

const alertsWithText = (region: HTMLElement): number =>
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
        .getAllByRole("heading", { level: 1 })
        .map((each) => each.textContent),
    ).toContain(name),
  );
};

describe("a member's Activity", () => {
  it("shows no activity from the previous workspace after a switch", async () => {
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
    expect(screen.getByRole("heading", { level: 1, name: "Members" })).toBeDefined();
    const activity = holdProcedure(api, "members.activity", readOf());
    await openedByName(ADA.displayName);

    await activity.asked;
    expect(
      activityOf().getByRole("status").textContent,
      "the loading region was empty while the read was pending",
    ).toMatch(/\S/);
    expect(
      thePage().queryByText("Northern leads", { exact: false }),
      "the page showed activity from the previous workspace",
    ).toBeNull();

    activity.resolve();
    await waitFor(() => expect(activityOf().queryAllByRole("status")).toHaveLength(0));
    expect(activityOf().getByText(ADA.displayName, { exact: false })).toBeDefined();
    expect(alertsWithText(activityRegion())).toBe(0);
    expect(linesOf()).toHaveLength(0);
    expect(thePage().queryByText("Northern leads", { exact: false })).toBeNull();
  });

  it("shows a failed read only in Activity, then retries it", async () => {
    const api = adaAnAdmin();
    api.set("members.list", () => read([ADA, GRACE]));
    api.set("members.groups", () => read([]));
    api.set("members.activity", () => LOST);
    await openAt(memberPageOf(ADA.personId), api);

    await waitFor(() => expect(alertsWithText(activityRegion())).toBe(1));
    expect(thePage().getByRole("region", { name: "Access" })).toBeDefined();
    expect(
      thePage().getByRole("region", { name: MEMBER_PAGE_WORDS.removeAndSignOut }),
      "a failed Activity read hid the Remove and Sign Out section",
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
