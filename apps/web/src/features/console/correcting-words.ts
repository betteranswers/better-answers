/** A person erased since their flag has no name left to own one. */
const possessiveOf = (name: string): string => (name === "" ? "this person’s" : `${name}’s`);

export const correctWords = (name: string): string => `Correct ${possessiveOf(name)} display name`;

export const correctingConsequence = (name: string): string =>
  `The name you save becomes ${possessiveOf(name)} display name in every workspace they belong to, and ends every flag waiting on it. Recorded on the identity-set audit log under your name, with no name in it.`;

/** Saving the name already held is still recorded, and still clears the flag. */
export const correctedWords = (was: string, now: string): string =>
  was === now
    ? `Saved: ${now} stands as it was, and no flag waits on it now.`
    : `Saved: ${possessiveOf(was)} display name is ${now} now, wherever the platform names them.`;
