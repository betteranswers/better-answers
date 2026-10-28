import { useId, useRef, useState } from "react";

import { useKeystroke, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { ListRead, ListState } from "@/shared/list/list-pages.tsx";
import { keyedRow, rowInFocus } from "@/shared/list/row-focus.ts";
import { SummaryRow as Row } from "@/shared/list/summary-row.tsx";
import { useRole } from "@/shared/member/member.ts";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/member/ownership.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select.tsx";

import {
  useCollections,
  useNameOwner,
  useOwnerChoices,
  type CollectionOwned,
  type Owner,
} from "./knowledge-api.ts";
import { COLLECTIONS_KEYSTROKES as KEY } from "./knowledge-state.ts";
import { COLLECTIONS_WORDS as WORDS, SAID_OF_COLLECTIONS } from "./knowledge-words.ts";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const COLLECTIONS_AND_OWNERS = pageNamed(CURATION, "Collections and Owners");

const NAMING: readonly Keystroke[] = [KEY.changeOwner];

const NO_KEYSTROKES: readonly Keystroke[] = [];

const NO_OWNER = "";

const NONE: readonly CollectionOwned[] = [];

const { outcomeOfFailure } = refusalsOf(SAID_OF_COLLECTIONS);

const pickerIdOf = (collection: string): string => `owner-of-${encodeURIComponent(collection)}`;

const nameOf = (owner: Owner): string => (owner.name === "" ? WORDS.unnamed : owner.name);

const ownerWords = (owner: Owner | null): string =>
  owner === null ? WORDS.unowned : nameOf(owner);

const ownOwnersWords = (count: number): string =>
  count === 0 ? WORDS.noOwnOwners : WORDS.ownOwnersCount(count);

const withTheOwner = (choices: readonly Owner[], owner: Owner | null): readonly Owner[] =>
  owner === null || choices.some((choice) => choice.id === owner.id)
    ? choices
    : [owner, ...choices];

type Naming = {
  readonly choices: readonly Owner[];
  readonly save: (owned: CollectionOwned, chosen: Owner | null) => void;
};

const unchangedSaid = ({ collection, owner }: CollectionOwned): Outcome => ({
  tone: "said",
  words:
    owner === null
      ? WORDS.alreadyUnowned(collection)
      : WORDS.alreadyOwns(nameOf(owner), collection),
});

const namedSaid = (collection: string, chosen: Owner | null): Outcome => ({
  tone: "said",
  words: chosen === null ? WORDS.cleared(collection) : WORDS.named(nameOf(chosen), collection),
});

const useNaming = (choices: readonly Owner[], say: (outcome: Outcome) => void): Naming => {
  const naming = useNameOwner();
  return {
    choices,
    save: (owned, chosen) => {
      const personId = chosen?.id ?? null;
      if ((owned.owner?.id ?? null) === personId) {
        say(unchangedSaid(owned));
        return;
      }
      naming.mutate(
        { collection: owned.collection, personId },
        {
          onSuccess: () => {
            say(namedSaid(owned.collection, chosen));
          },
          onError: (failure) => {
            say(outcomeOfFailure(failure, "action"));
          },
        },
      );
    },
  };
};

function OwnerPicker(properties: { readonly owned: CollectionOwned; readonly naming: Naming }) {
  const { owned, naming } = properties;
  const ownerId = owned.owner?.id ?? NO_OWNER;
  const [choice, setChoice] = useState({ of: ownerId, chosen: ownerId });
  if (choice.of !== ownerId) setChoice({ of: ownerId, chosen: ownerId });
  const { chosen } = choice;
  const choose = (picked: string) => {
    setChoice({ of: ownerId, chosen: picked });
  };
  const pickerId = pickerIdOf(owned.collection);
  const people = withTheOwner(naming.choices, owned.owner);

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        naming.save(owned, people.find((person) => person.id === chosen) ?? null);
      }}
    >
      <Label htmlFor={pickerId}>
        {WORDS.newOwner}
        <span className="sr-only">{WORDS.ofCollection(owned.collection)}</span>
      </Label>
      <NativeSelect
        id={pickerId}
        size="sm"
        value={chosen}
        onChange={(event) => {
          choose(event.target.value);
        }}
      >
        <NativeSelectOption value={NO_OWNER}>{WORDS.noOwner}</NativeSelectOption>
        {people.map((person) => (
          <NativeSelectOption key={person.id} value={person.id}>
            {nameOf(person)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button type="submit" variant="accent" size="sm">
        {WORDS.save}
        <span className="sr-only">{WORDS.saveOf(owned.collection)}</span>
      </Button>
    </form>
  );
}

function CollectionRow(properties: {
  readonly owned: CollectionOwned;
  readonly naming: Naming | undefined;
}) {
  const { owned, naming } = properties;
  const headingId = useId();

  return (
    <li
      aria-labelledby={headingId}
      {...keyedRow(owned.collection)}
      className="border-t border-border px-4 py-4 first:border-t-0"
    >
      <h3 id={headingId} tabIndex={-1} className="font-medium text-foreground">
        {owned.collection}
      </h3>
      <dl className="mt-2 grid items-baseline gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <Row term={WORDS.owner}>{ownerWords(owned.owner)}</Row>
        <Row term={WORDS.ownOwners}>{ownOwnersWords(owned.overrides)}</Row>
      </dl>
      {naming === undefined ? null : <OwnerPicker owned={owned} naming={naming} />}
    </li>
  );
}

function ChangeOwnerKey(properties: { readonly listed: readonly CollectionOwned[] }) {
  const { listed } = properties;
  useKeystroke(KEY.changeOwner, () => {
    const owned = rowInFocus(listed, (each) => each.collection) ?? listed[0];
    if (owned !== undefined) document.getElementById(pickerIdOf(owned.collection))?.focus();
  });
  return null;
}

function CollectionList(properties: {
  readonly listed: readonly CollectionOwned[];
  readonly naming: Naming | undefined;
}) {
  const { listed, naming } = properties;
  if (listed.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: null }} />;
  }

  return (
    <>
      {naming === undefined ? null : <ChangeOwnerKey listed={listed} />}
      <ul>
        {listed.map((owned) => (
          <CollectionRow key={owned.collection} owned={owned} naming={naming} />
        ))}
      </ul>
    </>
  );
}

function CollectionsRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useCollections();
  const admin = useRole() === "Admin";
  const [outcome, say] = useState<Outcome>();
  const naming = useNaming(useOwnerChoices(admin), say);
  useArrivalDecidedAgainOnceUnowned(ownsNoLonger(read.error));
  usePageKeystrokes(admin ? NAMING : NO_KEYSTROKES);
  const listed = read.data?.collections;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={COLLECTIONS_AND_OWNERS.name}
        headingId={headingId}
        headingRef={heading}
        description={WORDS.about}
        count={listed === undefined ? "" : WORDS.count(listed.length)}
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      <Card marks className="mt-4">
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={(failure) => outcomeOfFailure(failure, "read").words}
          focusAfterRetry={heading}
        >
          <CollectionList listed={listed ?? NONE} naming={admin ? naming : undefined} />
        </ListRead>
      </Card>
    </section>
  );
}

export function CollectionsAndOwnersPage() {
  return (
    <>
      <PageHead heading={CURATION.name} summary={CURATION.summary} />
      <CollectionsRegion />
    </>
  );
}
