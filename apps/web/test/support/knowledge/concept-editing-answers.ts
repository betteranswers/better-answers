import { z } from "zod";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { detailAt } from "@/shared/navigation.ts";
import { server } from "@test/stub-server.ts";
import type { Api } from "@test/stubbed-api.ts";
import { adaAnAdmin, read } from "@test/two-workspaces.ts";

const ULID = "01JRETENTN000000000000000A";

export const A_CONCEPT_IRI = `${CONCEPT_IRI_PREFIX}${ULID}`;

export const A_CONCEPT_PAGE = detailAt(SEARCH_PAGE, ULID);

export type Standing = "commits" | "suggests";

export const PARTS = {
  title: "Audit Logs Retention",
  kind: "Policy",
  description: null,
  tags: ["audit"],
  body: "Audit logs are kept for seven years.",
};

const TO_EDIT = {
  parts: PARTS,
  sources: ["Retention policy"],
  withheld: [],
  base: "first-base",
  standing: "commits",
  usedIn: 1,
};

export const aConceptToEdit = (changes: Readonly<Record<string, unknown>> = {}) =>
  read({ ...TO_EDIT, ...changes });

const aConceptOpened = (standing: Standing) =>
  read({
    found: true,
    concept: {
      iri: A_CONCEPT_IRI,
      frontmatter: { title: PARTS.title, type: PARTS.kind },
      body: PARTS.body,
      relations: [],
      bodyLinks: [],
      trust: { status: "unverified" },
      trustWords: "Unverified",
      evidence: [],
      access: "You can read this concept.",
      lead: "This concept answers from what the company has recorded.",
      next: "Ask a question to use it.",
    },
    standing,
  });

export const aConceptApi = (
  standing: Standing,
  toEdit: Readonly<Record<string, unknown>> = {},
): Api => {
  const api = adaAnAdmin();
  api.set("knowledge.open", () => aConceptOpened(standing));
  api.set("knowledge.conceptToEdit", () => aConceptToEdit({ standing, ...toEdit }));
  return api;
};

export const committed = () => read({ outcome: "committed", iri: A_CONCEPT_IRI, sha: "a-commit" });

export const unchanged = () => read({ outcome: "unchanged", iri: A_CONCEPT_IRI });

export const suggested = () =>
  read({ outcome: "suggested", suggestionId: "01JSUGGEST00000000000000A" });

export const asksOf = (procedure: string): readonly unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);

const SAVE_ASKED = z.object({
  parts: z.object({ title: z.string(), body: z.string() }),
  sources: z.array(z.unknown()),
  withheld: z.array(z.number()),
  reuse: z.literal("confirmed").optional(),
});

export const savesAsked = () =>
  asksOf("knowledge.saveConcept").map((asked) => SAVE_ASKED.parse(asked));
