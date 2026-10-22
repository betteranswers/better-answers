import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/ownership.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";

import { ownsNoLongerAny, saidOfEach, type ItemSaid } from "./decided.ts";
import { decisionOf, useAccept, type WaitingItem } from "./inbox-api.ts";
import { WAITING_KEYSTROKES as KEY } from "./inbox-state.ts";
import { EDIT_WORDS, SAID_OF_DECIDING, WAITING_WORDS as WORDS } from "./inbox-words.ts";

export type Ticked = ReadonlySet<string>;

export const NONE: Ticked = new Set();

const NOTHING_TICKED = selectFirst(WORDS.selectFirst);

const STILL_GOING: Outcome = { tone: "said", words: WORDS.stillGoing };

export const { outcomeOfFailure } = refusalsOf(SAID_OF_DECIDING);

const outcomeOfEach = (said: readonly ItemSaid[]): Outcome => {
  const refused = said.some((each) => each.refused);
  const [only] = said;
  if (said.length === 1 && only !== undefined) {
    return { tone: refused ? "refused" : "said", words: only.words };
  }
  return {
    tone: refused ? "refused" : "said",
    words: said.map(({ suggestionId, title, words }) => (
      <span key={suggestionId} className="block">
        {title}: {words}
      </span>
    )),
  };
};

const acceptingSaid = (chosen: readonly WaitingItem[]): Outcome => {
  const [only] = chosen;
  return {
    tone: "said",
    words:
      chosen.length === 1 && only !== undefined
        ? EDIT_WORDS.accepting(only.title)
        : WORDS.accepting(chosen.length),
  };
};

const reusedIn = (chosen: readonly WaitingItem[]): number =>
  chosen.filter((item) => item.places > 1).length;

type AcceptedList = {
  readonly items: readonly WaitingItem[];
  readonly ticked: Ticked;
  readonly tick: Dispatch<SetStateAction<Ticked>>;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
};

export const useAccepting = (list: AcceptedList) => {
  const accept = useAccept();
  const [confirming, setConfirming] = useState(false);
  const [unowned, setUnowned] = useState(false);
  useArrivalDecidedAgainOnceUnowned(unowned);

  const chosen = list.items.filter((item) => list.ticked.has(item.suggestionId));

  const run = () => {
    setConfirming(false);
    list.say(acceptingSaid(chosen));
    list.tick(NONE);
    list.heading.current?.focus();
    accept.mutate(
      { decisions: chosen.map(decisionOf) },
      {
        onSuccess: ({ outcomes }) => {
          list.say(outcomeOfEach(saidOfEach(outcomes, chosen)));
          setUnowned(ownsNoLongerAny(outcomes));
        },
        onError: (failure) => {
          list.tick((now) => new Set([...now, ...chosen.map((item) => item.suggestionId)]));
          list.say(outcomeOfFailure(failure, "action"));
          setUnowned(ownsNoLonger(failure));
        },
      },
    );
  };

  const acceptTicked = () => {
    if (accept.isPending) {
      list.say(STILL_GOING);
      return;
    }
    if (chosen.length === 0) {
      list.say(NOTHING_TICKED);
      return;
    }
    if (reusedIn(chosen) > 0) {
      setConfirming(true);
      return;
    }
    run();
  };

  const cancel = () => {
    setConfirming(false);
    list.heading.current?.focus();
  };

  useKeystroke(KEY.acceptSelected, acceptTicked);

  return {
    acting: accept.isPending,
    confirming: confirming && chosen.length > 0 ? reusedIn(chosen) : 0,
    acceptTicked,
    confirm: run,
    cancel,
  };
};

export function ReuseConfirm(properties: {
  readonly said: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const focusOnArrival = useCallback((button: HTMLButtonElement | null) => {
    button?.focus();
  }, []);

  return (
    <fieldset className="mt-3 grid gap-3 border border-border p-3">
      <legend className="float-left font-medium">{properties.said}</legend>
      <div className="flex flex-wrap gap-2">
        <Button ref={focusOnArrival} onClick={properties.onConfirm}>
          {EDIT_WORDS.acceptEverywhere}
        </Button>
        <Button variant="outline" onClick={properties.onCancel}>
          {EDIT_WORDS.cancel}
        </Button>
      </div>
    </fieldset>
  );
}
