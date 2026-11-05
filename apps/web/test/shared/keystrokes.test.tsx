import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import {
  KeystrokesAction,
  ShellKeystrokes,
  ShellKeystrokesAction,
  usePageKeystrokes,
  type Keystroke,
} from "@/shared/keystrokes.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SEARCH = "Search";

function APage() {
  return (
    <>
      <KeystrokesAction page="People" keystrokes={[{ key: "/", action: SEARCH }]} />
      <input aria-label={SEARCH} />
    </>
  );
}

/** Radix restores focus one task after the dialog closes. */
const nextTask = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const openAndEscapeList = () => {
  fireEvent.keyDown(document.body, { key: "?" });
  expect(screen.getByRole("dialog")).toHaveProperty("isConnected", true);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
};

describe("the keystrokes list", () => {
  it("returns focus to its button after closing", async () => {
    render(<APage />);
    openAndEscapeList();

    await nextTask();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keyboard Shortcuts" }));
  });

  it("keeps focus where the user moved it before closing", async () => {
    render(<APage />);
    openAndEscapeList();
    screen.getByRole("textbox", { name: SEARCH }).focus();

    await nextTask();

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: SEARCH }));
  });
});

const JUMP_TO: Keystroke = { key: "Ctrl K", action: "Jump To" };

const MEMBERS_KEYSTROKES: readonly Keystroke[] = [
  { key: "/", action: "Search the Members" },
  { key: "o", action: "Open the Member in Focus" },
];

const GROUPS_KEYSTROKES: readonly Keystroke[] = [{ key: "n", action: "Create a Group" }];

function RegisterKeystrokes(properties: { readonly keystrokes: readonly Keystroke[] }) {
  usePageKeystrokes(properties.keystrokes);
  return null;
}

function AShell(properties: { readonly page: string | undefined; readonly children?: ReactNode }) {
  return (
    <ShellKeystrokes page={properties.page} shell={[JUMP_TO]}>
      <ShellKeystrokesAction at="band" />
      {properties.children}
    </ShellKeystrokes>
  );
}

const openListWithQuestionMark = (heading: string) => {
  fireEvent.keyDown(document.body, { key: "?" });
  return screen.getByRole("dialog", { name: heading });
};

const actionsIn = (list: HTMLElement) =>
  [...list.querySelectorAll("dd")].map((definition) => definition.textContent);

describe("the shell's keystrokes list", () => {
  it("lists the page's keystrokes first, then the shell's", () => {
    render(
      <AShell page="Members">
        <RegisterKeystrokes keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );

    const list = openListWithQuestionMark("Keyboard Shortcuts on Members");

    expect(actionsIn(list)).toStrictEqual([
      "Search the Members",
      "Open the Member in Focus",
      "Show This List",
      "Jump To",
    ]);
    expect(list.textContent).not.toContain(KEYSTROKE_WORDS.noneOfItsOwn);
  });

  it("updates when the page changes, dropping the old keystrokes", () => {
    const { rerender } = render(
      <AShell page="Members">
        <RegisterKeystrokes key="members" keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );
    rerender(
      <AShell page="Groups">
        <RegisterKeystrokes key="groups" keystrokes={GROUPS_KEYSTROKES} />
      </AShell>,
    );

    const list = openListWithQuestionMark("Keyboard Shortcuts on Groups");

    expect(actionsIn(list)).toStrictEqual(["Create a Group", "Show This List", "Jump To"]);
  });

  it("lists only shell keystrokes for a page without any", () => {
    render(<AShell page={undefined} />);

    const list = openListWithQuestionMark("Keyboard Shortcuts on This Page");

    expect(list.textContent).toContain(KEYSTROKE_WORDS.noneOfItsOwn);
    expect(actionsIn(list)).toStrictEqual(["Show This List", "Jump To"]);
  });

  it("opens from its button, which declares the `?` shortcut", () => {
    render(<AShell page="Members" />);

    const trigger = screen.getByRole("button", { name: "Keyboard Shortcuts" });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("?");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: "Keyboard Shortcuts on Members" })).toHaveProperty(
      "isConnected",
      true,
    );
  });

  it("ignores `?` typed on a select trigger", () => {
    render(
      <AShell page="Members">
        <Select defaultValue="Viewer">
          <SelectTrigger aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </AShell>,
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "?" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores `?` after single-key shortcuts are turned off", () => {
    render(<AShell page="Members" />);
    const list = openListWithQuestionMark("Keyboard Shortcuts on Members");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Use single-key shortcuts on this browser" }),
    );
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "?" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
