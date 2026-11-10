import { SummaryRow as Row } from "@/shared/list/summary-row.tsx";
import { dayWords } from "@/shared/words.ts";

import { suggestsNewConcept, type WaitingItem } from "./inbox-api.ts";
import { personShown, WAITING_WORDS as WORDS } from "./inbox-words.ts";

type Note = { readonly words: string; readonly id?: string | undefined };

const notesOf = (item: WaitingItem, placesId: string | undefined): readonly Note[] => [
  ...(suggestsNewConcept(item) ? [{ words: WORDS.newConcept }] : []),
  ...(item.baseMoved ? [{ words: WORDS.baseMoved }] : []),
  ...(item.places > 1 ? [{ words: WORDS.places(item.places), id: placesId }] : []),
];

export function WaitingFacts(properties: {
  readonly item: WaitingItem;
  readonly ownerShown: boolean;
  readonly placesId?: string;
}) {
  const { item, ownerShown } = properties;
  const notes = notesOf(item, properties.placesId);

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
            <li key={note.words} id={note.id}>
              {note.words}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
