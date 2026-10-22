import { useNavigate } from "@tanstack/react-router";
import { useCallback, useId, useRef, useState, type ReactElement, type RefObject } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { useBreadcrumbLastPart } from "@/shared/breadcrumb-last-part.ts";
import { RowLink } from "@/shared/grid-table.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { ListState } from "@/shared/list-pages.tsx";
import { useRole } from "@/shared/member.ts";
import { headingOf } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/ownership.ts";
import { PageHead } from "@/shared/page-head.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Textarea } from "@/shared/ui/textarea.tsx";

import { outcomeOfFailure, ReuseConfirm } from "./accepting.tsx";
import { saidOfAccepting, stillWaitingAfter, type Said } from "./decided.ts";
import { EditCompared, SuggestedSources } from "./edit-compare.tsx";
import {
  decisionOf,
  useAccept,
  useDecline,
  useWaitingEdit,
  type WaitingEdit,
} from "./inbox-api.ts";
import { EDIT_KEYSTROKES as KEY, WAITING_ON_YOU, type DecidedOnItsPage } from "./inbox-state.ts";
import { DECIDED_WORDS, EDIT_WORDS as WORDS, personWords, WAITING_WORDS } from "./inbox-words.ts";
import { WaitingFacts } from "./waiting-facts.tsx";

const LISTED = Object.values(KEY);

const STILL_GOING: Outcome = { tone: "said", words: WAITING_WORDS.stillGoing };

type Asking = "nothing" | "reuse" | "reason";

const namesNothing = (failure: Error | ApiError): boolean => {
  const word = refusalOf(failure)?.word;
  return word === "not-found" || word === "malformed";
};

const useToTheList = (suggestionId: string) => {
  const navigate = useNavigate();
  return (decided?: DecidedOnItsPage) => {
    void navigate({
      href: WAITING_ON_YOU.path,
      state: (held) => ({
        ...held,
        decided,
        openedSuggestion: decided === undefined ? suggestionId : undefined,
      }),
    });
  };
};

const useDeciding = (edit: WaitingEdit, title: string) => {
  const { item } = edit;
  const accept = useAccept();
  const decline = useDecline();
  const toTheList = useToTheList(item.suggestionId);
  const [outcome, say] = useState<Outcome>();
  const [asking, setAsking] = useState<Asking>("nothing");
  const [unowned, setUnowned] = useState(false);
  useArrivalDecidedAgainOnceUnowned(unowned);
  const acting = accept.isPending || decline.isPending;

  const leaveSaying = (said: Said) => {
    toTheList({ suggestionId: item.suggestionId, said: said.words, refused: said.refused });
  };

  const refused = (failure: Error | ApiError) => {
    say(outcomeOfFailure(failure, "action"));
    setUnowned(ownsNoLonger(failure));
  };

  const acceptNow = () => {
    setAsking("nothing");
    say({ tone: "said", words: WORDS.accepting(title) });
    accept.mutate(
      { decisions: [decisionOf(item)] },
      {
        onSuccess: ({ outcomes }) => {
          const word = outcomes[0]?.outcome;
          if (word === undefined) return;
          const said = saidOfAccepting(word, item.proposer);
          if (!stillWaitingAfter(word)) {
            leaveSaying(said);
            return;
          }
          say({ tone: "refused", words: said.words });
          setUnowned(word === "owner-forbids");
        },
        onError: refused,
      },
    );
  };

  const declineNow = (reason: string) => {
    setAsking("nothing");
    say({ tone: "said", words: WORDS.declining(title) });
    decline.mutate(
      { suggestionId: item.suggestionId, reason },
      {
        onSuccess: () => {
          leaveSaying({
            words: DECIDED_WORDS.declined(personWords(item.proposer)),
            refused: false,
          });
        },
        onError: refused,
      },
    );
  };

  const unlessActing = (act: () => void) => () => {
    if (acting) say(STILL_GOING);
    else act();
  };

  return {
    outcome,
    asking,
    acting,
    accept: unlessActing(() => {
      if (item.places > 1) setAsking("reuse");
      else acceptNow();
    }),
    decline: unlessActing(() => {
      setAsking("reason");
    }),
    acceptNow,
    declineNow,
    cancel: () => {
      setAsking("nothing");
    },
    toTheList: () => {
      toTheList();
    },
  };
};

type Deciding = ReturnType<typeof useDeciding>;

