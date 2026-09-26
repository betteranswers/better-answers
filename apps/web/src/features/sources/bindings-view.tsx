import { useId, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { KeystrokesAct, useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { screenById } from "@/shared/screens.ts";
import type { ViewToolbar } from "@/shared/view-toolbar.tsx";

import { BindAct } from "./bind-act.tsx";
import {
  classAndAudienceWords,
  movedWords,
  NarrowDialog,
  PublishDialog,
  WidenDialog,
} from "./binding-dialogs.tsx";
import { BindingList } from "./binding-list.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import { Review } from "./review.tsx";
import {
  EVERYONE,
  NARROWEST,
  useBindings,
  useNarrowBinding,
  usePublish,
  useWidenBinding,
  widestAlready,
  type BindingNarrowed,
  type BindingWidened,
  type ListedBinding,
} from "./sources-api.ts";
import { REVIEW_HEADING, SOURCES_KEYSTROKES } from "./sources-state.ts";
import { AUDIENCE_WORDS, NOTHING_BOUND } from "./words.ts";

const sources = screenById("sources");

/**
 * The three bulk acts sit beside the findings they command, in the review: five acts in the band
 * scroll a 320px screen sideways.
 */
export const BINDINGS_TOOLBAR: ViewToolbar = {
  acts: (
    <>
      <BindAct />
      <KeystrokesAct screen={sources.name} keystrokes={Object.values(SOURCES_KEYSTROKES)} />
    </>
  ),
};

const NOTHING_IN_FOCUS = selectFirst("binding");

const waitsForItsRun = (binding: ListedBinding): Outcome => ({
  tone: "said",
  words:
    binding.state === "published"
      ? `“${binding.name}” is already published.`
      : `“${binding.name}” is ${binding.state}: publishing waits for its index run to finish.`,
});

const narrowestAlready = (binding: ListedBinding): Outcome => ({
  tone: "said",
  words: `“${binding.name}” is ${binding.sensitivity}, and no class is narrower.`,
});

const nothingWider = (binding: ListedBinding): Outcome => ({
  tone: "said",
  words: `“${binding.name}” is ${classAndAudienceWords(binding)}, and no class or audience is wider.`,
});

function ListStatus(properties: { readonly bindings: ReturnType<typeof useBindings> }) {
  const { bindings } = properties;
  return (
    <div aria-live="polite" className="mt-2">
      {bindings.isPending ? <p>The bindings are still loading.</p> : null}
      {bindings.error === null ? null : <p>{outcomeOfFailure(bindings.error).words}</p>}
      {bindings.data?.length === 0 ? <EmptyState line={NOTHING_BOUND} /> : null}
    </div>
  );
}

export function BindingsView() {
  const bindings = useBindings();
  const listId = useId();
  const [inFocus, setInFocus] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const [publishing, setPublishing] = useState<string>();
  const [narrowing, setNarrowing] = useState<string>();
  const [widening, setWidening] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const publishAct = usePublish();
  const narrowAct = useNarrowBinding();
  const widenAct = useWidenBinding();

  const listed = bindings.data ?? [];
  const bindingOf = (bindingId: string | undefined) =>
    listed.find((binding) => binding.bindingId === bindingId);

  const settledSaying = <Answer,>(said: (answer: Answer) => ReactNode) => ({
    onSuccess: (answer: Answer) => {
      setOutcome({ tone: "said", words: said(answer) });
    },
    onError: (failure: Error | ApiError) => {
      setOutcome(outcomeOfFailure(failure));
    },
  });

  /** The review opens below the list, out of the reader's sight, so focus follows it there. */
  const review = (bindingId: string) => {
    flushSync(() => {
      setReviewing(bindingId);
    });
    document.getElementById(REVIEW_HEADING)?.focus();
  };

  const publish = (binding: ListedBinding) => {
    if (binding.state === "indexed") setPublishing(binding.bindingId);
    else setOutcome(waitsForItsRun(binding));
  };

  const narrow = (binding: ListedBinding) => {
    if (binding.sensitivity === NARROWEST) setOutcome(narrowestAlready(binding));
    else setNarrowing(binding.bindingId);
  };

  const widen = (binding: ListedBinding) => {
    if (widestAlready(binding)) setOutcome(nothingWider(binding));
    else setWidening(binding.bindingId);
  };

  /**
   * A letter pressed outside the list still needs a binding, so the one whose row last held
   * focus stands.
   */
  const bindingInFocusOrTell = (): ListedBinding | undefined => {
    const binding = bindingOf(inFocus);
    if (binding === undefined) setOutcome(NOTHING_IN_FOCUS);
    return binding;
  };
  useKeystroke(SOURCES_KEYSTROKES.review, () => {
    const binding = bindingInFocusOrTell();
    if (binding !== undefined) review(binding.bindingId);
  });
  useKeystroke(SOURCES_KEYSTROKES.publish, () => {
    const binding = bindingInFocusOrTell();
    if (binding !== undefined) publish(binding);
  });
  useKeystroke(SOURCES_KEYSTROKES.narrow, () => {
    const binding = bindingInFocusOrTell();
    if (binding !== undefined) narrow(binding);
  });
  useKeystroke(SOURCES_KEYSTROKES.widen, () => {
    const binding = bindingInFocusOrTell();
    if (binding !== undefined) widen(binding);
  });

  const underReview = bindingOf(reviewing);
  const toPublish = bindingOf(publishing);
  const toNarrow = bindingOf(narrowing);
  const toWiden = bindingOf(widening);

  return (
    <>
      <h1>{sources.name}</h1>
      <p className="mt-2 text-muted-foreground">{sources.summary}</p>

      <section aria-labelledby={listId} className="mt-6">
        <h2 id={listId}>Bindings</h2>
        <OutcomeLine outcome={outcome} className="mt-2" />

        <ListStatus bindings={bindings} />

        {listed.length === 0 ? null : (
          <BindingList
            bindings={listed}
            acts={{
              onFocusBinding: setInFocus,
              onReview: review,
              onPublish: publish,
              onNarrow: narrow,
              onWiden: widen,
            }}
          />
        )}
      </section>

      {underReview === undefined ? null : (
        <Review key={underReview.bindingId} binding={underReview} />
      )}

      {toPublish === undefined ? null : (
        <PublishDialog
          key={toPublish.bindingId}
          binding={toPublish}
          onClose={() => {
            setPublishing(undefined);
          }}
          onConfirm={(confirmations) => {
            setPublishing(undefined);
            publishAct.mutate(
              { bindingId: toPublish.bindingId, confirmations },
              settledSaying(
                () =>
                  `Published “${toPublish.name}”: its passages reach ${AUDIENCE_WORDS[toPublish.audience].toLowerCase()} now, and the audit row is written.`,
              ),
            );
          }}
        />
      )}
      {toNarrow === undefined ? null : (
        <NarrowDialog
          key={toNarrow.bindingId}
          binding={toNarrow}
          onClose={() => {
            setNarrowing(undefined);
          }}
          onConfirm={(sensitivity) => {
            setNarrowing(undefined);
            narrowAct.mutate(
              {
                bindingId: toNarrow.bindingId,
                sensitivity,
                audience: toNarrow.audience,
                audienceGroups: toNarrow.audienceGroups,
              },
              settledSaying((narrowed: BindingNarrowed) => (
                <>
                  Narrowed “{toNarrow.name}” to {narrowed.visibility.sensitivity}.{" "}
                  {movedWords(narrowed)}
                </>
              )),
            );
          }}
        />
      )}
      {toWiden === undefined ? null : (
        <WidenDialog
          key={toWiden.bindingId}
          binding={toWiden}
          onClose={() => {
            setWidening(undefined);
          }}
          onConfirm={(asked) => {
            setWidening(undefined);
            widenAct.mutate(
              {
                bindingId: toWiden.bindingId,
                ...asked,
                audienceGroups: asked.audience === EVERYONE ? null : toWiden.audienceGroups,
              },
              settledSaying((widened: BindingWidened) => (
                <>
                  Widened “{toWiden.name}” to {classAndAudienceWords(widened.visibility)}.{" "}
                  {movedWords(widened)}
                </>
              )),
            );
          }}
        />
      )}
    </>
  );
}
