export const CORRECT_DISPLAY_NAME = "Correct display name";

export const correctWords = (name: string): string =>
  `Correct ${name === "" ? "this person’s" : `${name}’s`} display name`;

export const shownWhere = (name: string): string =>
  `Shown in every workspace ${name === "" ? "this person" : name} belongs to.`;

export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `Flags on ${now} cleared. The display name is unchanged.`
    : `Display name changed to ${now}.`;
