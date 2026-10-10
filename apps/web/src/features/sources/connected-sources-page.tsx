import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import type { ApiError } from "@/shared/api/trpc.ts";
import { EmptyState } from "@/shared/empty-state.tsx";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { useReadSaid } from "@/shared/read-said.ts";
import { counted } from "@/shared/words.ts";

import { ConnectAction } from "./connect-action.tsx";
import { movedWords, PublishDialog } from "./connected-source-dialogs.tsx";
import { connectedSourceHeadingId, ConnectedSourceList } from "./connected-source-list.tsx";
import { outcomeOfFailure } from "./refusal.tsx";
import { SensitivityPanel, type SensitivityChange } from "./sensitivity-panel.tsx";
import {
  EVERYONE,
  NARROWEST,
  useBulkActionPending,
  useConnectedSources,
  useNarrowConnectedSource,
  usePublish,
  useWidenConnectedSource,
  widestAlready,
  type ConnectedSourceNarrowed,
  type ConnectedSourceWidened,
  type ListedConnectedSource,
} from "./sources-api.ts";
import { REVIEW_HEADING, SENSITIVITY_FIELD, SOURCES_KEYSTROKES } from "./sources-state.ts";
import {
  AUDIENCE_WORDS,
  NOTHING_CONNECTED,
  SELECT_A_CONNECTED_SOURCE_FIRST,
  sensitivityAndAudienceWords,
  STATE_WORDS,
  THE_ACTION_BEFORE_IS_STILL_GOING,
  type SensitivityAndAudience,
} from "./words.ts";

const sources = menuGroupIn(CONTROL_CENTRE, "sources");

const LISTED = Object.values(SOURCES_KEYSTROKES);

const NOTHING_IN_FOCUS = selectFirst(SELECT_A_CONNECTED_SOURCE_FIRST);

const A_BULK_ACTION_IS_STILL_GOING: Outcome = {
  tone: "said",
  words: THE_ACTION_BEFORE_IS_STILL_GOING,
};

const waitsForItsSync = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words:
    connectedSource.state === "published"
      ? `“${connectedSource.name}” is already published.`
      : `“${connectedSource.name}” is ${STATE_WORDS[connectedSource.state].toLowerCase()}: publishing waits for its sync to finish.`,
});

const narrowestAlready = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: `“${connectedSource.name}” is ${connectedSource.sensitivity}, and no sensitivity is narrower.`,
});

const nothingWider = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: `“${connectedSource.name}” is ${sensitivityAndAudienceWords(connectedSource)}, and no sensitivity or audience is wider.`,
});

type Tell = (outcome: Outcome) => void;

const settledSaying = <Answer,>(tell: Tell, said: (answer: Answer) => ReactNode) => ({
  onSuccess: (answer: Answer) => {
    tell({ tone: "said", words: said(answer) });
  },
  onError: (failure: Error | ApiError) => {
    tell(outcomeOfFailure(failure, "action"));
  },
});

const focusOn = (id: string) => {
  document.getElementById(id)?.focus();
};

/** A keystroke pressed with nothing in focus has the page itself here, which takes no focus back. */
const theControlInFocus = (): HTMLElement | null => {
  const held = document.activeElement;
  return held instanceof HTMLElement && held !== document.body ? held : null;
};

type Changing = { readonly change: SensitivityChange; readonly connectedSourceId: string };

