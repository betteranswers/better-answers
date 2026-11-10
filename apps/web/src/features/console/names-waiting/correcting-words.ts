export const CORRECT_DISPLAY_NAME = "Correct display name";

export const correctWords = (name: string): string =>
  `Correct ${name === "" ? "this person’s" : `${name}’s`} display name`;

export const replacesWhere = (name: string): string =>
  `Replaces ${name === "" ? "this person’s" : `${name}’s`} display name in every workspace they belong to.`;

export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `Flags on ${now} cleared. The display name is unchanged.`
    : `Display name changed to ${now}.`;
