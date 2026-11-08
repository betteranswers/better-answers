import { useState } from "react";

import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";

import type { SourceEntry } from "../knowledge-api.ts";
import { sourceNumberOf } from "./concept-editing.ts";
import { EDITOR_WORDS as WORDS } from "./editor-words.ts";

type SourceRow = { readonly id: number; readonly entry: SourceEntry };

type SourceRows = { readonly rows: readonly SourceRow[]; readonly next: number };

const NAMING_KEYS = ["title", "resource"] as const;

const labelOf = (entry: Exclude<SourceEntry, string>, number: number): string => {
  const named = NAMING_KEYS.map((key) => entry[key]).find(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  return typeof named === "string" ? named : WORDS.source(number);
};

export function SourcesField(properties: {
  readonly sources: readonly SourceEntry[];
  readonly withheld: readonly { readonly at: number }[];
  readonly locked: boolean;
  readonly onChange: (sources: readonly SourceEntry[]) => void;
}) {
  const { locked } = properties;
  const [held, setHeld] = useState<SourceRows>(() => ({
    rows: properties.sources.map((entry, at) => ({ id: at, entry })),
    next: properties.sources.length,
  }));
  const change = (next: SourceRows) => {
    if (locked) return;
    setHeld(next);
    properties.onChange(next.rows.map((row) => row.entry));
  };
  const replaced = (id: number, entry: SourceEntry) =>
    held.rows.map((row) => (row.id === id ? { id, entry } : row));

  return (
    <fieldset className="mt-4 min-w-0">
      <legend className="text-sm font-medium">{WORDS.sources}</legend>
      <ol className="mt-2 grid gap-2">
        {held.rows.map((row, at) => {
          const number = sourceNumberOf(properties.withheld, at);
          return (
            <li key={row.id} value={number} className="flex flex-wrap items-center gap-2">
              <span className="font-mono [font-size:var(--text-sm)] text-muted-foreground">
                [{number}]
              </span>
              {typeof row.entry === "string" ? (
                <Input
                  aria-label={WORDS.source(number)}
                  value={row.entry}
                  readOnly={locked}
                  className="min-w-0 flex-1"
                  onChange={(event) => {
                    change({ ...held, rows: replaced(row.id, event.target.value) });
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 wrap-anywhere">{labelOf(row.entry, number)}</span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={locked}
                onClick={() => {
                  change({ ...held, rows: held.rows.filter((each) => each.id !== row.id) });
                }}
              >
                <span aria-hidden>{WORDS.remove}</span>
                <span className="sr-only">{WORDS.removeSource(number)}</span>
              </Button>
            </li>
          );
        })}
      </ol>
      {properties.withheld.length === 0 ? null : (
        <p className="mt-2 text-muted-foreground">{WORDS.withheld(properties.withheld.length)}</p>
      )}
      {held.rows.some((row) => typeof row.entry !== "string") ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2"
          aria-disabled={locked}
          onClick={() => {
            change({ rows: [...held.rows, { id: held.next, entry: "" }], next: held.next + 1 });
          }}
        >
          {WORDS.addSource}
        </Button>
      )}
    </fieldset>
  );
}
