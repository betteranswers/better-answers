import { useRef, type RefObject } from "react";

import { Icon } from "@/shared/icon.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { Button } from "@/shared/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { CountedSwitch, type CountedChoice } from "@/shared/ui/kibo-ui/counted-switch.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

type Choice = { readonly value: string; readonly label: string };

type Search = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly keystroke?: Keystroke;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
};

/** `undefined` is no narrowing at all, which the select says in `anyLabel`. */
type Filter = {
  readonly label: string;
  readonly value: string | undefined;
  readonly anyLabel: string;
  readonly choices: readonly Choice[];
  readonly onChange: (value: string | undefined) => void;
};

type StatusSwitch = {
  readonly label: string;
  readonly value: string;
  readonly choices: readonly CountedChoice[];
  readonly onChange: (value: string) => void;
};

type ColumnControl = {
  readonly columns: readonly { readonly id: string; readonly label: string }[];
  readonly hidden: ReadonlySet<string>;
  readonly onHiddenChange: (hidden: ReadonlySet<string>) => void;
};

/** The registry's select refuses an empty value, so no narrowing needs a word, and each choice a mark that word lacks. */
const ANY = "any";

const CHOICE = "=";

const carried = (value: string): string => `${CHOICE}${value}`;

function FocusOn(properties: {
  readonly keystroke: Keystroke;
  readonly target: RefObject<HTMLInputElement | null>;
}) {
  useKeystroke(properties.keystroke, () => {
    properties.target.current?.focus();
  });
  return null;
}

function SearchField(properties: { readonly search: Search }) {
  const { label, value, onChange, keystroke } = properties.search;
  const own = useRef<HTMLInputElement>(null);
  const ref = properties.search.inputRef ?? own;
  return (
    <div className="relative w-full max-w-64">
      <Icon
        name="search"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={label}
        aria-keyshortcuts={keystroke?.key}
        placeholder={label}
        className="pl-8"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || value === "") return;
          event.preventDefault();
          onChange("");
        }}
      />
      {keystroke === undefined ? null : <FocusOn keystroke={keystroke} target={ref} />}
    </div>
  );
}

function FilterSelect(properties: { readonly filter: Filter }) {
  const { label, value, anyLabel, choices, onChange } = properties.filter;
  return (
    <Select
      value={value === undefined ? ANY : carried(value)}
      onValueChange={(picked) => {
        onChange(picked === ANY ? undefined : picked.slice(CHOICE.length));
      }}
    >
      <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`} className="min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={carried(choice.value)}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const toggled = (hidden: ReadonlySet<string>, id: string, shown: boolean): ReadonlySet<string> => {
  const next = new Set(hidden);
  if (shown) next.delete(id);
  else next.add(id);
  return next;
};

/** Only the columns a screen lists can hide, so the person never leaves the table. */
function ColumnMenu(properties: { readonly control: ColumnControl }) {
  const { columns, hidden, onHiddenChange } = properties.control;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Icon name="columns" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={!hidden.has(column.id)}
            onCheckedChange={(checked) => {
              onHiddenChange(toggled(hidden, column.id, checked));
            }}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Wraps onto further lines at a narrow width rather than scrolling sideways. */
export function FilterRow(properties: {
  readonly search: Search;
  readonly filters?: readonly Filter[];
  readonly status?: StatusSwitch;
  readonly columns?: ColumnControl;
}) {
  const { status, columns } = properties;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
      <SearchField search={properties.search} />
      {(properties.filters ?? []).map((filter) => (
        <FilterSelect key={filter.label} filter={filter} />
      ))}
      {status === undefined ? null : (
        <CountedSwitch
          label={status.label}
          value={status.value}
          choices={status.choices}
          onValueChange={status.onChange}
        />
      )}
      {columns === undefined ? null : (
        <div className="ml-auto">
          <ColumnMenu control={columns} />
        </div>
      )}
    </div>
  );
}
