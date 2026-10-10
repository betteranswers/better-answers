import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
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
    render(<APage />);
    listDismissedByEscape();

    await aTaskLater();

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: KEYSTROKE_WORDS.button }),
    );
  });

  it("leaves focus where a sooner key moved it", async () => {
    render(<APage />);
    listDismissedByEscape();
    // The next key's action, in the task the list left in, before focus is handed back.
    screen.getByRole("textbox", { name: SEARCH }).focus();

    await aTaskLater();

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: SEARCH }));
  });
});

const JUMP_TO: Keystroke = { key: "Ctrl K", action: "Jump to" };

const MEMBERS_KEYSTROKES: readonly Keystroke[] = [
  { key: "/", action: "Search the members" },
  { key: "o", action: "Open the member in focus" },
];

const GROUPS_KEYSTROKES: readonly Keystroke[] = [{ key: "n", action: "Create a group" }];

function Registering(properties: { readonly keystrokes: readonly Keystroke[] }) {
  usePageKeystrokes(properties.keystrokes);
  return null;
}

/** The shell as the frame draws it: the trigger in one place, the open page beneath. */
function AShell(properties: { readonly page: string | undefined; readonly children?: ReactNode }) {
  return (
    <ShellKeystrokes page={properties.page} shell={[JUMP_TO]}>
      <ShellKeystrokesAction at="band" />
      {properties.children}
    </ShellKeystrokes>
  );
}

const listedOnQuestionMark = (heading: string) => {
  fireEvent.keyDown(document.body, { key: "?" });
  return screen.getByRole("dialog", { name: heading });
};

const actionsIn = (listed: HTMLElement) =>
  [...listed.querySelectorAll("dd")].map((definition) => definition.textContent);

describe("the shell's keystrokes list", () => {
  it("lists the open page's keystrokes under its name, shell's last", () => {
    render(
      <AShell page="Members">
        <Registering keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );

    const listed = listedOnQuestionMark(keystrokesOn("Members"));

    expect(actionsIn(listed)).toStrictEqual([
      "Search the members",
      "Open the member in focus",
      KEYSTROKE_WORDS.showTheList,
      "Jump to",
    ]);
    expect(listed.textContent).not.toContain(KEYSTROKE_WORDS.noneOfItsOwn);
  });

  it("follows the open page, dropping the one that left", () => {
    const { rerender } = render(
      <AShell page="Members">
        <Registering key="members" keystrokes={MEMBERS_KEYSTROKES} />
      </AShell>,
    );
    rerender(
      <AShell page="Groups">
        <Registering key="groups" keystrokes={GROUPS_KEYSTROKES} />
      </AShell>,
    );

    const listed = listedOnQuestionMark(keystrokesOn("Groups"));

    expect(actionsIn(listed)).toStrictEqual([
      "Create a group",
      KEYSTROKE_WORDS.showTheList,
      "Jump to",
    ]);
  });

  it("says a page registering nothing has none, listing the shell's", () => {
    render(<AShell page={undefined} />);

    const listed = listedOnQuestionMark(keystrokesOn(KEYSTROKE_WORDS.thisPage));

    expect(listed.textContent).toContain(KEYSTROKE_WORDS.noneOfItsOwn);
    expect(actionsIn(listed)).toStrictEqual([KEYSTROKE_WORDS.showTheList, "Jump to"]);
  });

  it("opens from its trigger, which names `?` as its keystroke", () => {
    render(<AShell page="Members" />);

    const trigger = screen.getByRole("button", { name: KEYSTROKE_WORDS.button });
    expect(trigger.getAttribute("aria-keyshortcuts")).toBe("?");
    fireEvent.click(trigger);

    expect(screen.getByRole("dialog", { name: keystrokesOn("Members") })).toHaveProperty(
      "isConnected",
      true,
    );
  });

  it("leaves a key typed on a select’s trigger to it", () => {
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

  it("stops answering `?` once single-key keystrokes are turned off", () => {
    render(<AShell page="Members" />);
    const listed = listedOnQuestionMark(keystrokesOn("Members"));

    fireEvent.click(screen.getByRole("checkbox", { name: KEYSTROKE_WORDS.turnedOn }));
    fireEvent.keyDown(listed, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(document.body, { key: "?" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
