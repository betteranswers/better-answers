import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import { cn } from "@/shared/lib/utils.ts";
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
import { Label } from "@/shared/ui/label.tsx";

import { EDITOR_WORDS as WORDS } from "./editor-words.ts";

const NONE: readonly string[] = [];

const sameType = (one: string, other: string): boolean => one.toLowerCase() === other.toLowerCase();

function ConceptTypeOptions(properties: {
  readonly conceptTypes: readonly string[] | undefined;
  readonly typed: string;
  readonly value: string;
  readonly onAdd: (conceptType: string) => void;
}) {
  const { typed, value } = properties;
  const read = properties.conceptTypes;
  const conceptTypes = read ?? NONE;
  const named = typed.trim();
  const needle = named.toLowerCase();
  const offersNew = named !== "" && !conceptTypes.some((each) => sameType(each, named));

  return (
    <ComboboxList label={WORDS.conceptTypes}>
      {read?.length === 0 ? <ComboboxEmpty>{WORDS.noConceptTypes}</ComboboxEmpty> : null}
      <ComboboxGroup>
        {conceptTypes
          .filter((each) => each.toLowerCase().includes(needle))
          .map((each) => (
            <ComboboxItem key={each} value={each} aria-checked={sameType(each, value)}>
              <span className="min-w-0 flex-1 truncate">{each}</span>
              {sameType(each, value) ? <CheckIcon aria-hidden /> : null}
            </ComboboxItem>
          ))}
        {offersNew ? (
          <ComboboxItem
            value={named}
            onSelect={() => {
              properties.onAdd(named);
            }}
          >
            <PlusIcon aria-hidden />
            {WORDS.addConceptType(named)}
          </ComboboxItem>
        ) : null}
      </ComboboxGroup>
    </ComboboxList>
  );
}

export function ConceptTypeField(properties: {
  readonly value: string;
  readonly conceptTypes: readonly string[] | undefined;
  readonly locked: boolean;
  readonly onChoose: (conceptType: string) => void;
}) {
  const { value, locked, onChoose } = properties;
  const conceptTypes = properties.conceptTypes ?? NONE;
  const id = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setTyped("");
  };

  return (
    <div className="mt-4 grid gap-1.5">
      <Label htmlFor={id}>{WORDS.conceptType}</Label>
      <Combobox
        type="type"
        data={conceptTypes.map((each) => ({ label: each, value: each }))}
        value={value}
        onValueChange={onChoose}
        open={open}
        onOpenChange={changeOpen}
      >
        <ComboboxTrigger
          id={id}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a select-only combobox is a button that opens a list
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={locked}
          className="h-9 w-full justify-between border-input px-3 font-normal"
        >
          <span className={cn("truncate", value === "" && "text-muted-foreground")}>
            {value === "" ? WORDS.chooseConceptType : value}
          </span>
          <Icon name="unsorted" className="text-muted-foreground" />
        </ComboboxTrigger>
        <ComboboxContent
          shouldFilter={false}
          label={WORDS.searchConceptTypes}
          defaultValue={conceptTypes.find((each) => sameType(each, value)) ?? ""}
          className="[&_[data-slot=command-input-wrapper]:focus-within]:border-ring"
          popoverOptions={{ align: "start", id: listId }}
        >
          <ComboboxInput
            value={typed}
            onValueChange={setTyped}
            placeholder={WORDS.searchConceptTypes}
            className="!shadow-none"
          />
          <ConceptTypeOptions
            conceptTypes={properties.conceptTypes}
            typed={typed}
            value={value}
            onAdd={(conceptType) => {
              onChoose(conceptType);
              changeOpen(false);
            }}
          />
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
