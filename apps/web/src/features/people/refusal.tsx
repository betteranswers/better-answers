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
    why: "Another change to these roles landed at the same moment.",
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