/** One narrowing or widening is open on the page at a time, drawn in its connected source's row. */
const useSensitivityPanel = (listed: readonly ListedConnectedSource[], tell: Tell) => {
  const [changing, setChanging] = useState<Changing>();
  const opener = useRef<HTMLElement>(null);
  const group = useRef<HTMLFieldSetElement>(null);
  const narrowAction = useNarrowConnectedSource();
  const widenAction = useWidenConnectedSource();
  const connectedSource = listed.find(
    (each) => each.connectedSourceId === changing?.connectedSourceId,
  );

  /** A control inside the open panel goes when the panel does, so it never becomes the opener. */
  const open = (asked: Changing) => {
    const focused = theControlInFocus();
    if (group.current?.contains(focused) !== true) opener.current = focused;
    flushSync(() => {
      setChanging(asked);
    });
    focusOn(SENSITIVITY_FIELD);
  };

  if (changing === undefined || connectedSource === undefined) return { open, panel: undefined };

  const { connectedSourceId, name } = connectedSource;

  /** Focus moves before the panel goes, or the button it stood on would take it along. */
  const cancel = () => {
    const from = opener.current;
    from?.focus();
    if (document.activeElement !== from) focusOn(connectedSourceHeadingId(connectedSourceId));
    setChanging(undefined);
  };

  /** A change must read as taken within a tenth of a second, so the panel closes before the api answers. */
  const commit = (asked: SensitivityAndAudience) => {
    focusOn(connectedSourceHeadingId(connectedSourceId));
    setChanging(undefined);
    if (changing.change === "narrow") {
      narrowAction.mutate(
        {
          connectedSourceId,
          sensitivity: asked.sensitivity,
          audience: connectedSource.audience,
          audienceGroups: connectedSource.audienceGroups,
        },
        settledSaying(tell, (narrowed: ConnectedSourceNarrowed) => (
          <>
            Narrowed “{name}” to {narrowed.visibility.sensitivity}. {movedWords(narrowed)}
          </>
        )),
      );
      return;
    }
    widenAction.mutate(
      {
        connectedSourceId,
        ...asked,
        audienceGroups: asked.audience === EVERYONE ? null : connectedSource.audienceGroups,
      },
      settledSaying(tell, (widened: ConnectedSourceWidened) => (
        <>
          Widened “{name}” to {sensitivityAndAudienceWords(widened.visibility)}.{" "}
          {movedWords(widened)}
        </>
      )),
    );
  };

  return {
    open,
    panel: {
      connectedSourceId,
      part: (
        <SensitivityPanel
          key={`${changing.change} ${connectedSourceId}`}
          change={changing.change}
          connectedSource={connectedSource}
          groupRef={group}
          pending={narrowAction.isPending || widenAction.isPending}
          onCancel={cancel}
          onCommit={commit}
        />
      ),
    },
  };
};

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
  const [outcome, setOutcome] = useState<Outcome>();
  const publishAction = usePublish();
  const reviewHeld = useBulkActionPending();

  const listed = connectedSources.data ?? [];
  const sensitivity = useSensitivityPanel(listed, setOutcome);
  const connectedSourceOf = (connectedSourceId: string | undefined) =>
    listed.find((connectedSource) => connectedSource.connectedSourceId === connectedSourceId);

  /** The review may open beyond the fold of a long row, so focus follows it to its heading. */
  const review = (connectedSourceId: string) => {
    flushSync(() => {
      setReviewing(connectedSourceId);
    });
    focusOn(REVIEW_HEADING);
  };

  /** A bulk action answers through the review that sent it, so no review moves until it has. */
  const heldAndSaid = (): boolean => {
    if (reviewHeld) setOutcome(A_BULK_ACTION_IS_STILL_GOING);
    return reviewHeld;
  };

  const reviewOrClose = (connectedSourceId: string) => {
    if (heldAndSaid()) return;
    if (reviewing === connectedSourceId) setReviewing(undefined);
    else review(connectedSourceId);
  };

  const publish = (connectedSource: ListedConnectedSource) => {
    if (connectedSource.state === "indexed") setPublishing(connectedSource.connectedSourceId);
    else setOutcome(waitsForItsSync(connectedSource));
  };

  const narrow = (connectedSource: ListedConnectedSource) => {
    if (connectedSource.sensitivity === NARROWEST) setOutcome(narrowestAlready(connectedSource));
    else
      sensitivity.open({ change: "narrow", connectedSourceId: connectedSource.connectedSourceId });
  };

  const widen = (connectedSource: ListedConnectedSource) => {
    if (widestAlready(connectedSource)) setOutcome(nothingWider(connectedSource));
    else
      sensitivity.open({ change: "widen", connectedSourceId: connectedSource.connectedSourceId });
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
    if (connectedSource === undefined || heldAndSaid()) return;
    review(connectedSource.connectedSourceId);
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

  const toPublish = connectedSourceOf(publishing);

  return (
    <>
      <PageHead heading={sources.name} summary={sources.summary} />

      <section aria-labelledby={listId} className="mt-6">
        <ListHead
          heading="Connected sources"
          headingId={listId}
          count={
            listed.length === 0
              ? ""
              : counted(listed.length, "connected source", "connected sources")
          }
          action={<ConnectAction />}
        />
        <OutcomeLine outcome={outcome} className="mt-2" />

        <ListStatus connectedSources={connectedSources} />

        {listed.length === 0 ? null : (
          <ConnectedSourceList
            connectedSources={listed}
            actions={{
              onFocusConnectedSource: setInFocus,
              onReview: reviewOrClose,
              onPublish: publish,
              onNarrow: narrow,
              onWiden: widen,
            }}
            open={{ reviewing, reviewHeld, panel: sensitivity.panel }}
          />
        )}
      </section>

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
                setOutcome,
                () =>
                  `Published “${toPublish.name}”: its passages reach ${AUDIENCE_WORDS[toPublish.audience].toLowerCase()} now, and the audit row is written.`,
              ),
            );
          }}
        />
      )}
    </>
  );
}
