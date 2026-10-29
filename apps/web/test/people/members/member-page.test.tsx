import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { memberPageOf } from "@/features/people/members/members-address.ts";
import { PEOPLE_KEYSTROKES, PEOPLE_SELECT_FIRST } from "@/features/people/people-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server } from "@test/stub-server.ts";
import { ADA, adaAnAdmin, GRACE, openAt, read, tickOf } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS_PAGE = pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members").path;

const idOf = (seed: string): string => `01J${seed}`.padEnd(26, "0");

const PRIYA = {
  ...GRACE,
  personId: idOf("PRYA"),
  displayName: "Priya Shah",
  address: "priya@calder.example.test",
  role: "Editor",
};

const SAM = {
  ...GRACE,
  personId: idOf("SAM"),
  displayName: "Sam Okoro",
  address: "sam@calder.example.test",
  role: "Viewer",
};

const UNNAMED = {
  ...GRACE,
  personId: idOf("NNMD"),
  displayName: "",
  address: "unnamed@calder.example.test",
  role: "Viewer",
};

const TEST_PERSON = { ...ADA, displayName: "Test person", address: "admin@calder.example.test" };

const aWorkspaceOfThree = () => {
  const api = adaAnAdmin();
  api.set("members.list", () => read([PRIYA, SAM, TEST_PERSON, UNNAMED]));
  api.set("members.groups", () => read([]));
  api.set("members.activity", () => read({ events: [], nextCursor: null }));
  return api;
};

const thePage = () => within(screen.getByRole("main"));

const membersRegion = () => within(screen.getByRole("region", { name: "Members" }));

const personHeading = (name: string) =>
  waitFor(() => {
    const heading = thePage()
      .getAllByRole("heading", { level: 2 })
      .find((each) => each.textContent === name);
    expect(heading, `no heading for ${name}`).toBeDefined();
    return heading ?? document.body;
  });

const alertsSaid = (region: HTMLElement): number =>
  within(region)
    .queryAllByRole("alert")
    .filter((alert) => alert.textContent !== "").length;

const tickedBox = (name: string): HTMLElement => {
  const box = tickOf(name);
  expect(box, `no tick for ${name}`).not.toBeNull();
  return box ?? document.body;
};

const breadcrumb = () =>
  within(within(screen.getByRole("banner")).getByRole("navigation", { name: "Breadcrumb" }));

const crumbs = () => breadcrumb().getAllByRole("listitem");

const rolePicker = () => within(thePage().getByRole("region", { name: "Role" }));

const roleRadio = (role: string) => thePage().getByRole("radio", { name: role });

const describing = (control: HTMLElement): string =>
  document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent ?? "";

const selectFirstSaid = () => membersRegion().queryAllByText(PEOPLE_SELECT_FIRST.member).length;

const keyPressed = (key: string) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

const focused = (control: HTMLElement): HTMLElement => {
  act(() => {
    control.focus();
  });
  expect(document.activeElement, "the control took no focus").toBe(control);
  return control;
};

const membersListed = () =>
  waitFor(() => membersRegion().getByRole("heading", { level: 2, name: "Members" }));

const linkTo = (name: string) => waitFor(() => membersRegion().getByRole("link", { name }));

