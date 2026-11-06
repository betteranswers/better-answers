import { useId } from "react";

import { keyed } from "@/shared/list/keyed.ts";
import { SummaryRow as Row } from "@/shared/list/summary-row.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { paragraphsCompared, sourceLinesOf, type Paragraph } from "./edit-compared.ts";
import type { ConceptParts, CurrentVersion, WaitingEdit } from "./inbox-api.ts";
import { EDIT_WORDS as WORDS } from "./inbox-words.ts";

function ChangedTag() {
  return <Pill className="mr-2 align-baseline">{WORDS.changed}</Pill>;
}

function Version(properties: {
  readonly heading: string;
  readonly title: string;
  readonly titleChanged: boolean;
  readonly paragraphs: readonly Paragraph[];
}) {
  const headingId = useId();
  const { paragraphs } = properties;

  return (
    <section aria-labelledby={headingId} className="min-w-0 border border-border p-4">
      <h3 id={headingId}>{properties.heading}</h3>
      <dl className="mt-2 grid items-baseline gap-x-4 gap-y-1 grid-cols-[max-content_1fr]">
        <Row term={WORDS.title}>
          {properties.titleChanged ? <ChangedTag /> : null}
          <span className="wrap-anywhere">{properties.title}</span>
        </Row>
      </dl>
      <h4 className="mt-4 text-muted-foreground">{WORDS.text}</h4>
      {paragraphs.length === 0 ? (
        <p className="mt-2">{WORDS.noText}</p>
      ) : (
        <div className="mt-2 grid gap-3">
          {keyed(paragraphs, ({ text }) => text).map(({ key, item: paragraph }) => (
            <p key={key} className="whitespace-pre-wrap wrap-anywhere">
              {paragraph.changed ? <ChangedTag /> : null}
              {paragraph.text}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

type NotShown = Exclude<CurrentVersion, { readonly state: "shown" }>["state"];

function NoCurrentVersion(properties: { readonly state: NotShown }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="min-w-0 border border-border p-4">
      <h3 id={headingId}>{WORDS.current}</h3>
      <p className="mt-2">{WORDS.noCurrent[properties.state]}</p>
    </section>
  );
}

export function EditCompared(properties: { readonly edit: WaitingEdit }) {
  const { current: standing, proposed } = properties.edit;
  const current = standing.state === "shown" ? standing.version : null;
  const compared = paragraphsCompared(current?.body ?? null, proposed.body);
  const titleChanged = current !== null && current.title !== proposed.title;

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      {standing.state === "shown" ? (
        <Version
          heading={WORDS.current}
          title={standing.version.title}
          titleChanged={titleChanged}
          paragraphs={compared.current}
        />
      ) : (
        <NoCurrentVersion state={standing.state} />
      )}
      <Version
        heading={WORDS.proposed}
        title={proposed.title}
        titleChanged={titleChanged}
        paragraphs={compared.proposed}
      />
    </div>
  );
}

export function SuggestedSources(properties: { readonly sources: ConceptParts["sources"] }) {
  const headingId = useId();
  const lines = sourceLinesOf(properties.sources);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId}>{WORDS.sources}</h3>
      {lines.length === 0 ? (
        <p className="mt-2">{WORDS.noSources}</p>
      ) : (
        <ul className="mt-2 grid list-disc gap-1 pl-5">
          {keyed(lines, (line) => line).map(({ key, item: line }) => (
            <li key={key} className="wrap-anywhere">
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
