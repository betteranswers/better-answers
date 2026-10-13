export const KEYSTROKE_WORDS = {
  button: "Keyboard Shortcuts",
  where: "Single keys work anywhere except in a field or dialog.",
  turnedOn: "Use single-key shortcuts on this browser",
  showTheList: "Show This List",
  noneOfItsOwn: "This page has no keyboard shortcuts of its own.",
  thisPage: "This Page",
} as const;

/** The list's heading, naming the page its keystrokes are for. */
export const keystrokesOn = (page: string): string => `${KEYSTROKE_WORDS.button} on ${page}`;
