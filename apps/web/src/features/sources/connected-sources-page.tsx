import { useId, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import type { PageToolbar } from "@/shared/page-toolbar.tsx";
import { useReadSaid } from "@/shared/read-said.ts";

import { ConnectAction } from "./connect-action.tsx";
import {
  sensitivityAndAudienceWords,
  movedWords,
  NarrowDialog,
  PublishDialog,
  WidenDialog,
} from "./connected-source-dialogs.tsx";
import { ConnectedSourceList } from "./connected-source-list.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import { Review } from "./review.tsx";
import {
  EVERYONE,
  NARROWEST,
  useConnectedSources,
  useNarrowConnectedSource,
  usePublish,
  useWidenConnectedSource,
  widestAlready,
  type ConnectedSourceNarrowed,
  type ConnectedSourceWidened,
  type ListedConnectedSource,
} from "./sources-api.ts";
import { REVIEW_HEADING, SOURCES_KEYSTROKES } from "./sources-state.ts";
import { AUDIENCE_WORDS, NOTHING_CONNECTED } from "./words.ts";

const sources = menuGroupIn(CONTROL_CENTRE, "sources");

/**
 * The three bulk actions sit beside the findings they command, in the review: five actions in the band
 * scroll a 320px page sideways.
 */
export const CONNECTED_SOURCES_TOOLBAR: PageToolbar = {
  actions: <ConnectAction />,
};

const LISTED = Object.values(SOURCES_KEYSTROKES);

const NOTHING_IN_FOCUS = selectFirst("connectedSource");

const waitsForItsSync = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words:
    connectedSource.state === "published"
      ? `“${connectedSource.name}” is already published.`
      : `“${connectedSource.name}” is ${connectedSource.state}: publishing waits for its sync to finish.`,
});

const narrowestAlready = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: `“${connectedSource.name}” is ${connectedSource.sensitivity}, and no sensitivity is narrower.`,
});

const nothingWider = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: `“${connectedSource.name}” is ${sensitivityAndAudienceWords(connectedSource)}, and no sensitivity or audience is wider.`,
});

function ListStatus(properties: {
  readonly connectedSources: ReturnType<typeof useConnectedSources>;
}) {
  const { connectedSources } = properties;
  const said = useReadSaid(connectedSources);
  return (
    <div aria-live="polite" className="mt-2">
      {said.isPending ? <p>The connected sources are still loading.</p> : null}
      {said.error === null ? null : <p>{outcomeOfFailure(said.error, "read").words}</p>}
      {connectedSources.data?.length === 0 ? <EmptyState line={NOTHING_CONNECTED} /> : null}
    </div>
  );
}

