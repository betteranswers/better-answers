import { createContext, useContext, useId, useState, type ReactNode } from "react";

import type { JudgeState, QuestionVerdict } from "@better-answers/schema";

import type { ProsePart } from "@/shared/api/ask-stream.ts";
import { ConceptBody, type MarkOpening } from "@/shared/knowledge/concept-body.tsx";
import {
  EvidenceInline,
  EvidenceSheet,
  SensitivityTag,
  type Opened,
} from "@/shared/knowledge/evidence-panel.tsx";
import { openingOf, type Evidence } from "@/shared/knowledge/knowledge-reads.ts";
import { cn } from "@/shared/lib/utils.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { useRoomBeside } from "@/shared/wide-layout.ts";

import { FlagControl, HelpfulControl } from "./answer-feedback.tsx";
import { ASK_WORDS as WORDS } from "./ask-words.ts";

type ShownConcept = {
  readonly iri: string;
  readonly kind: string;
  readonly title: string;
  readonly collection: string | null;
  readonly trustWords: string;
  readonly body?: string;
  readonly evidence?: readonly Evidence[];
};

export type ShownAnswer = {
  readonly verdict: QuestionVerdict;
  readonly judgeState: JudgeState;
  readonly answers: readonly ShownConcept[];
  readonly related: readonly ShownConcept[];
  readonly unmappedPassages: readonly {
    readonly locator: string;
    readonly source: string;
    readonly sensitivity: string;
  }[];
  readonly prose: readonly ProsePart[];
};

type Panel = {
  readonly opened: Opened | undefined;
  readonly beside: boolean;
  readonly open: (chosen: Omit<Opened, "pressed">) => void;
  readonly close: () => void;
};

const PanelContext = createContext<Panel | undefined>(undefined);

const usePanel = (): Panel => {
  const panel = useContext(PanelContext);
  if (panel === undefined) throw new Error("a part of the answer is drawn outside its view");
  return panel;
};

function InlineHere(properties: { readonly openerIds: readonly string[] }) {
  const { opened, beside, close } = usePanel();
  if (beside || opened === undefined || !properties.openerIds.includes(opened.openerId)) {
    return null;
  }
  return <EvidenceInline opened={opened} onClose={close} />;
}

const useMarks = (concept: ShownConcept): MarkOpening => {
  const { opened, beside, open, close } = usePanel();
  const evidence = concept.evidence ?? [];
  return {
    openerId: opened?.openerId,
    onOpen: ({ openerId, source }) => {
      const item = evidence[source];
      const opens = openingOf(item);
      if (item === undefined || opens === undefined) return;
      open({
        key: `${concept.iri}:${String(source)}`,
        title: item.source,
        source: opens,
        openerId,
      });
    },
    inline:
      opened === undefined || beside ? undefined : (
        <EvidenceInline opened={opened} onClose={close} />
      ),
  };
};

function WordsOf(properties: { readonly concept: ShownConcept }) {
  const { concept } = properties;
  const marks = useMarks(concept);
  if (concept.body === undefined) return null;
  return (
    <ConceptBody
      body={concept.body}
      evidence={concept.evidence ?? []}
      opening={marks}
      headingsFrom={5}
    />
  );
}

const sectionNameOf = (collection: string | null): string => collection ?? WORDS.noCollection;

function CollectionSection(properties: {
  readonly collection: string | null;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h3 id={headingId}>{sectionNameOf(properties.collection)}</h3>
      {properties.children}
    </section>
  );
}

function FittingAnswer(properties: {
  readonly concept: ShownConcept;
  readonly recordId: string | undefined;
}) {
  const { concept, recordId } = properties;
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className="grid gap-2">
      <h4 id={headingId}>{concept.title}</h4>
      <p>
        <Pill>{concept.trustWords}</Pill>
      </p>
      <WordsOf concept={concept} />
      {recordId === undefined ? null : (
        <FlagControl
          recordId={recordId}
          name={WORDS.flagOf(concept.title)}
          label={WORDS.flag}
          disputed={{ sentence: concept.title, concept: concept.iri }}
        />
      )}
    </article>
  );
}

const OPENER =
  "h-auto min-w-0 grow basis-48 justify-start px-0 text-left font-medium break-words whitespace-normal";

