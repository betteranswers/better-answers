import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { KeystrokesAct } from "@/shared/keystrokes.tsx";

afterEach(cleanup);

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
