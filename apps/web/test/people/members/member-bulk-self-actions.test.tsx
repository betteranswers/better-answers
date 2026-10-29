import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { INCLUDES_YOU } from "@/features/people/member-action-words.ts";
import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { heldBack, type Held } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  adaAt,
  aRefusalAnswer,
  GRACE,
  HOLME,
  NORTHERN,
  openAt,
  read,
  switcher,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const MEMBERS = "/people/members";

const SET_ACTIVE = "/organization/set-active";

const NOT_A_MEMBER = aRefusalAnswer("not-a-member", "unauthenticated", 401);

const CALDER = { id: "c", name: "Calder Pressings" };

const HELD_BEFORE = [
  { workspace: NORTHERN, role: "Admin" },
  { workspace: HOLME, role: "Viewer" },
  { workspace: CALDER, role: "Viewer" },
];

const bar = () => within(screen.getByRole("toolbar", { name: "Selected Members" }));

const tick = async (name: string) => {
  fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${name}` }));
};

const linesIn = (dialog: HTMLElement): HTMLElement[] => within(dialog).getAllByRole("paragraph");

const dialogOpened = async (action: string, title: string): Promise<HTMLElement> => {
  fireEvent.click(bar().getByRole("button", { name: action }));
  return screen.findByRole("dialog", { name: title });
};

const removedThroughTheBar = async (title: string) => {
  const dialog = await dialogOpened("Remove", title);
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
};

const switcherOpenedAndDismissed = async (listing?: string) => {
  fireEvent.keyDown(await switcher(), { key: "ArrowDown" });
  const menu = await screen.findByRole("menu", { name: NORTHERN.name });
  if (listing !== undefined) expect(await within(menu).findByText(listing)).toBeDefined();
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
  });
};

const editorPickedByKeyboard = async (select: HTMLElement) => {
  // jsdom lays nothing out, and the select scrolls its chosen choice into view as it opens.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => undefined,
    configurable: true,
  });
  try {
    expect(document.activeElement).toBe(select);
    fireEvent.keyDown(select, { key: "Enter" });
    const viewer = await screen.findByRole("option", { name: "Viewer" });
    await waitFor(() => {
      expect(document.activeElement).toBe(viewer);
    });
    fireEvent.keyDown(viewer, { key: "ArrowUp" });
    const editor = screen.getByRole("option", { name: "Editor" });
    await waitFor(() => {
      expect(document.activeElement).toBe(editor);
    });
    fireEvent.keyDown(editor, { key: "Enter" });
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).toBeNull();
    });
    expect(document.activeElement).toBe(select);
  } finally {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
};

const removingYourself = (
  before: readonly object[],
  after: readonly object[],
  holdingTheReread = false,
) => {
  const api = adaAnAdmin();
  const reread = Promise.withResolvers<Held>();
  api.set("person.workspaces", () => read(before));
  api.set("members.bulkRemove", () => {
    api.set("session.member", () => NOT_A_MEMBER);
    api.set("members.list", () => NOT_A_MEMBER);
    api.set("person.workspaces", () => read(after));
    if (holdingTheReread) reread.resolve(heldBack(api, "person.workspaces"));
    return read({ changed: [ADA.personId], skipped: 0 });
  });
  return { api, reread: reread.promise };
};

describe("bulk actions on the members ticked", () => {
  it("demoting yourself says so, then lands on Editor's home", async () => {
    const api = adaAnAdmin();
    api.set("members.bulkChangeRole", () => {
      api.set("session.member", () => adaAt("Editor"));
      api.set("members.list", () => read([{ ...ADA, role: "Editor" }, GRACE]));
      return read({ changed: [ADA.personId], skipped: 0, promoted: [] });
    });
    const router = await openAt(MEMBERS, api);
    await tick(ADA.displayName);

    const dialog = await dialogOpened("Change Role", "Change Role for 1 Member");
    expect(linesIn(dialog)).toHaveLength(3);
    expect(within(dialog).getByText(INCLUDES_YOU)).toBeDefined();
    await editorPickedByKeyboard(within(dialog).getByRole("combobox", { name: "Role" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change Role" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Ask" })).toBeDefined();
    expect(router.state.location.pathname).toBe(HOMES.Editor.path);
    expect(screen.getAllByRole("status").some((said) => /\bEditor\b/v.test(said.textContent))).toBe(
      true,
    );
  });

  it("removing yourself lands on the chooser, without this workspace", async () => {
    const { api, reread } = removingYourself(
      HELD_BEFORE,
      [
        { workspace: HOLME, role: "Viewer" },
        { workspace: CALDER, role: "Viewer" },
      ],
      true,
    );
    const router = await openAt(MEMBERS, api);
    await switcherOpenedAndDismissed(HOLME.name);
    await tick(ADA.displayName);

    const dialog = await dialogOpened("Remove", "Remove 1 Member");
    expect(linesIn(dialog)).toHaveLength(2);
    expect(within(dialog).getByText(INCLUDES_YOU)).toBeDefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/choose-workspace");
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Your Workspaces" })).toBeDefined();
    expect(
      screen.queryByRole("button", { name: NORTHERN.name }),
      "the chooser opens on the workspace left",
    ).toBeNull();
    (await reread).resolve();
    expect(await screen.findByRole("button", { name: HOLME.name })).toBeDefined();
    expect(screen.getByRole("button", { name: CALDER.name })).toBeDefined();
    expect(screen.queryByRole("button", { name: NORTHERN.name })).toBeNull();
  });

  it("removing yourself, in one other workspace, opens that one", async () => {
    const { api } = removingYourself(HELD_BEFORE.slice(0, 2), [
      { workspace: HOLME, role: "Viewer" },
    ]);
    api.set(SET_ACTIVE, () => {
      api.set("session.member", () => adaAt("Viewer", HOLME));
      return { id: HOLME.id };
    });
    const router = await openAt(MEMBERS, api);
    await tick(ADA.displayName);

    await removedThroughTheBar("Remove 1 Member");

    expect(await screen.findByRole("heading", { level: 1, name: "Ask" })).toBeDefined();
    expect(router.state.location.pathname).toBe(HOMES.Viewer.path);
    expect(await switcher(HOLME)).toBeDefined();
  });

  it("removing yourself, in no other workspace, reaches no-workspace", async () => {
    const { api } = removingYourself(HELD_BEFORE.slice(0, 1), []);
    await openAt(MEMBERS, api);
    await switcherOpenedAndDismissed();
    await tick(ADA.displayName);

    await removedThroughTheBar("Remove 1 Member");

    expect(
      await screen.findByRole("heading", { level: 1, name: "No Workspace Yet" }),
    ).toBeDefined();
  });
});
