import { z } from "zod";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { ALL_KNOWLEDGE_PAGE } from "@/shared/knowledge/concept-address.ts";
import { aConceptRead, answeringConcepts } from "@test/knowledge/search-answers.ts";
import { server } from "@test/stub-server.ts";
import type { Api } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, NORTHERN, read } from "@test/two-workspaces.ts";

export const ALL_KNOWLEDGE = ALL_KNOWLEDGE_PAGE.path;

export type ConceptRow = {
  readonly iri: string;
  readonly title: string;
  readonly kind: string;
  readonly collection: string | null;
  readonly trust: { readonly tier: string; readonly status: string };
  readonly trustWords: string;
  readonly owner: { readonly id: string; readonly name: string; readonly own: boolean } | null;
  readonly checkedBy: string | null;
  readonly checkedOn: string | null;
};

const PAGE_SIZE = 50;

const ULID_LENGTH = 26;

const iriOf = (number: number): string =>
  `${CONCEPT_IRI_PREFIX}${String(number).padStart(ULID_LENGTH, "0")}`;

export const aConceptRow = (
  number: number,
  title: string,
  rest: Partial<ConceptRow> = {},
): ConceptRow => ({
  iri: iriOf(number),
  title,
  kind: "policy",
  collection: "policy",
  trust: { tier: "unverified", status: "current" },
  trustWords: "Unverified",
  owner: null,
  checkedBy: null,
  checkedOn: null,
  ...rest,
});

const ASKED = z.object({
  collections: z.array(z.string()),
  kind: z.string().optional(),
  sort: z.object({ column: z.string(), desc: z.boolean() }),
  page: z.number().default(1),
});

export type AllKnowledgeAsked = z.output<typeof ASKED>;

export const knowledgeAsks = (): readonly AllKnowledgeAsked[] =>
  server.asks
    .filter((ask) => ask.procedure === "knowledge.allKnowledge")
    .map((ask) => ASKED.parse(ask.input));

const keyOf = (row: ConceptRow, column: string): string =>
  ({
    title: row.title,
    kind: row.kind,
    collection: row.collection ?? "",
    owner: row.owner?.name ?? "",
    checked: row.checkedOn ?? "",
  })[column] ?? row.title;

const inTheCollections = (row: ConceptRow, collections: readonly string[]): boolean =>
  collections.length === 0 || (row.collection !== null && collections.includes(row.collection));

const matching = (asked: AllKnowledgeAsked) => (row: ConceptRow) =>
  inTheCollections(row, asked.collections) && (asked.kind === undefined || row.kind === asked.kind);

const answeringFrom = (listed: () => readonly ConceptRow[]) => (): unknown => {
  const asked = ASKED.parse(
    server.asks.findLast((ask) => ask.procedure === "knowledge.allKnowledge")?.input,
  );
  const matched = listed()
    .filter(matching(asked))
    .toSorted((one, other) => {
      const order = keyOf(one, asked.sort.column).localeCompare(keyOf(other, asked.sort.column));
      return asked.sort.desc ? -order : order;
    });
  const from = (asked.page - 1) * PAGE_SIZE;
  return read({
    rows: matched.slice(from, from + PAGE_SIZE),
    total: matched.length,
    page: asked.page,
    pageSize: PAGE_SIZE,
  });
};

const KINDS = [
  {
    kind: "policy",
    count: 3,
    collections: [
      { collection: "policy", count: 2 },
      { collection: "safety", count: 1 },
    ],
  },
  { kind: "lease", count: 1, collections: [{ collection: null, count: 1 }] },
];

export const RHIAN = {
  ...ADA,
  personId: "01JRHIAN0000000000000000AA",
  displayName: "Rhian Pryce",
  role: "Viewer",
};

export const asAnEditorOwning = (api: Api, collections: readonly string[]) => {
  api.set("session.member", () =>
    read({
      workspace: NORTHERN,
      person: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
      role: "Editor",
      owns: { collections, concepts: 0 },
    }),
  );
};

export const anAllKnowledgeApi = (listed: () => readonly ConceptRow[]): Api => {
  const api = adaAnAdmin();
  api.set("members.list", () => read([ADA, RHIAN]));
  api.set("knowledge.allKnowledge", answeringFrom(listed));
  api.set("knowledge.kinds", () => read({ kinds: KINDS }));
  api.set(
    "knowledge.open",
    answeringConcepts((iri) =>
      aConceptRead(
        listed().find((row) => row.iri === iri)?.title ?? "",
        Number(iri.slice(-ULID_LENGTH)),
      ),
    ),
  );
  return api;
};
