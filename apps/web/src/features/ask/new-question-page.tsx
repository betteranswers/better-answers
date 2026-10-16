import { Link } from "@tanstack/react-router";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { LINK } from "@/shared/knowledge/concept-body.tsx";
import { SAID_OF_KNOWLEDGE } from "@/shared/knowledge/refusal-words.ts";
import { ASK, headingOf, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Textarea } from "@/shared/ui/textarea.tsx";

import { AnswerView } from "./answer-view.tsx";
import { useAnswering, type Answering } from "./ask-api.ts";
import { ASK_KEYSTROKES as KEY, QUESTION_MAX } from "./ask-state.ts";
import { ASK_WORDS as WORDS } from "./ask-words.ts";

const ASKING = menuGroupIn(ASK, "ask");

const NEW_QUESTION = pageNamed(ASKING, "New Question");

const CONNECT_CLAUDE = pageNamed(ASKING, "Connect Claude");

const LISTED = Object.values(KEY);

const { outcomeOfFailure } = refusalsOf(SAID_OF_KNOWLEDGE);

const refusedWords = (failure: Error | ApiError): ReactNode => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfFailure(failure, "action").words
    : stockWait(liftsInSeconds);
};

/** The status says the phase until the verdict, then the verdict, once; a refusal is an alert. */
const saidOf = (answering: Answering): Outcome | undefined => {
  const { failure, answer, streaming, phase } = answering;
  if (failure !== undefined) return { tone: "refused", words: refusedWords(failure) };
  if (answer !== undefined) return { tone: "said", words: WORDS.verdictSaid[answer.verdict] };
  return streaming ? { tone: "said", words: WORDS.phase[phase] } : undefined;
};

const toggled = (named: ReadonlySet<string>, collection: string, on: boolean) => {
  const next = new Set(named);
  if (on) next.add(collection);
  else next.delete(collection);
  return next;
};

/** Offered once an answer has said which collections the reader may name; none is every one. */
function Collections(properties: {
  readonly readable: readonly string[];
  readonly named: ReadonlySet<string>;
  readonly onChange: (named: ReadonlySet<string>) => void;
}) {
  const id = useId();
  const { readable, named, onChange } = properties;
  if (readable.length === 0) return null;
  return (
    <fieldset aria-describedby={`${id}-help`} className="grid gap-2">
      <legend className="mb-1 font-medium">{WORDS.collections}</legend>
      <p id={`${id}-help`} className="text-muted-foreground">
        {WORDS.collectionsHelp}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {readable.map((collection) => (
          <div key={collection} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-${collection}`}
              checked={named.has(collection)}
              onCheckedChange={(checked) => {
                onChange(toggled(named, collection, checked === true));
              }}
            />
            <Label htmlFor={`${id}-${collection}`} className="font-normal">
              {collection}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/** Enter asks and Shift+Enter starts a new line, as a message box does. */
const asksOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>): boolean =>
  event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing;

function QuestionForm(properties: {
  readonly answering: Answering;
  readonly readable: readonly string[];
}) {
  const { answering, readable } = properties;
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState("");
  const [named, setNamed] = useState<ReadonlySet<string>>(new Set());
  const [blank, setBlank] = useState(false);
  useKeystroke(KEY.question, () => {
    box.current?.focus();
  });

  // Focus stays in the box, so the next question is typed where the last one was.
  const ask = () => {
    box.current?.focus();
    if (answering.streaming) return;
    if (question.trim() === "") {
      setBlank(true);
      return;
    }
    setBlank(false);
    answering.ask({
      question,
      collections: readable.filter((collection) => named.has(collection)),
    });
  };

  return (
    <form
      className="grid gap-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        ask();
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor={`${id}-question`}>{WORDS.question}</Label>
        <Textarea
          ref={box}
          id={`${id}-question`}
          maxLength={QUESTION_MAX}
          aria-keyshortcuts={KEY.question.key}
          aria-invalid={blank ? true : undefined}
          aria-describedby={blank ? `${id}-blank` : undefined}
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          onKeyDown={(event) => {
            if (!asksOnEnter(event)) return;
            event.preventDefault();
            ask();
          }}
        />
        {blank ? (
          <p id={`${id}-blank`} role="alert">
            {WORDS.questionNeeded}
          </p>
        ) : null}
      </div>
      <Collections readable={readable} named={named} onChange={setNamed} />
      <Button
        type="submit"
        className="justify-self-start aria-disabled:cursor-not-allowed"
        aria-disabled={answering.streaming ? true : undefined}
      >
        {WORDS.ask}
      </Button>
      <OutcomeLine outcome={saidOf(answering)} />
    </form>
  );
}

const useReadable = (answering: Answering): readonly string[] => {
  const [readable, setReadable] = useState<readonly string[]>([]);
  const known = answering.answer?.readableCollections;
  if (known !== undefined && known !== readable) setReadable(known);
  return known ?? readable;
};

export function NewQuestionPage() {
  usePageKeystrokes(LISTED);
  const headingId = useId();
  const answering = useAnswering();
  const readable = useReadable(answering);
  const { answer } = answering;

  return (
    <>
      <h1>{headingOf(NEW_QUESTION)}</h1>
      <p className="mt-2 text-muted-foreground">
        {WORDS.lead.before}
        <Link to={CONNECT_CLAUDE.path} className={LINK}>
          {WORDS.lead.link}
        </Link>
        {WORDS.lead.after}
      </p>
      <section aria-labelledby={headingId} className="mt-6">
        <h2 id={headingId}>{WORDS.heading}</h2>
        <Card marks className="mt-4">
          <QuestionForm answering={answering} readable={readable} />
        </Card>
      </section>
      {answer === undefined ? null : (
        <AnswerView
          answer={answer}
          recordId={answer.recordId}
          drafting={answering.streaming && answering.phase === "drafting"}
        />
      )}
    </>
  );
}
