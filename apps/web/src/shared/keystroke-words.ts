export const KEYSTROKE_WORDS = {
  button: "Keyboard shortcuts",
  where: "They work anywhere except in a field or dialog.",
  turnedOn: "Use single-key shortcuts on this browser",
  showTheList: "Show this list",
} as const;

/** Said when a row's keystroke is pressed and no row has held focus, naming the row to pick. */
export const SELECT_FIRST = {
  member: "Select a member first.",
  group: "Select a group first.",
  invitation: "Select an invitation first.",
  request: "Select a request first.",
  binding: "Select a binding first.",
  person: "Select a person first.",
  name: "Select a name first.",
} as const;
