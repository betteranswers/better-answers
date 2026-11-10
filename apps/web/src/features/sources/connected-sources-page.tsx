import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { onTheRowInFocus, rowInFocus } from "@/shared/list/row-focus.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { OutcomeLine, selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { EmptyState } from "@/shared/page/empty-state.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
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
  NOTHING_CONNECTED,
  OUTCOME_WORDS,
  PUBLISH_PENDING,
  SELECT_A_CONNECTED_SOURCE_FIRST,
  SENSITIVITY_PANEL_WORDS,
  sensitivityAndAudienceWords,
  THE_ACTION_BEFORE_IS_STILL_GOING,
  type SensitivityAndAudience,
} from "./words.ts";

const sources = menuGroupIn(CONTROL_CENTRE, "sources");

const THIS_PAGE = pageById(sources, "connected-sources");

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
      ? OUTCOME_WORDS.alreadyPublished(connectedSource.name)
      : OUTCOME_WORDS.publishAfterSync(connectedSource.name),
});

const narrowestAlready = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: OUTCOME_WORDS.already(connectedSource.name, connectedSource.sensitivity),
});

const nothingWider = (connectedSource: ListedConnectedSource): Outcome => ({
  tone: "said",
  words: OUTCOME_WORDS.already(connectedSource.name, sensitivityAndAudienceWords(connectedSource)),
});

type Tell = (outcome: Outcome | undefined) => void;

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

const theControlInFocus = (): HTMLElement | null => {
  const held = document.activeElement;
  return held instanceof HTMLElement && held !== document.body ? held : null;
};

type Changing = { readonly change: SensitivityChange; readonly connectedSourceId: string };

const useSensitivityPanel = (listed: readonly ListedConnectedSource[], tell: Tell) => {
  const [changing, setChanging] = useState<Changing>();
  const opener = useRef<HTMLElement>(null);
  const group = useRef<HTMLFieldSetElement>(null);
  const narrowAction = useNarrowConnectedSource();
  const widenAction = useWidenConnectedSource();
  const connectedSource = listed.find(
    (each) => each.connectedSourceId === changing?.connectedSourceId,
  );

  const open = (asked: Changing) => {
    const focused = theControlInFocus();
    if (group.current?.contains(focused) !== true) opener.current = focused;
    flushSync(() => {
      setChanging(asked);
    });
    focusOn(SENSITIVITY_FIELD);
  };

  const openOrClose = (asked: Changing) => {
    const shown =
      changing?.change === asked.change && changing.connectedSourceId === asked.connectedSourceId;
    if (shown) setChanging(undefined);
    else open(asked);
  };

  if (changing === undefined || connectedSource === undefined) {
    return { open, openOrClose, panel: undefined };
  }

  const { connectedSourceId, name } = connectedSource;

  const cancel = () => {
    const from = opener.current;
    from?.focus();
    if (document.activeElement !== from) focusOn(connectedSourceHeadingId(connectedSourceId));
    setChanging(undefined);
  };

  const commit = (asked: SensitivityAndAudience) => {
    focusOn(connectedSourceHeadingId(connectedSourceId));
    setChanging(undefined);
    tell({ tone: "said", words: SENSITIVITY_PANEL_WORDS[changing.change].pending });
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
            {OUTCOME_WORDS.narrowed(name, narrowed.visibility.sensitivity)} {movedWords(narrowed)}
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
          {OUTCOME_WORDS.widened(name, sensitivityAndAudienceWords(widened.visibility))}{" "}
          {movedWords(widened)}
        </>
      )),
    );
  };

  return {
    open,
    openOrClose,
    panel: {
      connectedSourceId,
      change: changing.change,
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
      {said.isPending ? <p>Loading connected sources…</p> : null}
      {said.error === null ? null : <p>{outcomeOfFailure(said.error, "read").words}</p>}
      {connectedSources.data?.length === 0 ? <EmptyState line={NOTHING_CONNECTED} /> : null}
    </div>
  );
}

export function ConnectedSourcesPage() {
  usePageKeystrokes(LISTED);
  const connectedSources = useConnectedSources();
  const listId = useId();
  const [reviewing, setReviewing] = useState<string>();
  const [publishing, setPublishing] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>();
  const publishAction = usePublish();
  const reviewHeld = useBulkActionPending();

  const listed = connectedSources.data ?? [];
  const sensitivity = useSensitivityPanel(listed, setOutcome);
  const connectedSourceOf = (connectedSourceId: string | undefined) =>
    listed.find((connectedSource) => connectedSource.connectedSourceId === connectedSourceId);

  const review = (connectedSourceId: string) => {
    flushSync(() => {
      setReviewing(connectedSourceId);
    });
    focusOn(REVIEW_HEADING);
  };

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

  const narrow = (connectedSource: ListedConnectedSource, opening = sensitivity.open) => {
    if (connectedSource.sensitivity === NARROWEST) setOutcome(narrowestAlready(connectedSource));
    else opening({ change: "narrow", connectedSourceId: connectedSource.connectedSourceId });
  };

  const widen = (connectedSource: ListedConnectedSource, opening = sensitivity.open) => {
    if (widestAlready(connectedSource)) setOutcome(nothingWider(connectedSource));
    else opening({ change: "widen", connectedSourceId: connectedSource.connectedSourceId });
  };

  const acting = onTheRowInFocus(
    () => rowInFocus(listed, (each) => each.connectedSourceId),
    setOutcome,
    NOTHING_IN_FOCUS,
  );
  useKeystroke(
    SOURCES_KEYSTROKES.review,
    acting((connectedSource) => {
      if (!heldAndSaid()) review(connectedSource.connectedSourceId);
    }),
  );
  useKeystroke(SOURCES_KEYSTROKES.publish, acting(publish));
  useKeystroke(SOURCES_KEYSTROKES.narrow, acting(narrow));
  useKeystroke(SOURCES_KEYSTROKES.widen, acting(widen));

  const toPublish = connectedSourceOf(publishing);

  return (
    <>
      <PageHead title={THIS_PAGE.name} />

      <section aria-labelledby={listId} className="mt-6">
        <ListHead
          heading={THIS_PAGE.name}
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
              onReview: reviewOrClose,
              onPublish: publish,
              onNarrow: (connectedSource) => {
                narrow(connectedSource, sensitivity.openOrClose);
              },
              onWiden: (connectedSource) => {
                widen(connectedSource, sensitivity.openOrClose);
              },
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
            setOutcome({ tone: "said", words: PUBLISH_PENDING });
            publishAction.mutate(
              { connectedSourceId: toPublish.connectedSourceId, confirmations },
              settledSaying(setOutcome, () =>
                OUTCOME_WORDS.published(toPublish.name, sensitivityAndAudienceWords(toPublish)),
              ),
            );
          }}
        />
      )}
    </>
  );
}
