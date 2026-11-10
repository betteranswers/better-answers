import type { OwnSentences } from "@/shared/refusal-words.ts";
import { counted } from "@/shared/words.ts";

import type { DecidedWord, WaitingPerson } from "./inbox-api.ts";
import { WAITING_ON_YOU } from "./inbox-state.ts";

const quoted = (title: string): string => `“${title}”`;

const opening = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

const FORMER_MEMBER = "a former member";

const UNNAMED = "a member with no display name yet";

export const personWords = (person: WaitingPerson | null): string => {
  if (person === null) return FORMER_MEMBER;
  return person.name === "" ? UNNAMED : person.name;
};

export const personShown = (person: WaitingPerson | null): string => opening(personWords(person));

const BASE_MOVED = "The concept has changed since this suggestion was made.";

export const WAITING_WORDS = {
  loading: "Loading suggestions…",
  none: "No suggestions are waiting for you.",
  count: (count: number): string => `${counted(count, "suggestion", "suggestions")} waiting`,
  proposedBy: "Suggested by",
  proposedOn: "Suggested on",
  owner: "Owner",
  noOwner: "No owner",
  newConcept: "New concept",
  baseMoved: BASE_MOVED,
  places: (places: number): string => `Used in ${places} places`,
  select: (title: string): string => `Select ${title}`,
  selected: "Selected suggestions",
  acceptSelected: "Accept selected",
  selectFirst: "Select a suggestion first.",
  focusFirst: "Move to a suggestion first.",
  stillGoing: "Wait for the previous action to finish.",
  accepting: (count: number): string => `Accepting ${counted(count, "suggestion", "suggestions")}…`,
  reuse: (count: number): string =>
    count === 1
      ? "One selected concept is used in other places."
      : `${count} selected concepts are used in other places.`,
  noLongerListed: "A suggestion no longer listed",
} as const;

export const EDIT_WORDS = {
  loading: "Loading the suggestion…",
  back: `Back to ${WAITING_ON_YOU.name}`,
  accept: "Accept",
  decline: "Decline",
  current: "Current version",
  proposed: "Suggested version",
  changed: "Changed",
  title: "Title",
  text: "Text",
  noText: "No text.",
  sources: "Suggested sources",
  noSources: "No sources.",
  noCurrent: {
    orphaned: "The concept this suggestion changes can no longer be found.",
    withheld: "You can’t read the current version of this concept.",
  },
  acceptEverywhere: "Accept in every place",
  cancel: "Cancel",
  reason: "Reason for declining",
  reasonShownTo: (proposer: string): string => `Shown to ${proposer}.`,
  reasonNeeded: "Write a reason for declining.",
  declineSuggestion: "Decline suggestion",
  accepting: (title: string): string => `Accepting ${quoted(title)}…`,
  declining: (title: string): string => `Declining ${quoted(title)}…`,
} as const;

export const DECIDED_WORDS = {
  accepted: (proposer: string): string => `Suggestion accepted, with ${proposer} as the author.`,
  declined: "Suggestion declined.",
  returned: (proposer: string): string => `Returned to ${proposer}. ${BASE_MOVED}`,
} as const;

export type Returned = "stale-precondition" | "resolution-moved";

const DECLINE_IT = "Decline it instead.";

const CANT_SAVE = `This suggestion can’t be saved. ${DECLINE_IT}`;

const RELOAD = "Reload the page.";

const OWNS_NOT = "You don’t own this concept.";

export const SAID_OF_ACCEPTING = {
  "role-forbids": "Your role can’t accept this suggestion.",
  "owner-forbids": OWNS_NOT,
  "credentials-revoked": "Your sign-in has ended. Sign in again.",
  "not-a-member": "You’re no longer a member of this workspace.",
  "role-unknown": `We couldn’t check your role. ${RELOAD}`,
  "role-disagrees": `Your role has changed. ${RELOAD}`,
  unconfirmed:
    "We couldn’t confirm the change was saved. If this suggestion is still listed in a minute, accept it again.",
  "unrecorded-head":
    "An earlier change is still saving. If this suggestion is still listed in a minute, accept it again.",
  "no-such-suggestion": "This suggestion is no longer waiting.",
  "already-decided": "Someone has already accepted or declined this suggestion.",
  "no-such-concept": `The concept this suggestion changes no longer exists. ${DECLINE_IT}`,
  "no-such-document": `A source this suggestion cites no longer exists. ${DECLINE_IT}`,
  "no-such-repository": "Changes can’t be saved to the knowledge base yet. Try again later.",
  "merge-key-taken": `Another concept already has this title. ${DECLINE_IT}`,
  "path-taken": `Another concept already has this title. ${DECLINE_IT}`,
  "rename-refused": "Only an Admin can accept a suggestion that moves a concept.",
  "reclassification-refused":
    "Only an Admin can accept a suggestion that changes a concept’s sensitivity.",
  "widening-refused":
    "This suggestion shares the concept more widely than your role allows. An Admin can accept it.",
  "reuse-unconfirmed": CANT_SAVE,
  unchanged: CANT_SAVE,
  malformed: CANT_SAVE,
  "malformed-claims": CANT_SAVE,
  "malformed-path": CANT_SAVE,
  "malformed-message": CANT_SAVE,
} as const satisfies Record<Exclude<DecidedWord, "accepted" | Returned>, string>;

export const SAID_OF_DECIDING = {
  malformed: "Write a shorter reason.",
  "owner-forbids": OWNS_NOT,
  "no-such-suggestion": SAID_OF_ACCEPTING["no-such-suggestion"],
  "already-decided": SAID_OF_ACCEPTING["already-decided"],
} satisfies OwnSentences;
