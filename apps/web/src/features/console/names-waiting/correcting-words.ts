const possessiveOf = (name: string): string => (name === "" ? "this person’s" : `${name}’s`);

export const CORRECT_DISPLAY_NAME = "Correct Display Name";

export const correctWords = (name: string): string =>
  `Correct ${name === "" ? "This Person’s" : `${name}’s`} Display Name`;

export const correctingConsequence = (name: string): string =>
  `This will replace ${possessiveOf(name)} display name in every workspace they belong to.`;

export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `The flags on ${now} have been cleared successfully. The display name is unchanged.`
    : `The display name ${was === "" ? "" : `${was} `}has been changed to ${now} successfully.`;
