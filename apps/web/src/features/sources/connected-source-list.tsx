import { SummaryRow as Row } from "@/shared/summary-row.tsx";
import { Badge } from "@/shared/ui/badge.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { counted } from "@/shared/words.ts";

import { NARROWEST, widestAlready, type ListedConnectedSource } from "./sources-api.ts";
import { SOURCES_KEYSTROKES } from "./sources-state.ts";
import {
  AUDIENCE_WORDS,
  destinationOf,
  instantWords,
  NEEDS_OCR,
  quarantineWordOf,
  retentionOf,
  STATE_MEANS,
} from "./words.ts";

export type ConnectedSourceActs = {
  readonly onFocusConnectedSource: (connectedSourceId: string) => void;
  readonly onReview: (connectedSourceId: string) => void;
  readonly onPublish: (connectedSource: ListedConnectedSource) => void;
  readonly onNarrow: (connectedSource: ListedConnectedSource) => void;
  readonly onWiden: (connectedSource: ListedConnectedSource) => void;
};

export const connectedSourceHeadingId = (connectedSourceId: string): string =>
  `connected-source-${connectedSourceId.toLowerCase()}`;

const lastRunWords = (lastRun: ListedConnectedSource["lastRun"]): string => {
  if (lastRun === null) return "No run yet";
  return `Index run ${lastRun.status} · ${instantWords(lastRun.finishedAt ?? lastRun.enqueuedAt)}`;
};

const audienceWords = (connectedSource: ListedConnectedSource): string => {
  const words = AUDIENCE_WORDS[connectedSource.audience];
  const named = connectedSource.audienceGroups?.length ?? 0;
  return named === 0 ? words : `${words} (${counted(named, "group", "groups")})`;
};

/** The one disclosure: what a reader weighs after the lead, never an act of its own. */
function MoreAbout(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly onFocus: () => void;
}) {
  const { connectedSource } = properties;
  const wantingOcr = connectedSource.quarantinedByError[NEEDS_OCR] ?? 0;

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
          <Row term="State">
            {connectedSource.state}: {STATE_MEANS[connectedSource.state]}
          </Row>
          {connectedSource.destination.map((word) => {
            const destination = destinationOf(word);
            return (
              <Row key={word} term="Destination">
                {destination.word}: {destination.means}
              </Row>
            );
          })}
          <Row term="Retention">
            {retentionOf(connectedSource.retentionClass).word}:{" "}
            {retentionOf(connectedSource.retentionClass).means}
          </Row>
          <Row term="Documents">{connectedSource.documentCount}</Row>
          <Row term="Chunks">{connectedSource.chunkCount}</Row>
          <Row term="Published">
            {connectedSource.publishedAt === null
              ? "Not published"
              : instantWords(connectedSource.publishedAt)}
          </Row>
          <Row term="Quarantined">
            {connectedSource.quarantined.length === 0 ? (
              "None"
            ) : (
              <>
                <p>
                  {counted(connectedSource.quarantined.length, "document", "documents")}{" "}
                  quarantined, {counted(wantingOcr, "wants", "want")} OCR.
                </p>
                <ul>
                  {connectedSource.quarantined.map((document) => (
                    <li key={document.documentId}>
                      {document.title}: {quarantineWordOf(document.error)}
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

function ConnectedSourceItem(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly acts: ConnectedSourceActs;
}) {
  const { connectedSource, acts } = properties;
  const headingId = connectedSourceHeadingId(connectedSource.connectedSourceId);
  const named = <span className="sr-only"> {connectedSource.name}</span>;
  /** Every control in the row names its connected source as the one in focus, for the keystrokes. */
  const focused = () => {
    acts.onFocusConnectedSource(connectedSource.connectedSourceId);
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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-keyshortcuts={SOURCES_KEYSTROKES.review.key}
            onFocus={focused}
            onClick={() => {
              acts.onReview(connectedSource.connectedSourceId);
            }}
          >
            Review{named}
          </Button>
          {connectedSource.state === "indexed" ? (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.publish.key}
              onFocus={focused}
              onClick={() => {
                acts.onPublish(connectedSource);
              }}
            >
              Publish{named}
            </Button>
          ) : null}
          {connectedSource.sensitivity === NARROWEST ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.narrow.key}
              onFocus={focused}
              onClick={() => {
                acts.onNarrow(connectedSource);
              }}
            >
              Narrow{named}
            </Button>
          )}
          {widestAlready(connectedSource) ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.widen.key}
              onFocus={focused}
              onClick={() => {
                acts.onWiden(connectedSource);
              }}
            >
              Widen{named}
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row term="Connector">{connectedSource.connector}</Row>
        <Row term="Class">
          <Badge variant="outline">{connectedSource.sensitivity}</Badge>
        </Row>
        <Row term="Audience">{audienceWords(connectedSource)}</Row>
        <Row term="State">
          <Badge variant="outline">{connectedSource.state}</Badge>
        </Row>
        <Row term="Last run">{lastRunWords(connectedSource.lastRun)}</Row>
      </dl>

      <MoreAbout connectedSource={connectedSource} onFocus={focused} />
    </li>
  );
}

export function ConnectedSourceList(properties: {
  readonly connectedSources: readonly ListedConnectedSource[];
  readonly acts: ConnectedSourceActs;
}) {
  return (
    <ul className="mt-4">
      {properties.connectedSources.map((connectedSource) => (
        <ConnectedSourceItem
          key={connectedSource.connectedSourceId}
          connectedSource={connectedSource}
          acts={properties.acts}
        />
      ))}
    </ul>
  );
}
