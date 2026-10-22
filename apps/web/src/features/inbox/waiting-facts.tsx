import { SummaryRow as Row } from "@/shared/summary-row.tsx";
import { dayWords } from "@/shared/words.ts";

import type { WaitingItem } from "./inbox-api.ts";
import { personShown, WAITING_WORDS as WORDS } from "./inbox-words.ts";

const notesOf = (item: WaitingItem): readonly string[] => [
  ...(item.target === null ? [WORDS.newConcept] : []),
  ...(item.baseMoved ? [WORDS.baseMoved] : []),
  ...(item.places > 1 ? [WORDS.places(item.places)] : []),
];

export function WaitingFacts(properties: {
  readonly item: WaitingItem;
  readonly ownerShown: boolean;
}) {
  const { item, ownerShown } = properties;
  const notes = notesOf(item);

  return (
    <>
      <dl className="mt-2 grid items-baseline gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <Row term={WORDS.proposedBy}>{personShown(item.proposer)}</Row>
        <Row term={WORDS.proposedOn}>{dayWords(item.proposedAt)}</Row>
        {ownerShown ? (
          <Row term={WORDS.owner}>
            {item.owner === null ? WORDS.noOwner : personShown(item.owner)}
          </Row>
        ) : null}
      </dl>
      {notes.length === 0 ? null : (
        <ul className="mt-2 grid gap-1">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </>
  );
}
