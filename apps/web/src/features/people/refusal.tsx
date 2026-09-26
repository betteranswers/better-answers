import type { ApiError } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { failureOutcome, type SaidOfWord } from "@/shared/refusal-outcome.tsx";

const SAID_OF_WORD = {
  "role-forbids": {
    why: "Only an Admin of this workspace sees its members.",
    next: "Ask one of its Admins for what you need.",
  },
  "last-admin": {
    why: "Nobody else here is an Admin, so the workspace would be left with none.",
    next: "Make someone else an Admin first.",
  },
  "changed-meanwhile": {
    why: "Another change to these members landed at the same moment.",
    next: "Read the list again and decide again.",
  },
  "no-such-member": {
    why: "This person is no longer a member of this workspace.",
    next: "Read the list again.",
  },
  "no-such-role": {
    why: "The roles here are Admin, Editor and Viewer.",
    next: "Pick one of the three.",
  },
  "not-a-member": {
    why: "You are not a member of this workspace.",
    next: "Sign in again to reach a workspace you belong to.",
  },
} satisfies SaidOfWord;

export const outcomeOfFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_WORD, failure);

const SAID_OF_AN_INVITATION = {
  "role-forbids": {
    why: "Only an Admin of this workspace sees and sends its invitations.",
    next: "Ask one of its Admins to invite the person.",
  },
  "already-a-member": {
    why: "That address belongs to a member of this workspace already.",
    next: "Find them on the Members tab.",
  },
  "no-such-invitation": {
    why: "That invitation is no longer waiting: it was accepted or cancelled.",
    next: "Read the list again.",
  },
  "no-such-role": {
    why: "A role is Admin, Editor or Viewer.",
    next: "Choose one of the three.",
  },
  malformed: {
    why: "That is not an email address.",
    next: "Check the address and send the invitation again.",
  },
} satisfies SaidOfWord;

export const outcomeOfInvitationFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_AN_INVITATION, failure);

/** A group act refuses `malformed` for a name with no letter or figure in it. */
const SAID_OF_A_GROUP = {
  "role-forbids": {
    why: "Only an Admin of this workspace sees its groups.",
    next: "Ask one of its Admins for what you need.",
  },
  "name-taken": {
    why: "A group in this workspace has that name already.",
    next: "Choose another name.",
  },
  malformed: {
    why: "A group's name needs at least one letter or figure.",
    next: "Give it a name.",
  },
  "no-such-group": {
    why: "That group is no longer in this workspace.",
    next: "Read the list again.",
  },
  "no-such-member": {
    why: "This person is no longer a member of this workspace.",
    next: "Read the list again.",
  },
  "already-in-group": {
    why: "That member is in that group already: another change put them there first.",
    next: "Read the list again.",
  },
  "not-in-group": {
    why: "That member is out of that group already: another change took them out first.",
    next: "Read the list again.",
  },
} satisfies SaidOfWord;

export const outcomeOfGroupFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_A_GROUP, failure);

const SAID_OF_A_REQUEST = {
  "role-forbids": {
    why: "Only an Admin of this workspace sees and decides its access requests.",
    next: "Ask one of its Admins to decide it.",
  },
  "already-decided": {
    why: "This request was decided while you were deciding it.",
    next: "Read the list again.",
  },
  "no-such-request": {
    why: "That request is no longer one of this workspace's.",
    next: "Read the list again.",
  },
  "no-such-role": {
    why: "A role is Admin, Editor or Viewer.",
    next: "Choose one of the three.",
  },
  malformed: {
    why: "The platform could not read which request this is.",
    next: "Read the list again.",
  },
} satisfies SaidOfWord;

export const outcomeOfRequestFailure = (failure: Error | ApiError): Outcome =>
  failureOutcome(SAID_OF_A_REQUEST, failure);
