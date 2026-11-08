import { z } from "zod";

import { ULID } from "@better-answers/schema/ulid";

import { ADDRESS_QUERY } from "@/shared/address/address-query.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";
import { BROWSE, SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { detailAt, pageNamed } from "@/shared/navigation.ts";

import type { Guide, SectionFact } from "../knowledge-api.ts";
import { SEARCH_LIST } from "../knowledge-state.ts";
import type { NewConceptHeld } from "../new-concept.tsx";

export const GUIDES_PAGE = pageNamed(BROWSE, "Guides");

export const GUIDE_ID = z.string().regex(ULID);

export const guidePageOf = (guideId: string): string => detailAt(GUIDES_PAGE, guideId);

export const GUIDE_KEYSTROKES = {
  showDetail: { key: "d", action: "Show or hide the detail of the section in focus" },
  addFact: { key: "a", action: "Add the missing fact of the section in focus" },
  editBrief: { key: "e", action: "Edit the Brief of the section in focus" },
  copyBrief: { key: "c", action: "Copy the Brief of the section in focus" },
  saveBrief: { key: "Control+Enter", action: "Save the Brief you are editing" },
  leave: { key: "Escape", action: "Leave the Brief’s text for the editor’s buttons" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const SECTION_ACTIONS = {
  showDetail: "show-detail",
  editBrief: "edit-brief",
  copyBrief: "copy-brief",
  addFact: "add-fact",
} as const;

export const IN_THE_TEXT = '[role="textbox"]';

export type SectionAction = (typeof SECTION_ACTIONS)[keyof typeof SECTION_ACTIONS];

export const actionNamed = (action: SectionAction) => ({ "data-action": action });

type Titled = Pick<Guide, "collection" | "subject">;

const heldFor = (guide: Titled, fact: SectionFact): NewConceptHeld => ({
  new: fact.name,
  collection: guide.collection,
  kind: fact.kind,
  tags: fact.tags.join(", "),
  subject: guide.subject?.iri ?? "",
});

const keyedBySearch = (held: NewConceptHeld): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(held)
      .filter(([, value]) => value !== "")
      .map(([field, value]) => [`${SEARCH_LIST}.${field}`, value]),
  );

export const addFactAt = (guide: Titled, fact: SectionFact): string =>
  `${SEARCH_PAGE.path}${ADDRESS_QUERY.stringifySearch(keyedBySearch(heldFor(guide, fact)))}`;
