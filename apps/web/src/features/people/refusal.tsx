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