describe("a member's own page", () => {
  it("opens by name, row menu and link, crumbed by name", async () => {
    const api = aWorkspaceOfThree();
    const router = await openAt(MEMBERS_PAGE, api);
    const priyasPage = memberPageOf(PRIYA.personId);

    fireEvent.click(await linkTo("Priya Shah"));

    await personHeading("Priya Shah");
    expect(router.state.location.pathname).toBe(priyasPage);
    expect(crumbs().map((crumb) => crumb.textContent)).toEqual([
      "Control Centre",
      "People",
      "Members",
      "Priya Shah",
    ]);
    expect(breadcrumb().getByRole("link", { name: "Members" }).getAttribute("href")).toBe(
      MEMBERS_PAGE,
    );
    expect(screen.queryAllByRole("tab")).toHaveLength(0);

    act(() => {
      router.history.back();
    });
    await membersListed();
    expect(router.state.location.pathname).toBe(MEMBERS_PAGE);
    fireEvent.keyDown(
      await membersRegion().findByRole("button", { name: "Actions for Priya Shah" }),
      {
        key: "Enter",
      },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open" }));

    const heading = await personHeading("Priya Shah");
    expect(router.state.location.pathname).toBe(priyasPage);
    await waitFor(() => expect(document.activeElement).toBe(heading));

    cleanup();
    const reloaded = await openAt(priyasPage, api);
    await personHeading("Priya Shah");
    expect(reloaded.state.location.pathname).toBe(priyasPage);
    expect(crumbs().at(-1)?.textContent).toBe("Priya Shah");
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeDefined();
  });

  it("names a role change only once another role is picked", async () => {
    await openAt(memberPageOf(PRIYA.personId), aWorkspaceOfThree());
    await personHeading("Priya Shah");
    const commit = () => rolePicker().getByRole("button", { name: "Change Role" });

    expect(commit().hasAttribute("disabled")).toBe(true);
    expect(describing(commit())).toMatch(/Priya Shah.*Editor/);

    fireEvent.click(roleRadio("Viewer"));
    expect(commit().hasAttribute("disabled")).toBe(false);
    expect(describing(commit()), "the primary names no change with another role picked").toMatch(
      /Priya Shah.*Editor.*Viewer/,
    );
    expect(rolePicker().getAllByRole("button")).toHaveLength(1);

    fireEvent.click(roleRadio("Editor"));
    expect(commit().hasAttribute("disabled")).toBe(true);
  });

  it("opens no member by key after focus leaves the list", async () => {
    const router = await openAt(MEMBERS_PAGE, aWorkspaceOfThree());
    focused(await linkTo("Priya Shah"));
    focused(await membersListed());
    const outcome = () => membersRegion().getAllByRole("status")[1];
    expect(outcome()?.textContent).toBe("");

    keyPressed(PEOPLE_KEYSTROKES.open.key);

    await waitFor(() => expect(outcome()?.textContent).toMatch(/\S/));
    expect(outcome()?.textContent).toBe(PEOPLE_SELECT_FIRST.member);
    expect(router.state.location.pathname, "the keystroke left Members").toBe(MEMBERS_PAGE);
    expect(screen.queryByRole("heading", { level: 2, name: "Priya Shah" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Selected Members" })).toBeNull();
  });

  it("drops the select-first line once a key ticks a member", async () => {
    await openAt(MEMBERS_PAGE, aWorkspaceOfThree());
    await linkTo("Priya Shah");

    for (const { key } of [PEOPLE_KEYSTROKES.tick, PEOPLE_KEYSTROKES.changeSelectedRoles]) {
      focused(await membersListed());
      keyPressed(key);
      await waitFor(() =>
        expect(selectFirstSaid(), `${key} with no member in focus or ticked said nothing`).toBe(1),
      );

      const tick = tickedBox("Priya Shah");
      focused(tick);
      keyPressed(PEOPLE_KEYSTROKES.tick.key);
      await waitFor(() => expect(tick.getAttribute("aria-checked")).toBe("true"));
      expect(selectFirstSaid(), `the select-first line of ${key} outlived the tick`).toBe(0);
      keyPressed(PEOPLE_KEYSTROKES.tick.key);
      await waitFor(() => expect(tick.getAttribute("aria-checked")).toBe("false"));
    }
  });
});

describe("ending every sign-in and token a member holds here", () => {
  it("opens a member's sign-ins and ends them by keyboard", async () => {
    const api = aWorkspaceOfThree();
    api.set("members.endEverySignInAndToken", () => read({}));
    const router = await openAt(MEMBERS_PAGE, api);
    await linkTo("Sam Okoro");
    const endKey = PEOPLE_KEYSTROKES.endEverySignInAndToken.key;
    const outcome = () => membersRegion().getAllByRole("status")[1];
    focused(await membersListed());
    expect(outcome()?.textContent).toBe("");

    keyPressed(endKey);

    await waitFor(() => expect(outcome()?.textContent).toBe(PEOPLE_SELECT_FIRST.member));
    expect(router.state.location.pathname).toBe(MEMBERS_PAGE);
    expect(screen.queryByRole("toolbar", { name: "Selected Members" })).toBeNull();

    focused(await linkTo("Sam Okoro"));
    keyPressed(endKey);

    const revoke = await waitFor(() =>
      thePage().getByRole("button", { name: "End Every Sign-In and Token Here" }),
    );
    await waitFor(() => expect(document.activeElement).toBe(revoke));
    fireEvent.click(revoke);
    const credentials = thePage().getByRole("region", { name: "Sign-Ins and Personal Tokens" });
    await waitFor(() =>
      expect(within(credentials).getByRole("status").textContent).toContain("Sam Okoro"),
    );
    expect(document.activeElement).toBe(revoke);
  });
});

describe("a member's display name, flagged to better-answers support", () => {
  it("offers no flag for a member with no display name", async () => {
    await openAt(MEMBERS_PAGE, aWorkspaceOfThree());

    fireEvent.click(await linkTo("No display name yet"));

    await personHeading(UNNAMED.address);
    expect(crumbs().at(-1)?.textContent).toBe(UNNAMED.address);
    const region = within(thePage().getByRole("region", { name: "Display Name" }));
    expect(region.getByText(UNNAMED.address, { exact: false })).toBeDefined();
    expect(region.queryAllByRole("button")).toHaveLength(0);
  });

  it("flags a member's name by keyboard alone, from the list", async () => {
    const api = aWorkspaceOfThree();
    api.set("members.flagDisplayName", () => read({}));
    await openAt(MEMBERS_PAGE, api);
    await linkTo("Priya Shah");

    keyPressed("?");
    const keystrokes = await screen.findByRole("dialog", { name: "Keyboard Shortcuts on Members" });
    expect(
      within(keystrokes)
        .getAllByRole("term")
        .map((term) => term.textContent),
    ).toContain(PEOPLE_KEYSTROKES.flagName.key);
    keyPressed("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keyboard Shortcuts" }));

    focused(await linkTo("Priya Shah"));
    keyPressed(PEOPLE_KEYSTROKES.flagName.key);

    const flag = await waitFor(() => thePage().getByRole("button", { name: "Flag Name" }));
    await waitFor(() => expect(document.activeElement).toBe(flag));
    fireEvent.click(flag);
    const region = thePage().getByRole("region", { name: "Display Name" });
    await waitFor(() => expect(within(region).getByRole("status").textContent).toMatch(/\S/));
    expect(alertsSaid(region)).toBe(0);
    await waitFor(() =>
      expect(server.asks.filter((ask) => ask.procedure === "members.flagDisplayName")).toEqual([
        { procedure: "members.flagDisplayName", input: { personId: PRIYA.personId } },
      ]),
    );
  });
});
