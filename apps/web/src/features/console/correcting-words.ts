const possessiveOf = (name: string): string => (name === "" ? "this person’s" : `${name}’s`);

export const CORRECT_DISPLAY_NAME = "Correct Display Name";

export const correctWords = (name: string): string =>
  `Correct ${name === "" ? "This Person’s" : `${name}’s`} Display Name`;

export const correctingConsequence = (name: string): string =>
  `This will replace ${possessiveOf(name)} display name in every workspace they belong to.`;

export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `The display name ${now} has been kept, and its flags have been cleared successfully.`
    : `The display name ${was === "" ? "" : `${was} `}has been changed to ${now} successfully.`;