export function ConnectedSourcesPage() {
  usePageKeystrokes(LISTED);
  const connectedSources = useConnectedSources();
  const listId = useId();
  const [inFocus, setInFocus] = useState<string>();
  const [reviewing, setReviewing] = useState<string>();
  const [publishing, setPublishing] = useState<string>();
  const [narrowing, setNarrowing] = useState<string>();
  const [widening, setWidening] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const publishAction = usePublish();
  const narrowAction = useNarrowConnectedSource();
  const widenAction = useWidenConnectedSource();

  const listed = connectedSources.data ?? [];
  const connectedSourceOf = (connectedSourceId: string | undefined) =>
    listed.find((connectedSource) => connectedSource.connectedSourceId === connectedSourceId);

  const settledSaying = <Answer,>(said: (answer: Answer) => ReactNode) => ({
    onSuccess: (answer: Answer) => {
      setOutcome({ tone: "said", words: said(answer) });
    },
    onError: (failure: Error | ApiError) => {
      setOutcome(outcomeOfFailure(failure, "action"));
    },
  });

  /** The review opens below the list, out of the reader's sight, so focus follows it there. */
  const review = (connectedSourceId: string) => {
    flushSync(() => {
      setReviewing(connectedSourceId);
    });
    document.getElementById(REVIEW_HEADING)?.focus();
  };

  const publish = (connectedSource: ListedConnectedSource) => {
    if (connectedSource.state === "indexed") setPublishing(connectedSource.connectedSourceId);
    else setOutcome(waitsForItsSync(connectedSource));
  };

  const narrow = (connectedSource: ListedConnectedSource) => {
    if (connectedSource.sensitivity === NARROWEST) setOutcome(narrowestAlready(connectedSource));
    else setNarrowing(connectedSource.connectedSourceId);
  };

  const widen = (connectedSource: ListedConnectedSource) => {
    if (widestAlready(connectedSource)) setOutcome(nothingWider(connectedSource));
    else setWidening(connectedSource.connectedSourceId);
  };

  /**
   * A letter pressed outside the list still needs a connected source, so the one whose row last held
   * focus stands.
   */
  const connectedSourceInFocusOrTell = (): ListedConnectedSource | undefined => {
    const connectedSource = connectedSourceOf(inFocus);
    if (connectedSource === undefined) setOutcome(NOTHING_IN_FOCUS);
    return connectedSource;
  };
  useKeystroke(SOURCES_KEYSTROKES.review, () => {
    const connectedSource = connectedSourceInFocusOrTell();
    if (connectedSource !== undefined) review(connectedSource.connectedSourceId);
  });
  useKeystroke(SOURCES_KEYSTROKES.publish, () => {
    const connectedSource = connectedSourceInFocusOrTell();
    if (connectedSource !== undefined) publish(connectedSource);
  });
  useKeystroke(SOURCES_KEYSTROKES.narrow, () => {
    const connectedSource = connectedSourceInFocusOrTell();
    if (connectedSource !== undefined) narrow(connectedSource);
  });
  useKeystroke(SOURCES_KEYSTROKES.widen, () => {
    const connectedSource = connectedSourceInFocusOrTell();
    if (connectedSource !== undefined) widen(connectedSource);
  });

  const underReview = connectedSourceOf(reviewing);
  const toPublish = connectedSourceOf(publishing);
  const toNarrow = connectedSourceOf(narrowing);
  const toWiden = connectedSourceOf(widening);

  return (
    <>
      <h1>{sources.name}</h1>
      <p className="mt-2 text-muted-foreground">{sources.summary}</p>

      <section aria-labelledby={listId} className="mt-6">
        <h2 id={listId}>Connected sources</h2>
        <OutcomeLine outcome={outcome} className="mt-2" />

        <ListStatus connectedSources={connectedSources} />

        {listed.length === 0 ? null : (
          <ConnectedSourceList
            connectedSources={listed}
            actions={{
              onFocusConnectedSource: setInFocus,
              onReview: review,
              onPublish: publish,
              onNarrow: narrow,
              onWiden: widen,
            }}
          />
        )}
      </section>

      {underReview === undefined ? null : (
        <Review key={underReview.connectedSourceId} connectedSource={underReview} />
      )}

      {toPublish === undefined ? null : (
        <PublishDialog
          key={toPublish.connectedSourceId}
          connectedSource={toPublish}
          onClose={() => {
            setPublishing(undefined);
          }}
          onConfirm={(confirmations) => {
            setPublishing(undefined);
            publishAction.mutate(
              { connectedSourceId: toPublish.connectedSourceId, confirmations },
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
          key={toNarrow.connectedSourceId}
          connectedSource={toNarrow}
          onClose={() => {
            setNarrowing(undefined);
          }}
          onConfirm={(sensitivity) => {
            setNarrowing(undefined);
            narrowAction.mutate(
              {
                connectedSourceId: toNarrow.connectedSourceId,
                sensitivity,
                audience: toNarrow.audience,
                audienceGroups: toNarrow.audienceGroups,
              },
              settledSaying((narrowed: ConnectedSourceNarrowed) => (
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
          key={toWiden.connectedSourceId}
          connectedSource={toWiden}
          onClose={() => {
            setWidening(undefined);
          }}
          onConfirm={(asked) => {
            setWidening(undefined);
            widenAction.mutate(
              {
                connectedSourceId: toWiden.connectedSourceId,
                ...asked,
                audienceGroups: asked.audience === EVERYONE ? null : toWiden.audienceGroups,
              },
              settledSaying((widened: ConnectedSourceWidened) => (
                <>
                  Widened “{toWiden.name}” to {sensitivityAndAudienceWords(widened.visibility)}.{" "}
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
