import { CheckIcon } from "lucide-react";

import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/shared/ui/kibo-ui/combobox.tsx";

import type { CollectionOwned, Owner } from "../knowledge-api.ts";
import { COLLECTIONS_WORDS as WORDS } from "../knowledge-words.ts";

const NOBODY = "nobody";

export const pickerIdOf = (collection: string): string =>
  `owner-of-${encodeURIComponent(collection)}`;

export const nameOf = (owner: Owner): string => (owner.name === "" ? WORDS.unnamed : owner.name);

const byName = (_value: string, search: string, keywords?: string[]): number =>
  keywords?.some((name) => name.toLowerCase().includes(search.toLowerCase())) === true ? 1 : 0;

const withTheOwner = (choices: readonly Owner[], owner: Owner | null): readonly Owner[] =>
  owner === null || choices.some((choice) => choice.id === owner.id)
    ? choices
    : [owner, ...choices];

export function OwnerPicker(properties: {
  readonly owned: CollectionOwned;
  readonly choices: readonly Owner[];
  readonly onPick: (chosen: Owner | null) => void;
}) {
  const { owned, onPick } = properties;
  const people = withTheOwner(properties.choices, owned.owner);
  const current = owned.owner?.id ?? NOBODY;
  const items = [
    { value: NOBODY, label: WORDS.noOwner },
    ...people.map((person) => ({ value: person.id, label: nameOf(person) })),
  ];
  const held = items.find((item) => item.value === current);

  return (
    <Combobox
      data={items}
      type="owner"
      value={current}
      onValueChange={(picked) => {
        if (picked === current) return;
        onPick(people.find((person) => person.id === picked) ?? null);
      }}
    >
      <ComboboxTrigger
        id={pickerIdOf(owned.collection)}
        aria-label={WORDS.ownerOf(collectionNameOf(owned.collection), held?.label ?? WORDS.noOwner)}
        className="w-full min-w-0 justify-between font-normal"
      />
      <ComboboxContent filter={byName} popoverOptions={{ align: "start" }} className="min-w-56">
        <ComboboxInput
          placeholder={WORDS.searchPeople}
          className="focus-visible:shadow-[inset_0_-2px_0_var(--accent-600)]!"
        />
        <ComboboxList aria-label={WORDS.people}>
          <ComboboxEmpty>{WORDS.nobody}</ComboboxEmpty>
          <ComboboxGroup>
            {items.map((item) => (
              <ComboboxItem key={item.value} value={item.value} keywords={[item.label]}>
                {item.label}
                {item.value === current ? <CheckIcon className="ml-auto size-4" /> : null}
              </ComboboxItem>
            ))}
          </ComboboxGroup>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
