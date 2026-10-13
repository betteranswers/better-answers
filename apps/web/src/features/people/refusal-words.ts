import type { OwnSentences } from "@/shared/refusal-words.ts";

export const SAID_OF_A_MEMBER = {
  "last-admin": "A workspace needs at least one Admin. Please make someone else an Admin first.",
} satisfies OwnSentences;

/** A bulk action refuses the whole set, so each item's line says why that one person stopped it. */
export const SAID_OF_TICKED_MEMBERS = {
  "last-admin":
    "This would leave the workspace without an Admin. Please keep at least one Admin unselected.",
  "no-such-member": "No longer a member.",
  "no-such-group": "That group no longer exists.",
} satisfies OwnSentences;

export const SAID_OF_AN_INVITATION = {
  "already-a-member": "That address already belongs to a member.",
  "off-testing-domain": "This is a testing workspace. Please use an address on its testing domain.",
  malformed: "Please enter a valid email address.",
} satisfies OwnSentences;

/** A set is refused whole, so each item's line says why that one invitation stopped it. */
export const SAID_OF_TICKED_INVITATIONS = {
  "no-such-invitation": "No longer waiting.",
  "off-testing-domain": "Not on the testing domain.",
} satisfies OwnSentences;

/** A group action refuses `malformed` for a name with no letter or figure in it. */
export const SAID_OF_A_GROUP = {
  "name-taken": "A group with that name already exists.",
  malformed: "Please enter a group name.",
} satisfies OwnSentences;

export const SAID_OF_A_REQUEST = {
  "off-testing-domain":
    "This is a testing workspace, so it can't invite this address. Please decline the request instead.",
} satisfies OwnSentences;
