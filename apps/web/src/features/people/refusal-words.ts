import type { OwnSentences } from "@/shared/refusal-words.ts";

export const SAID_OF_A_MEMBER = {
  "last-admin": "A workspace needs at least one Admin. Make someone else an Admin first.",
} satisfies OwnSentences;

export const SAID_OF_TICKED_MEMBERS = {
  "last-admin":
    "This would leave the workspace without an Admin. Keep at least one Admin unselected.",
  "no-such-member": "No longer a member.",
  "no-such-group": "That group no longer exists.",
} satisfies OwnSentences;

export const SAID_OF_AN_INVITATION = {
  "already-a-member": "That address already belongs to a member.",
  "off-testing-domain": "This is a testing workspace. Use an address on its testing domain.",
  malformed: "Enter a valid email address.",
} satisfies OwnSentences;

export const SAID_OF_TICKED_INVITATIONS = {
  "no-such-invitation": "No longer waiting.",
  "off-testing-domain": "Not on the testing domain.",
} satisfies OwnSentences;

export const SAID_OF_A_GROUP = {
  "name-taken": "A group with that name already exists.",
  malformed: "Enter a group name.",
} satisfies OwnSentences;

export const SAID_OF_A_REQUEST = {
  "off-testing-domain":
    "A testing workspace can’t invite this address. Decline the request instead.",
} satisfies OwnSentences;
