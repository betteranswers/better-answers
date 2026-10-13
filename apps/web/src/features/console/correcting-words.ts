/** A person erased since their flag has no name left to own one. */
const possessiveOf = (name: string): string => (name === "" ? "this person’s" : `${name}’s`);

/** The sheet's own action: its sheet already names the person. */
export const CORRECT_DISPLAY_NAME = "Correct Display Name";

/** The dialog's title, and the name of the action a list repeats on every row. */
export const correctWords = (name: string): string =>
  `Correct ${name === "" ? "This Person’s" : `${name}’s`} Display Name`;

export const correctingConsequence = (name: string): string =>
  `This will replace ${possessiveOf(name)} display name in every workspace they belong to.`;

/** Saving the name already held is still recorded, and still clears the flag. */
export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `The display name ${now} has been kept, and its flags have been cleared successfully.`
    : `The display name ${was === "" ? "" : `${was} `}has been changed to ${now} successfully.`;
