import type { SaidOfWord } from "@/shared/refusal-words.ts";

import { UPLOAD_CAP_MB } from "./words.ts";

export const SAID_OF_A_BINDING = {
  "role-forbids": {
    why: "Only an Admin of this workspace may do this.",
    next: "An Admin can take it from here.",
  },
  "no-such-binding": {
    why: "This workspace holds no such binding.",
    next: "Read the list again.",
  },
  "no-such-document": {
    why: "A document those finding groups sit in is not under this binding.",
    next: "Review the binding again.",
  },
  "no-such-finding": {
    why: "This binding holds no span of one of the ticked finding groups.",
    next: "Review the binding again; its last run may have moved on.",
  },
  "already-published": {
    why: "This binding is already published.",
    next: "Narrow it if it reaches too far.",
  },
  "not-indexed": {
    why: "The binding's index run has not finished.",
    next: "Publish once its state reads indexed.",
  },
  "confirmation-missing": {
    why: "A publish needs all three confirmations.",
    next: "Tick each one, then publish.",
  },
  "special-category-unreviewed": {
    why: "A special category finding in this binding is still unreviewed, and a binding holding one cannot widen.",
    next: "Review the binding, narrow or dismiss that finding group, then widen it.",
  },
  "media-type-refused": {
    why: "The platform converts markdown, plain text, Word (.docx) and PDF, and this file is none of them.",
    next: "Choose a file of one of those kinds.",
  },
  "too-large": {
    why: `The file is over the ${UPLOAD_CAP_MB} MB one upload may carry.`,
    next: "Bind a smaller file, or split this one.",
  },
  "not-the-always-set": {
    why: "Only a finding group of the always set can be kept in text.",
    next: "Untick the groups at another tier.",
  },
  "not-special-category": {
    why: "Only a special category finding group can be dismissed as not special category.",
    next: "Untick the groups of another category.",
  },
  "widening-refused": {
    why: "That would widen who may read it, and a narrowing never widens.",
    next: "Choose a class narrower than the one it has.",
  },
  "not-wider": {
    why: "That is no wider than the class and audience it has.",
    next: "Choose a wider class, or everyone in the workspace for its audience.",
  },
  "no-such-group": {
    why: "A named group is not one this workspace holds.",
    next: "Name the groups the People screen lists.",
  },
  malformed: {
    why: "Something in the form isn't valid, so nothing was saved.",
    next: "Check each field and send it again.",
  },
} satisfies SaidOfWord;
