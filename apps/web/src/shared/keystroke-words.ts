export const KEYSTROKE_WORDS = {
  button: "Keyboard shortcuts",
  where: "Single keys work anywhere except in a field or dialog.",
  turnedOn: "Use single-key shortcuts on this browser",
  showTheList: "Show this list",
  noneOfItsOwn: "This page has no keyboard shortcuts of its own.",
  thisPage: "this page",
} as const;

/** The list's heading, naming the page its keystrokes are for. */
export const keystrokesOn = (page: string): string => `${KEYSTROKE_WORDS.button} on ${page}`;

/** Said when a row's keystroke is pressed and no row has held focus, naming the row to pick. */
export const SELECT_FIRST = {
  member: "Select a member first.",
  group: "Select a group first.",
  invitation: "Select an invitation first.",
  request: "Select a request first.",
  connectedSource: "Select a connected source first.",
  person: "Select a person first.",
  name: "Select a name first.",
} as const;