function DeclineForm(properties: {
  readonly deciding: Deciding;
  readonly returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const { deciding, returnFocus } = properties;
  const fieldId = useId();
  const hintId = useId();
  const neededId = useId();
  const [reason, setReason] = useState("");
  const [needed, setNeeded] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const arrive = useCallback((textarea: HTMLTextAreaElement | null) => {
    field.current = textarea;
    textarea?.focus();
  }, []);

  return (
    <form
      className="mt-3 grid gap-2 border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim() === "") {
          setNeeded(true);
          field.current?.focus();
          return;
        }
        deciding.declineNow(reason.trim());
      }}
    >
      <Label htmlFor={fieldId}>{WORDS.reason}</Label>
      <p id={hintId} className="text-muted-foreground">
        {WORDS.reasonHint}
      </p>
      <Textarea
        ref={arrive}
        id={fieldId}
        required
        aria-invalid={needed}
        aria-describedby={needed ? `${hintId} ${neededId}` : hintId}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          setNeeded(false);
        }}
      />
      {needed ? (
        <p id={neededId} className="text-foreground">
          {WORDS.reasonNeeded}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{WORDS.declineSuggestion}</Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            deciding.cancel();
            returnFocus.current?.focus();
          }}
        >
          {WORDS.cancel}
        </Button>
      </div>
    </form>
  );
}

function EditShown(properties: { readonly edit: WaitingEdit }) {
  const { edit } = properties;
  const { item } = edit;
  const title = edit.current?.title ?? item.title;
  const titleId = useId();
  const acceptButton = useRef<HTMLButtonElement>(null);
  const declineButton = useRef<HTMLButtonElement>(null);
  const deciding = useDeciding(edit, title);
  const ownerShown = useRole() === "Admin";
  useBreadcrumbLastPart(title);

  usePageKeystrokes(LISTED);
  useKeystroke(KEY.accept, deciding.accept);
  useKeystroke(KEY.decline, deciding.decline);
  useKeystroke(KEY.back, deciding.toTheList);

  return (
    <article aria-labelledby={titleId} className="mt-6">
      <p>
        <RowLink href={WAITING_ON_YOU.path} onOpen={deciding.toTheList}>
          {WORDS.back}
        </RowLink>
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <h2 id={titleId} className="min-w-0 wrap-anywhere">
          {title}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            ref={acceptButton}
            aria-keyshortcuts={KEY.accept.key}
            aria-disabled={deciding.acting}
            className="aria-disabled:opacity-50"
            onClick={deciding.accept}
          >
            {WORDS.accept}
          </Button>
          <Button
            ref={declineButton}
            variant="outline"
            aria-keyshortcuts={KEY.decline.key}
            aria-disabled={deciding.acting}
            className="aria-disabled:opacity-50"
            onClick={deciding.decline}
          >
            {WORDS.decline}
          </Button>
        </div>
      </div>
      <OutcomeLine outcome={deciding.outcome} className="mt-2" />
      {deciding.asking === "reuse" ? (
        <ReuseConfirm
          said={WORDS.places(item.places)}
          onConfirm={deciding.acceptNow}
          onCancel={() => {
            deciding.cancel();
            acceptButton.current?.focus();
          }}
        />
      ) : null}
      {deciding.asking === "reason" ? (
        <DeclineForm deciding={deciding} returnFocus={declineButton} />
      ) : null}
      <WaitingFacts item={item} ownerShown={ownerShown} />
      <EditCompared edit={edit} />
      <SuggestedSources sources={edit.proposed.sources} />
    </article>
  );
}

function EditRead(properties: { readonly suggestionId: string; readonly notFound: ReactElement }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useWaitingEdit(properties.suggestionId);

  if (read.error !== null && namesNothing(read.error)) return properties.notFound;
  return (
    <>
      <PageHead heading={headingOf(WAITING_ON_YOU)} headingRef={heading} />
      {read.data !== undefined ? (
        <EditShown edit={read.data} />
      ) : read.error === null ? (
        <ListState state={{ kind: "loading", words: WORDS.loading }} />
      ) : (
        <ListState
          state={{
            kind: "failed",
            words: outcomeOfFailure(read.error, "read").words,
            onRetry: () => {
              void read.refetch();
            },
            focusAfterRetry: heading,
          }}
        />
      )}
    </>
  );
}

export function WaitingEditPage(properties: {
  readonly suggestionId: string | undefined;
  readonly notFound: ReactElement;
}) {
  const { suggestionId, notFound } = properties;
  if (suggestionId === undefined) return notFound;
  return <EditRead key={suggestionId} suggestionId={suggestionId} notFound={notFound} />;
}