function ConceptItem(properties: { readonly concept: ShownConcept }) {
  const { concept } = properties;
  const { opened, open } = usePanel();
  const openerId = useId();
  return (
    <li className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Pill>{concept.kind}</Pill>
        <Button
          id={openerId}
          variant="link"
          aria-expanded={opened?.openerId === openerId}
          className={OPENER}
          onClick={() => {
            open({
              key: concept.iri,
              title: concept.title,
              source: { kind: "concept", iri: concept.iri },
              openerId,
            });
          }}
        >
          {concept.title}
        </Button>
        <Pill>{concept.trustWords}</Pill>
      </div>
      <WordsOf concept={concept} />
      <InlineHere openerIds={[openerId]} />
    </li>
  );
}

function ConceptList(properties: { readonly concepts: readonly ShownConcept[] }) {
  return (
    <ol className="grid list-decimal gap-3 pl-6">
      {properties.concepts.map((concept) => (
        <ConceptItem key={concept.iri} concept={concept} />
      ))}
    </ol>
  );
}

const MARK = "h-auto min-h-6 min-w-6 px-0.5 py-0 font-mono [font-size:var(--text-xs)] leading-none";

type Cited = { readonly concept: ShownConcept; readonly place: number; readonly openerId: string };

function Footnote(properties: { readonly cited: Cited }) {
  const { concept, place, openerId } = properties.cited;
  const { opened, open } = usePanel();
  return (
    <sup>
      <Button
        id={openerId}
        variant="link"
        aria-label={WORDS.cites(place, concept.title)}
        aria-expanded={opened?.openerId === openerId}
        className={MARK}
        onClick={() => {
          open({
            key: concept.iri,
            title: concept.title,
            source: { kind: "concept", iri: concept.iri },
            openerId,
          });
        }}
      >
        [{place}]
      </Button>
    </sup>
  );
}

type Sentence = ProsePart["sentences"][number];

const citedBy = (
  sentence: Sentence,
  concepts: readonly ShownConcept[],
  idOf: (place: number) => string,
): readonly Cited[] =>
  sentence.concepts.flatMap((iri) => {
    const at = concepts.findIndex((concept) => concept.iri === iri);
    const concept = concepts[at];
    return concept === undefined ? [] : [{ concept, place: at + 1, openerId: idOf(at + 1) }];
  });

function DraftedSentence(properties: {
  readonly sentence: Sentence;
  readonly concepts: readonly ShownConcept[];
  readonly recordId: string | undefined;
}) {
  const { sentence, concepts, recordId } = properties;
  const baseId = useId();
  const cited = citedBy(sentence, concepts, (place) => `${baseId}-${String(place)}`);
  const restedOn = cited[0]?.concept.iri;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-start gap-x-2">
        <p className="max-w-measure">
          <span>{sentence.sentence}</span>
          {cited.map((each) => (
            <Footnote key={each.concept.iri} cited={each} />
          ))}
        </p>
        {recordId === undefined || restedOn === undefined ? null : (
          <FlagControl
            recordId={recordId}
            name={WORDS.flagOf(sentence.sentence)}
            disputed={{ sentence: sentence.sentence, concept: restedOn }}
          />
        )}
      </div>
      <InlineHere openerIds={cited.map(({ openerId }) => openerId)} />
    </div>
  );
}

function Prose(properties: {
  readonly part: ProsePart | undefined;
  readonly concepts: readonly ShownConcept[];
  readonly recordId: string | undefined;
}) {
  const { part, concepts, recordId } = properties;
  if (part === undefined) return null;
  const unwritten = part.outcome === undefined || part.outcome === "drafted" ? null : part.outcome;
  return (
    <div className="grid gap-2">
      {part.sentences.map((sentence, at) => (
        <DraftedSentence key={at} sentence={sentence} concepts={concepts} recordId={recordId} />
      ))}
      {unwritten === null ? null : (
        <p className="text-muted-foreground">{WORDS.unwritten[unwritten]}</p>
      )}
    </div>
  );
}

type Group = {
  readonly collection: string | null;
  readonly concepts: readonly ShownConcept[];
  readonly part: ProsePart | undefined;
};

const groupsOf = (
  concepts: readonly ShownConcept[],
  prose: readonly ProsePart[],
): readonly Group[] => {
  const collections = [
    ...new Set([
      ...concepts.map((concept) => concept.collection),
      ...prose.map((part) => part.collection),
    ]),
  ];
  return collections.map((collection) => ({
    collection,
    concepts: concepts.filter((concept) => concept.collection === collection),
    part: prose.find((part) => part.collection === collection),
  }));
};

