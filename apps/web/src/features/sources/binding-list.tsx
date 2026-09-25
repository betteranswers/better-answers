import { Badge } from "@/shared/ui/badge.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { counted } from "@/shared/words.ts";

import { NARROWEST, widestAlready, type ListedBinding } from "./sources-api.ts";
import { SOURCES_KEYSTROKES } from "./sources-state.ts";
import { SummaryRow as Row } from "./summary-row.tsx";
import {
  AUDIENCE_WORDS,
  destinationOf,
  instantWords,
  NEEDS_OCR,
  quarantineWordOf,
  retentionOf,
  STATE_MEANS,
} from "./words.ts";

export type BindingActs = {
  readonly onFocusBinding: (bindingId: string) => void;
  readonly onReview: (bindingId: string) => void;
  readonly onPublish: (binding: ListedBinding) => void;
  readonly onNarrow: (binding: ListedBinding) => void;
  readonly onWiden: (binding: ListedBinding) => void;
};

export const bindingHeadingId = (bindingId: string): string => `binding-${bindingId.toLowerCase()}`;

const lastRunWords = (lastRun: ListedBinding["lastRun"]): string => {
  if (lastRun === null) return "No run yet";
  return `Index run ${lastRun.status} · ${instantWords(lastRun.finishedAt ?? lastRun.enqueuedAt)}`;
};

const audienceWords = (binding: ListedBinding): string => {
  const words = AUDIENCE_WORDS[binding.audience];
  const named = binding.audienceGroups?.length ?? 0;
  return named === 0 ? words : `${words} (${counted(named, "group", "groups")})`;
};

/** The one disclosure: what a reader weighs after the lead, never an act of its own. */
function MoreAbout(properties: { readonly binding: ListedBinding; readonly onFocus: () => void }) {
  const { binding } = properties;
  const wantingOcr = binding.quarantinedByError[NEEDS_OCR] ?? 0;

  return (
    <Collapsible className="mt-2">
      <CollapsibleTrigger asChild>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-left whitespace-normal"
          onFocus={properties.onFocus}
        >
          More about {binding.name}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <Row term="State">
            {binding.state}: {STATE_MEANS[binding.state]}
          </Row>
          {binding.destination.map((word) => {
            const destination = destinationOf(word);
            return (
              <Row key={word} term="Destination">
                {destination.word}: {destination.means}
              </Row>
            );
          })}
          <Row term="Retention">
            {retentionOf(binding.retentionClass).word}: {retentionOf(binding.retentionClass).means}
          </Row>
          <Row term="Documents">{binding.documentCount}</Row>
          <Row term="Chunks">{binding.chunkCount}</Row>
          <Row term="Published">
            {binding.publishedAt === null ? "Not published" : instantWords(binding.publishedAt)}
          </Row>
          <Row term="Quarantined">
            {binding.quarantined.length === 0 ? (
              "None"
            ) : (
              <>
                <p>
                  {counted(binding.quarantined.length, "document", "documents")} quarantined,{" "}
                  {counted(wantingOcr, "wants", "want")} OCR.
                </p>
                <ul>
                  {binding.quarantined.map((document) => (
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

function BindingItem(properties: { readonly binding: ListedBinding; readonly acts: BindingActs }) {
  const { binding, acts } = properties;
  const headingId = bindingHeadingId(binding.bindingId);
  const named = <span className="sr-only"> {binding.name}</span>;
  /** Every control in the row names its binding as the one in focus, for the keystrokes. */
  const focused = () => {
    acts.onFocusBinding(binding.bindingId);
  };

  return (
    <li
      aria-labelledby={headingId}
      className="border-t border-border py-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} tabIndex={-1} className="font-medium text-foreground">
          {binding.name}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-keyshortcuts={SOURCES_KEYSTROKES.review.key}
            onFocus={focused}
            onClick={() => {
              acts.onReview(binding.bindingId);
            }}
          >
            Review{named}
          </Button>
          {binding.state === "indexed" ? (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.publish.key}
              onFocus={focused}
              onClick={() => {
                acts.onPublish(binding);
              }}
            >
              Publish{named}
            </Button>
          ) : null}
          {binding.sensitivity === NARROWEST ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.narrow.key}
              onFocus={focused}
              onClick={() => {
                acts.onNarrow(binding);
              }}
            >
              Narrow{named}
            </Button>
          )}
          {widestAlready(binding) ? null : (
            <Button
              variant="outline"
              size="sm"
              aria-keyshortcuts={SOURCES_KEYSTROKES.widen.key}
              onFocus={focused}
              onClick={() => {
                acts.onWiden(binding);
              }}
            >
              Widen{named}
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <Row term="Connector">{binding.connector}</Row>
        <Row term="Class">
          <Badge variant="outline">{binding.sensitivity}</Badge>
        </Row>
        <Row term="Audience">{audienceWords(binding)}</Row>
        <Row term="State">
          <Badge variant="outline">{binding.state}</Badge>
        </Row>
        <Row term="Last run">{lastRunWords(binding.lastRun)}</Row>
      </dl>

      <MoreAbout binding={binding} onFocus={focused} />
    </li>
  );
}

export function BindingList(properties: {
  readonly bindings: readonly ListedBinding[];
  readonly acts: BindingActs;
}) {
  return (
    <ul className="mt-4">
      {properties.bindings.map((binding) => (
        <BindingItem key={binding.bindingId} binding={binding} acts={properties.acts} />
      ))}
    </ul>
  );
}
