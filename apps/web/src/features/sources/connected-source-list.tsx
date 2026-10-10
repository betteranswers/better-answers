import type { ReactNode } from "react";

import { SummaryRow as Row } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { counted } from "@/shared/words.ts";

import { Review } from "./review.tsx";
import { NARROWEST, widestAlready, type ListedConnectedSource } from "./sources-api.ts";
import { SOURCES_KEYSTROKES } from "./sources-state.ts";
import {
  AUDIENCE_WORDS,
  CONNECTOR_WORDS,
  DESTINATIONS_TERM,
  destinationOf,
  instantWords,
  lastSyncedWords,
  NEEDS_OCR,
  retentionOf,
  ROW_ACTIONS,
  STATE_MEANS,
  STATE_WORDS,
  unreadableCounted,
  unreadableWordOf,
} from "./words.ts";

type ConnectedSourceActions = {
  readonly onFocusConnectedSource: (connectedSourceId: string) => void;
  /** The row's button is a disclosure: a second press closes the review it opened. */
  readonly onReview: (connectedSourceId: string) => void;
  readonly onPublish: (connectedSource: ListedConnectedSource) => void;
  readonly onNarrow: (connectedSource: ListedConnectedSource) => void;
  readonly onWiden: (connectedSource: ListedConnectedSource) => void;
};

/** What is open inside a row: one review, and one narrowing or widening, on the page at a time. */
type OpenInARow = {
  readonly reviewing: string | undefined;
  /** A bulk action waits on its answer, so no row's button opens, closes or replaces a review. */
  readonly reviewHeld: boolean;
  readonly panel: { readonly connectedSourceId: string; readonly part: ReactNode } | undefined;
};

export const connectedSourceHeadingId = (connectedSourceId: string): string =>
  `connected-source-${connectedSourceId.toLowerCase()}`;

const audienceWords = (connectedSource: ListedConnectedSource): string => {
  const words = AUDIENCE_WORDS[connectedSource.audience];
  const named = connectedSource.audienceGroups?.length ?? 0;
  return named === 0 ? words : `${words} (${counted(named, "group", "groups")})`;
};

