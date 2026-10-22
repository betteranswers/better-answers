import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { DecidedWord, WaitingPerson } from "./inbox-api.ts";

const quoted = (title: string): string => `“${title}”`;

const opening = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

const FORMER_MEMBER = "a former member";

const UNNAMED = "a member with no display name yet";

export const personWords = (person: WaitingPerson | null): string => {
  if (person === null) return FORMER_MEMBER;
  return person.name === "" ? UNNAMED : person.name;
};

export const personShown = (person: WaitingPerson | null): string => opening(personWords(person));

export const WAITING_WORDS = {
  about:
    "These are changes people have suggested to concepts you decide. Open one to compare it with the current version. Accepting saves the change with the person who suggested it as its author. Declining sends them your reason.",
  loading: "The suggestions are still loading.",
  none: "Nothing is waiting on you. A change someone suggests to a concept you decide appears here.",
  count: (count: number): string => `${counted(count, "suggestion", "suggestions")} waiting`,
  proposedBy: "Suggested By",
  proposedOn: "Suggested On",
  owner: "Owner",
  noOwner: "No owner, so Admins decide",
  newConcept: "A new concept",
  baseMoved: "The concept changed after this was written.",
  places: (places: number): string => `Used in ${places} places`,
  next: "Open it to compare the versions, or select it to accept it with others.",
  select: (title: string): string => `Select ${title}`,
  selected: "Selected Suggestions",
  acceptSelected: "Accept Selected",
  selectFirst: "Please select a suggestion first.",
  stillGoing: "The previous decision is still in progress. Please try again when it has finished.",
  accepting: (count: number): string => `Accepting ${counted(count, "suggestion", "suggestions")}.`,
  reuse: (count: number): string =>
    count === 1
      ? "One selected concept is used in other places. Accepting changes it in every one."
      : `${count} selected concepts are used in other places. Accepting changes them in every one.`,
  noLongerListed: "A suggestion no longer listed",
} as const;

export const EDIT_WORDS = {
  loading: "The suggestion is still loading.",
  back: "Back to Waiting on You",
  accept: "Accept",
  decline: "Decline",
  current: "Current Version",
  proposed: "Suggested Version",
  changed: "Changed",
  title: "Title",
  text: "Text",
  noText: "No text.",
  sources: "Suggested Sources",
  noSources: "No sources.",
  newConcept: "This suggests a new concept, so there is no current version to compare.",
  currentWithheld:
    "You can’t read the current version of this concept, so only the suggested version is shown.",
  places: (places: number): string =>
    `Used in ${places} places. Accepting changes it in every one.`,
  acceptEverywhere: "Accept in Every Place",
  cancel: "Cancel",
  reason: "Reason for Declining",
  reasonHint: "The person who suggested this change reads your reason.",
  reasonNeeded: "Please write a reason before declining.",
  declineSuggestion: "Decline Suggestion",
  accepting: (title: string): string => `Accepting ${quoted(title)}.`,
  declining: (title: string): string => `Declining ${quoted(title)}.`,
} as const;

export const DECIDED_WORDS = {
  accepted: (proposer: string): string =>
    `Accepted. The change is committed with ${proposer} as its author.`,
  declined: (proposer: string): string => `Declined. ${opening(proposer)} can read your reason.`,
  returned: (proposer: string): string =>
    `Returned to ${proposer}, because the concept changed after they wrote this.`,
} as const;

export type Returned = "stale-precondition" | "resolution-moved";

const CANT_SAVE = "This suggestion can’t be saved as it stands. Please decline it with a reason.";

const RELOAD = "Please reload the page.";

export const SAID_OF_ACCEPTING = {
  "role-forbids": "Your role can’t accept this suggestion.",
  "owner-forbids": "You no longer own this concept, so an Admin decides this suggestion now.",
  "credentials-revoked": "Your sign-in has ended. Please sign in again.",
  "not-a-member": "You’re no longer a member of this workspace.",
  "role-unknown": `Your role here couldn’t be read. ${RELOAD}`,
  "role-disagrees": `Your role has changed. ${RELOAD}`,
  "no-such-suggestion": "This suggestion is no longer waiting.",
  "already-decided": "Someone has already decided this suggestion.",
  "no-such-concept": "The concept this suggestion changes no longer exists.",
  "no-such-document": `A source this suggestion cites no longer exists. ${CANT_SAVE}`,
  "no-such-repository": "This workspace’s knowledge can’t be saved yet. Please try again later.",
  "merge-key-taken": `Another concept already has this title. ${CANT_SAVE}`,
  "path-taken": `Another concept already has this title. ${CANT_SAVE}`,
  "rename-refused": "This suggestion would move the concept, which only an Admin can do.",
  "reclassification-refused":
    "This suggestion would change the concept’s sensitivity, which only an Admin can do.",
  "widening-refused":
    "This suggestion would share the concept more widely than you may, so an Admin decides it.",
  "reuse-unconfirmed": CANT_SAVE,
  unchanged: CANT_SAVE,
  malformed: CANT_SAVE,
  "malformed-claims": CANT_SAVE,
  "malformed-path": CANT_SAVE,
  "malformed-message": CANT_SAVE,
} as const satisfies Record<Exclude<DecidedWord, "accepted" | Returned>, string>;

export const SAID_OF_DECIDING = {
  malformed: "Please write a shorter reason and try again.",
  "owner-forbids": SAID_OF_ACCEPTING["owner-forbids"],
  "no-such-suggestion": SAID_OF_ACCEPTING["no-such-suggestion"],
  "already-decided": SAID_OF_ACCEPTING["already-decided"],
} satisfies OwnSentences;
