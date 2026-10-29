import type { JudgeState, QuestionVerdict } from "@better-answers/schema";

import { ukLongDate } from "../concepts/index.ts";
import type { Evidence, PassageView } from "./boundary.ts";
import {
  ANSWER_KIND,
  type MapState,
  type PlannedAnswer,
  type PreviewedConcept,
  type RelatedConcept,
  type ReturnedConcept,
} from "./plan.ts";
import {
  NO_COLLECTION,
  NOT_COMPANY_KNOWLEDGE,
  NOT_ANSWERED,
  type FindMatch,
  type FindResult,
  type OpenView,
  type ConceptView,
  type AnswerResult,
} from "./results.ts";

const conceptLine = (
  concept: Pick<PreviewedConcept<string>, "kind" | "title" | "collection" | "trustWords" | "iri">,
): string =>
  `${concept.kind} · ${concept.title} · ${concept.collection ?? NO_COLLECTION} · ${concept.trustWords} · ${concept.iri}`;

const findLine = (match: FindMatch<string>): string =>
  match.layer === "bundles"
    ? conceptLine(match)
    : `${match.kind} · ${match.title} · ${NOT_COMPANY_KNOWLEDGE} · ${match.sensitivity} · ${match.locator} · ${JSON.stringify(match.openingLine)}`;

export const renderFind = (result: FindResult<string>): string => {
  if (result.matches.length === 0) return "Nothing in the company's knowledge matches that.";
  const lines = result.matches.map(findLine);
  return result.nextCursor === undefined
    ? lines.join("\n")
    : [...lines, "", `More follow: call find again with cursor ${result.nextCursor}`].join("\n");
};

const quoted = (text: string): readonly string[] => text.split(/\r?\n/u).map((line) => `> ${line}`);

export const renderOpen = (result: OpenView<string>): string => {
  if (!result.found) {
    return result.iri === undefined
      ? `No passage at ${result.locator ?? "that link"}.`
      : `No concept at ${result.iri}.`;
  }
  if (result.passage !== undefined) {
    const { passage } = result;
    return [
      ...quoted(passage.text),
      "",
      `— ${passage.source} (${passage.locator}) · ${passage.sensitivity}`,
    ].join("\n");
  }
  return result.concept === undefined ? "Nothing to show." : conceptText(result.concept);
};

const listed = (heading: string, lines: readonly string[]): readonly string[] =>
  lines.length === 0 ? [] : ["", heading, ...lines];

const evidenceLines = (evidence: readonly Evidence<string>[]): readonly string[] =>
  evidence.map(({ source, at, locator, iri }) => {
    const named = at === undefined ? source : `${source}, ${at}`;
    const opens = locator ?? iri;
    return opens === undefined ? `- ${named}` : `- ${named} (${opens})`;
  });

const conceptText = (concept: ConceptView<string>): string => {
  const title =
    typeof concept.frontmatter["title"] === "string" ? concept.frontmatter["title"] : concept.iri;
  const evidence = evidenceLines(concept.evidence);
  const related = concept.relations.map(
    ({ kind, title: named, target }) => `- ${kind} · ${named} · ${target}`,
  );
  const linked = new Map((concept.bodyLinks ?? []).map(({ address, target }) => [address, target]));
  return [
    `# ${title}`,
    "",
    concept.body.trimEnd(),
    "",
    `_${concept.trustWords}_`,
    ...listed("Evidence:", evidence),
    ...listed("Related:", related),
    ...listed(
      "Links in the body:",
      [...linked].map(([address, target]) => `- ${address} · ${target}`),
    ),
  ].join("\n");
};

export const mapWords = (map: MapState): string => {
  switch (map.state) {
    case "live":
      return "map as of now";
    case "unavailable_since":
      return `map unavailable since ${ukLongDate(map.since)}`;
  }
};

const VERDICT_LINES = {
  ok: "**Answered from the company's knowledge.**",
  warn: "**Answered with a warning for your role.**",
  refuse: `**${NOT_ANSWERED}**`,
  related:
    "**Related knowledge, not an answer.** Write only what these concepts state, naming each one you use, and quote an `Answer` word for word, opening one given as a line first.",
} satisfies Record<QuestionVerdict, string>;

const JUDGE_WORDS = {
  "not-judged": "Not judged",
  judged: "Judged",
  "judging-failed": "Judging failed",
} satisfies Record<JudgeState, string>;

const namedOrNone = (collections: readonly string[]): string =>
  collections.length === 0 ? "none" : collections.join(", ");

const returnedText = (heading: string, concept: ReturnedConcept<string>): readonly string[] => [
  "",
  `## ${heading}${concept.kind} · ${concept.collection ?? NO_COLLECTION}`,
  concept.kind === ANSWER_KIND ? `Question: ${concept.title}` : concept.title,
  `_${concept.trustWords}_`,
  "",
  concept.body.trimEnd(),
  ...listed("Evidence:", evidenceLines(concept.evidence)),
  "",
  concept.iri,
];

const RELATED_HEADING = "Related knowledge · ";

const PREVIEWS_HEADING =
  "Also bearing on the question, one line each: read one with `open` and its iri before writing from it.";

const relatedText = (related: readonly RelatedConcept<string>[]): readonly string[] => [
  ...related.flatMap((concept) =>
    "body" in concept ? returnedText(RELATED_HEADING, concept) : [],
  ),
  ...listed(
    PREVIEWS_HEADING,
    related.flatMap((concept) => ("body" in concept ? [] : [`- ${conceptLine(concept)}`])),
  ),
];

const FITS_HEADING = "Answers that fit, each word for word below:";

const fitLine = (fit: ReturnedConcept<string>): string =>
  `- ${fit.collection ?? NO_COLLECTION} · ${fit.title} · ${fit.iri}`;

const unmappedText = (passage: PassageView): readonly string[] => [
  "",
  `${NOT_COMPANY_KNOWLEDGE} · ${passage.sensitivity}`,
  ...quoted(passage.text),
  `— ${passage.source} (${passage.locator})`,
];

const FITS_THEN_RELATED =
  "**Related knowledge, which the judge did not pass as answering the question as asked.**";

const answeredText = (answer: PlannedAnswer<string>): readonly string[] =>
  answer.answers.length === 0
    ? relatedText(answer.related)
    : [
        ...answer.answers.flatMap((fit) => returnedText("", fit)),
        ...(answer.related.length === 0 ? [] : ["", FITS_THEN_RELATED]),
        ...relatedText(answer.related),
      ];

export const renderAnswer = (answer: AnswerResult<string>): string =>
  [
    VERDICT_LINES[answer.verdict],
    `Record of this question: ${answer.recordId}`,
    ...(answer.answers.length === 0 ? [] : [FITS_HEADING, ...answer.answers.map(fitLine)]),
    `_${JUDGE_WORDS[answer.judgeState]} · ${mapWords(answer.map)}_`,
    `Collections considered: ${namedOrNone(answer.collections)}`,
    `Collections you may name: ${namedOrNone(answer.readableCollections)}`,
    ...answeredText(answer),
    ...answer.unmappedPassages.flatMap(unmappedText),
  ].join("\n");