/** The one disclosure: what a reader weighs after the lead, never an action of its own. */
function MoreAbout(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly onFocus: () => void;
}) {
  const { connectedSource } = properties;
  const needingOcr = connectedSource.unreadableByReason[NEEDS_OCR] ?? 0;

  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-left whitespace-normal"
          onFocus={properties.onFocus}
        >
          More about {connectedSource.name}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <Row term="State">{STATE_MEANS[connectedSource.state]}</Row>
          <Row term={DESTINATIONS_TERM}>
            {connectedSource.destination.map((word) => (
              <p key={word}>{destinationOf(word).means}</p>
            ))}
          </Row>
          <Row term="Retention">{retentionOf(connectedSource.retentionClass).means}</Row>
          <Row term="Documents">{connectedSource.documentCount}</Row>
          <Row term="Passages">{connectedSource.passageCount}</Row>
          <Row term="Published">
            {connectedSource.publishedAt === null
              ? "Not published"
              : instantWords(connectedSource.publishedAt)}
          </Row>
          <Row term="Unreadable">
            {connectedSource.unreadable.length === 0 ? (
              "None"
            ) : (
              <>
                <p>{unreadableCounted(connectedSource.unreadable.length, needingOcr)}</p>
                <ul>
                  {connectedSource.unreadable.map((document) => (
                    <li key={document.documentId}>
                      {document.title}: {unreadableWordOf(document.reason)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Row>
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function RowAction(properties: {
  readonly action: keyof typeof ROW_ACTIONS;
  readonly name: string;
  readonly expanded?: boolean;
  readonly held?: boolean;
  readonly onFocus: () => void;
  readonly onPress: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      aria-expanded={properties.expanded}
      // Not `disabled`: a disabled button drops the focus the keyboard left on it.
      aria-disabled={properties.held ? true : undefined}
      className="aria-disabled:opacity-50"
      aria-keyshortcuts={SOURCES_KEYSTROKES[properties.action].key}
      onFocus={properties.onFocus}
      onClick={properties.onPress}
    >
      {ROW_ACTIONS[properties.action]}
      <span className="sr-only"> {properties.name}</span>
    </Button>
  );
}

function RowActions(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly actions: ConnectedSourceActions;
  readonly reviewing: boolean;
  readonly reviewHeld: boolean;
  readonly onFocus: () => void;
}) {
  const { connectedSource, actions, onFocus } = properties;
  const { name } = connectedSource;

  return (
    <div className="flex flex-wrap gap-2">
      <RowAction
        action="review"
        name={name}
        expanded={properties.reviewing}
        held={properties.reviewHeld}
        onFocus={onFocus}
        onPress={() => {
          actions.onReview(connectedSource.connectedSourceId);
        }}
      />
      {connectedSource.state === "indexed" ? (
        <RowAction
          action="publish"
          name={name}
          onFocus={onFocus}
          onPress={() => {
            actions.onPublish(connectedSource);
          }}
        />
      ) : null}
      {connectedSource.sensitivity === NARROWEST ? null : (
        <RowAction
          action="narrow"
          name={name}
          onFocus={onFocus}
          onPress={() => {
            actions.onNarrow(connectedSource);
          }}
        />
      )}
      {widestAlready(connectedSource) ? null : (
        <RowAction
          action="widen"
          name={name}
          onFocus={onFocus}
          onPress={() => {
            actions.onWiden(connectedSource);
          }}
        />
      )}
    </div>
  );
}

function ConnectedSourceItem(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly actions: ConnectedSourceActions;
  readonly reviewing: boolean;
  readonly reviewHeld: boolean;
  readonly panel: ReactNode;
}) {
  const { connectedSource, actions } = properties;
  const headingId = connectedSourceHeadingId(connectedSource.connectedSourceId);
  /** Every control in the row names its connected source as the one in focus, for the keystrokes. */
  const focused = () => {
    actions.onFocusConnectedSource(connectedSource.connectedSourceId);
  };

  return (
    <li
      aria-labelledby={headingId}
      className="border-t border-border py-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} tabIndex={-1} className="font-medium text-foreground">
          {connectedSource.name}
        </h3>
        <RowActions
          connectedSource={connectedSource}
          actions={actions}
          reviewing={properties.reviewing}
          reviewHeld={properties.reviewHeld}
          onFocus={focused}
        />
      </div>

      <dl className="mt-2 grid grid-cols-[max-content_1fr] items-baseline gap-x-4 gap-y-1">
        <Row term="Connector">{CONNECTOR_WORDS[connectedSource.connector]}</Row>
        <Row term="Sensitivity">
          <Pill>{connectedSource.sensitivity}</Pill>
        </Row>
        <Row term="Audience">{audienceWords(connectedSource)}</Row>
        <Row term="State">
          <Pill>{STATE_WORDS[connectedSource.state]}</Pill>
        </Row>
        <Row term="Last synced">{lastSyncedWords(connectedSource.lastSync)}</Row>
      </dl>

      <MoreAbout connectedSource={connectedSource} onFocus={focused} />
      {properties.panel}
      {properties.reviewing ? <Review connectedSource={connectedSource} /> : null}
    </li>
  );
}

export function ConnectedSourceList(properties: {
  readonly connectedSources: readonly ListedConnectedSource[];
  readonly actions: ConnectedSourceActions;
  readonly open: OpenInARow;
}) {
  const { open } = properties;

  return (
    <ul className="mt-4">
      {properties.connectedSources.map((connectedSource) => {
        const id = connectedSource.connectedSourceId;
        return (
          <ConnectedSourceItem
            key={id}
            connectedSource={connectedSource}
            actions={properties.actions}
            reviewing={open.reviewing === id}
            reviewHeld={open.reviewHeld}
            panel={open.panel?.connectedSourceId === id ? open.panel.part : null}
          />
        );
      })}
    </ul>
  );
}
