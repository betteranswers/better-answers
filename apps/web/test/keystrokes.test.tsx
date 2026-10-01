import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import {
  KeystrokesAct,
  ShellKeystrokes,
  ShellKeystrokesAct,
  useScreenKeystrokes,
  type Keystroke,
} from "@/shared/keystrokes.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SEARCH = "Search";

function AScreen() {
  return (
    <>
      <KeystrokesAct screen="People" keystrokes={[{ key: "/", act: SEARCH }]} />
      <input aria-label={SEARCH} />
    </>
  );
}

/** Radix hands focus back a task after the list goes, so the test lets that task run. */
const aTaskLater = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const listDismissedByEscape = () => {
  fireEvent.keyDown(document.body, { key: "?" });
  expect(screen.getByRole("dialog")).toHaveProperty("isConnected", true);
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
};

describe("the keystrokes list", () => {
  it("hands focus back to its button once dismissed", async () => {
    render(<AScreen />);
    listDismissedByEscape();

    await aTaskLater();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: KEYSTROKE_WORDS.button }),
    );
  });

  it("leaves focus where a sooner key moved it", async () => {
    render(<AScreen />);
    listDismissedByEscape();
    // The next key's act, in the task the list left in, before focus is handed back.
    screen.getByRole("textbox", { name: SEARCH }).focus();

    await aTaskLater();

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: SEARCH }));
  });
});

const JUMP_TO: Keystroke = { key: "Ctrl K", act: "Jump to" };

const MEMBERS_KEYSTROKES: readonly Keystroke[] = [
  { key: "/", act: "Search the members" },
  { key: "o", act: "Open the member in focus" },
];

const GROUPS_KEYSTROKES: readonly Keystroke[] = [{ key: "n", act: "Create a group" }];

function Registering(properties: { readonly keystrokes: readonly Keystroke[] }) {
  useScreenKeystrokes(properties.keystrokes);
  return null;
}

/** The shell as the frame draws it: the trigger in one place, the open screen beneath. */
function AShell(properties: {
  readonly screen: string | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <ShellKeystrokes screen={properties.screen} shell={[JUMP_TO]}>
      <ShellKeystrokesAct at="band" />
      {properties.children}
    </ShellKeystrokes>
  );
}

const listedOnQuestionMark = (heading: string) => {
  fireEvent.keyDown(document.body, { key: "?" });
  return screen.getByRole("dialog", { name: heading });
};

const actsIn = (listed: HTMLElement) =>
  [...listed.querySelectorAll("dd")].map((definition) => definition.textContent);

describe("the shell's keystrokes list", () => {
  it("lists the open screen's keystrokes under its name, shell's last", () => {
    render(
      <AShell screen="Members">
        <Registering keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );

    const listed = listedOnQuestionMark(keystrokesOn("Members"));

    expect(actsIn(listed)).toStrictEqual([
      "Search the members",
      "Open the member in focus",
      KEYSTROKE_WORDS.showTheList,
      "Jump to",
    ]);
    expect(listed.textContent).not.toContain(KEYSTROKE_WORDS.noneOfItsOwn);
  });

  it("follows the open screen, dropping the one that left", () => {
    const { rerender } = render(
      <AShell screen="Members">
        <Registering key="members" keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );
    rerender(
      <AShell screen="Groups">
        <Registering key="groups" keystrokes={GROUPS_KEYSTROKES} />
      </AShell>,
    );

    const listed = listedOnQuestionMark(keystrokesOn("Groups"));

    expect(actsIn(listed)).toStrictEqual([
      "Create a group",
      KEYSTROKE_WORDS.showTheList,
      "Jump to",
    ]);
  });

  it("says a screen registering nothing has none, listing the shell's", () => {
    render(<AShell screen={undefined} />);

    const listed = listedOnQuestionMark(keystrokesOn(KEYSTROKE_WORDS.thisScreen));

    expect(listed.textContent).toContain(KEYSTROKE_WORDS.noneOfItsOwn);
    expect(actsIn(listed)).toStrictEqual([KEYSTROKE_WORDS.showTheList, "Jump to"]);
  });

  it("opens from its trigger, which names `?` as its keystroke", () => {
    render(<AShell screen="Members" />);

    const trigger = screen.getByRole("button", { name: KEYSTROKE_WORDS.button });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("?");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: keystrokesOn("Members") })).toHaveProperty(
      "isConnected",
      true,
    );
  });

  it("stops answering `?` once single-key keystrokes are turned off", () => {
    render(<AShell screen="Members" />);
    const listed = listedOnQuestionMark(keystrokesOn("Members"));

    fireEvent.click(screen.getByRole("checkbox", { name: KEYSTROKE_WORDS.turnedOn }));
    fireEvent.keyDown(listed, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "?" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
