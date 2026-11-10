import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { guidePageOf } from "@/features/knowledge/guides/guide-state.ts";
import type { Api } from "@test/stubbed-api.ts";
import { adaAnAdmin, adaAt, read } from "@test/two-workspaces.ts";

const ULID_LENGTH = 26;

export const idOf = (number: number): string => String(number).padStart(ULID_LENGTH, "0");

export const A_GUIDE_ID = idOf(7);

export const A_GUIDE_PAGE = guidePageOf(A_GUIDE_ID);

export const A_WRITE_UP_ID = idOf(31);

export const AN_INCLUDE_ID = idOf(41);

export const RACKING_IRI = `${CONCEPT_IRI_PREFIX}${idOf(51)}`;

export const LOAD_SURVEY_IRI = `${CONCEPT_IRI_PREFIX}${idOf(52)}`;

export const RACKING_TITLE = "Racking plan";

export const LIABILITY_TITLE = "Employers' liability insurance";

export const BRIEF_BEFORE = "Pallets are racked by row.";

export const BRIEF_MARKED = `Pallets are racked[^${AN_INCLUDE_ID}] by row.`;

type Changes = Readonly<Record<string, unknown>>;

export const aFact = (changes: Changes = {}) => ({
  factId: idOf(61),
  name: LIABILITY_TITLE,
  state: "missing",
  available: [],
  conceptType: "Insurance policy",
  tags: ["employers-liability"],
  ...changes,
});

export const aBrief = (changes: Changes = {}) => ({
  version: 2,
  rendered: {
    markdown: "Pallets are racked[^1] by row.",
    footnotes: [{ number: 1, label: AN_INCLUDE_ID, iri: RACKING_IRI, title: RACKING_TITLE }],
  },
  detail: [
    {
      iri: RACKING_IRI,
      title: RACKING_TITLE,
      conceptType: "Policy",
      body: "Each bay is racked by row.",
      evidence: [],
    },
  ],
  editable: {
    markdown: BRIEF_MARKED,
    footnotes: [{ label: AN_INCLUDE_ID, iri: RACKING_IRI, title: RACKING_TITLE }],
  },
  ...changes,
});

export const aViewersBrief = (changes: Changes = {}) => {
  const { editable: _editable, ...rest } = aBrief();
  return { ...rest, ...changes };
};

export const aSection = (changes: Changes = {}) => ({
  sectionId: idOf(21),
  writeUpId: A_WRITE_UP_ID,
  number: "1",
  prompt: "Warehouse racking",
  roleLabel: "know",
  usageNote: null,
  layers: ["assembled", "quoted"],
  hidden: false,
  needsReview: null,
  trust: { tier: "machine-confirmed", status: "current" },
  trustWords: "Verified automatically",
  copy: "offered",
  coverage: { met: 3, of: 4, facts: [aFact()] },
  brief: aBrief(),
  ...changes,
});

export const aGuide = (changes: Changes = {}) => ({
  guideId: A_GUIDE_ID,
  guideType: "Bid library",
  collection: "northgate",
  subject: { iri: RACKING_IRI, title: "Northgate Ltd" },
  coverage: { met: 3, of: 4 },
  owner: { id: idOf(81), name: "Dana Example" },
  sections: [aSection()],
  ...changes,
});

export const aGuideSummary = (changes: Changes = {}) => ({
  guideId: A_GUIDE_ID,
  guideType: "Bid library",
  collection: "northgate",
  subject: { iri: RACKING_IRI, title: "Northgate Ltd" },
  sections: 8,
  needsReview: 0,
  ...changes,
});

export const aGuideApi = (role: "Admin" | "Editor" | "Viewer", guide = aGuide()): Api => {
  const api = adaAnAdmin();
  api.set("session.member", () => adaAt(role));
  api.set("knowledge.guide", () => read(guide));
  api.set("knowledge.guides", () => read([aGuideSummary()]));
  return api;
};

export const SAVE_BRIEF = "knowledge.saveBrief";

export const BRIEF_COPY = "knowledge.briefCopy";

export const RECORD_COPY = "knowledge.recordCopy";

export const aBriefCopy = (changes: Changes = {}) => ({
  version: 2,
  html: "<p>Pallets are racked<sup>1</sup> by row.</p>",
  text: "Pallets are racked[1] by row.\n\nSources\n[1] Racking plan. No source recorded.",
  footnotes: 1,
  ...changes,
});

export const INCLUDE = "knowledge.includeAvailable";
