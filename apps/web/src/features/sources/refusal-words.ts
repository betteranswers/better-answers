import type { SaidOfWord } from "@/shared/refusal-words.ts";

import { UPLOAD_CAP_MB } from "./words.ts";

export const SAID_OF_A_CONNECTED_SOURCE = {
  "role-forbids": {
    why: "Only an Admin of this workspace may do this.",
    next: "An Admin can take it from here.",
  },
  "no-such-binding": {
    why: "This workspace holds no such connected source.",
    next: "Read the list again.",
  },
  "no-such-document": {
    why: "A document those groups of findings sit in is not under this connected source.",
    next: "Review the connected source again.",
  },
  "no-such-finding": {
    why: "This connected source holds no span of one of the ticked groups of findings.",
    next: "Review the connected source again; its last sync may have moved on.",
  },
  "already-published": {
    why: "This connected source is already published.",
    next: "Narrow it if it reaches too far.",
  },
  "not-indexed": {
    why: "The connected source's sync has not finished.",
    next: "Publish once its state reads indexed.",
  },
  "confirmation-missing": {
    why: "A publish needs all three confirmations.",
    next: "Tick each one, then publish.",
  },
  "special-category-unreviewed": {
    why: "A special category finding in this connected source is still unreviewed, and a connected source holding one cannot widen.",
    next: "Review the connected source, narrow or dismiss that group of findings, then widen it.",
  },
  "media-type-refused": {
    why: "The platform converts markdown, plain text, Word (.docx) and PDF, and this file is none of them.",
    next: "Choose a file of one of those kinds.",
  },
  "too-large": {
    why: `The file is over the ${UPLOAD_CAP_MB} MB one upload may carry.`,
    next: "Connect a smaller file, or split this one.",
  },
  "not-the-always-set": {
    why: "Only a group of findings in the always set can be kept in text.",
    next: "Untick the groups at another tier.",
  },
  "not-special-category": {
    why: "Only a special category group of findings can be dismissed as not special category.",
    next: "Untick the groups of another category.",
  },
  "widening-refused": {
    why: "That would widen who may read it, and a narrowing never widens.",
    next: "Choose a sensitivity narrower than the one it has.",
  },
  "not-wider": {
    why: "That is no wider than the sensitivity and audience it has.",
    next: "Choose a wider sensitivity, or everyone in the workspace for its audience.",
  },
  "no-such-group": {
    why: "A named group is not one this workspace holds.",
    next: "Name the groups the People page lists.",
  },
  malformed: {
    why: "Something in the form isn't valid, so nothing was saved.",
    next: "Check each field and send it again.",
  },
} satisfies SaidOfWord;
