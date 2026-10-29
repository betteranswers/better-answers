import type { ConceptIri } from "@better-answers/schema";

import type { ConceptRead, Frontmatter, Trust } from "../concepts/index.ts";
import type { Evidence, PassageView } from "./boundary.ts";
import type { PlannedAnswer } from "./plan.ts";

export const NOT_COMPANY_KNOWLEDGE = "Not company knowledge";

export const NO_COLLECTION = "No collection";

export type ConceptMatch<Iri extends string> = {
  readonly layer: "bundles";
  readonly iri: Iri;
  readonly kind: string;
  readonly title: string;
  readonly trust: Trust;
  readonly trustWords: string;
  readonly collection: string | null;
  readonly tags: readonly string[];
};

export type DocumentMatch = {
  readonly layer: "sources";
  readonly kind: "document";
  readonly title: string;
  readonly locator: string;
  readonly sensitivity: string;
  readonly openingLine: string;
};

export type FindMatch<Iri extends string = ConceptIri> = ConceptMatch<Iri> | DocumentMatch;

export type FindResult<Iri extends string = ConceptIri> = {
  readonly query: string;
  readonly matches: readonly FindMatch<Iri>[];

  readonly nextCursor?: string;
};

export type ConceptView<Iri extends string> = {
  readonly iri: Iri;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly relations: readonly {
    readonly kind: string;
    readonly target: Iri;
    readonly title: string;
  }[];
  readonly bodyLinks?: readonly {
    readonly ordinal: number;
    readonly address: string;
    readonly target: Iri;
  }[];
  readonly trust: Trust;
  readonly trustWords: string;
  readonly evidence: readonly Evidence<Iri>[];
};

type Opened<Iri extends string, View> =
  | {
      readonly found: true;
      readonly concept?: View | undefined;
      readonly passage?: PassageView | undefined;
    }
  | {
      readonly found: false;
      readonly iri?: Iri | undefined;
      readonly locator?: string | undefined;
    };

export type OpenView<Iri extends string = ConceptIri> = Opened<Iri, ConceptView<Iri>>;

type PaneWords = Pick<ConceptRead["pane"], "access" | "lead" | "next">;

export type OpenResult<Iri extends string = ConceptIri> = Opened<
  Iri,
  ConceptView<Iri> & PaneWords & Required<Pick<ConceptView<Iri>, "bodyLinks">>
>;

export type AnswerResult<Iri extends string = ConceptIri> = PlannedAnswer<Iri> & {
  readonly recordId: string;
};

export const NOT_ANSWERED = "Not answered from the company's knowledge.";