function Fitting(properties: {
  readonly answer: ShownAnswer;
  readonly recordId: string | undefined;
}) {
  const { answer, recordId } = properties;
  const { close } = usePanel();
  return (
    <>
      {groupsOf(answer.answers, []).map((group) => (
        <CollectionSection key={group.collection ?? ""} collection={group.collection}>
          {group.concepts.map((concept) => (
            <FittingAnswer key={concept.iri} concept={concept} recordId={recordId} />
          ))}
        </CollectionSection>
      ))}
      {answer.related.length === 0 ? null : (
        <Collapsible
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm" className="justify-self-start">
              {WORDS.verdictHeading.related}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <ConceptList concepts={answer.related} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  );
}

function Related(properties: {
  readonly answer: ShownAnswer;
  readonly recordId: string | undefined;
}) {
  const { answer, recordId } = properties;
  return groupsOf(answer.related, answer.prose).map((group) => (
    <CollectionSection key={group.collection ?? ""} collection={group.collection}>
      <Prose part={group.part} concepts={group.concepts} recordId={recordId} />
      {group.concepts.length === 0 ? null : <ConceptList concepts={group.concepts} />}
    </CollectionSection>
  ));
}

function PassageItem(properties: { readonly passage: ShownAnswer["unmappedPassages"][number] }) {
  const { passage } = properties;
  const { opened, open } = usePanel();
  const openerId = useId();
  return (
    <li className="grid gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Button
          id={openerId}
          variant="link"
          aria-expanded={opened?.openerId === openerId}
          className={OPENER}
          onClick={() => {
            open({
              key: passage.locator,
              title: passage.source,
              source: { kind: "passage", locator: passage.locator, unmapped: true },
              openerId,
            });
          }}
        >
          {passage.source}
        </Button>
        <SensitivityTag sensitivity={passage.sensitivity} />
      </div>
      <InlineHere openerIds={[openerId]} />
    </li>
  );
}

function Unmapped(properties: { readonly passages: ShownAnswer["unmappedPassages"] }) {
  const headingId = useId();
  if (properties.passages.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="grid gap-3">
      <h3 id={headingId}>{WORDS.unmapped}</h3>
      <ul className="grid gap-3">
        {properties.passages.map((passage) => (
          <PassageItem key={passage.locator} passage={passage} />
        ))}
      </ul>
    </section>
  );
}

function Verdict(properties: {
  readonly answer: ShownAnswer;
  readonly recordId: string | undefined;
}) {
  const { answer, recordId } = properties;
  if (answer.verdict === "refuse") return null;
  if (answer.verdict === "related") return <Related answer={answer} recordId={recordId} />;
  return <Fitting answer={answer} recordId={recordId} />;
}

const usePanelState = (): Panel => {
  const [opened, setOpened] = useState<Opened>();
  const beside = useRoomBeside();
  return {
    opened,
    beside,
    open: (chosen) => {
      setOpened((current) => ({ ...chosen, pressed: (current?.pressed ?? 0) + 1 }));
    },
    close: () => {
      setOpened(undefined);
    },
  };
};

function Standing(properties: { readonly answer: ShownAnswer; readonly drafting: boolean }) {
  const { answer, drafting } = properties;
  return (
    <>
      {answer.verdict === "refuse" ? null : (
        <p>
          <Pill>{WORDS.judge[answer.judgeState]}</Pill>
        </p>
      )}
      {drafting ? <p className="text-muted-foreground">{WORDS.phase.drafting}</p> : null}
    </>
  );
}

function AnswerFeedback(properties: { readonly recordId: string | undefined }) {
  const { recordId } = properties;
  if (recordId === undefined) return null;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <HelpfulControl recordId={recordId} />
      <FlagControl recordId={recordId} name={WORDS.flagAnswer} label={WORDS.flagAnswer} keyed />
    </div>
  );
}

export function AnswerView(properties: {
  readonly answer: ShownAnswer;
  readonly recordId?: string;
  readonly drafting?: boolean;
}) {
  const { answer, recordId, drafting = false } = properties;
  const headingId = useId();
  const panel = usePanelState();
  const sheet = panel.opened !== undefined && panel.beside;
  return (
    <PanelContext value={panel}>
      <section
        aria-labelledby={headingId}
        aria-busy={drafting ? true : undefined}
        className={cn("mt-8 grid gap-6", sheet && "pr-[var(--container-md)]")}
      >
        <h2 id={headingId}>{WORDS.verdictHeading[answer.verdict]}</h2>
        <Standing answer={answer} drafting={drafting} />
        <Verdict answer={answer} recordId={recordId} />
        <Unmapped passages={answer.unmappedPassages} />
        <AnswerFeedback recordId={recordId} />
      </section>
      {panel.opened === undefined || !panel.beside ? null : (
        <EvidenceSheet opened={panel.opened} onClose={panel.close} />
      )}
    </PanelContext>
  );
}
