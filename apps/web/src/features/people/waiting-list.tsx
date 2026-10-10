import type { ReactNode } from "react";

import { EmptyState } from "@/shared/empty-state.tsx";
import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { Card } from "@/shared/ui/card.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";
import { dayWords } from "@/shared/words.ts";

/** What waits on an Admin, a row each with its actions: invitations not yet accepted, requests. */
export function WaitingTable(properties: {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <Card className="mt-4">
      <Table>
        <TableCaption className="sr-only">{properties.caption}</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {properties.columns.map((name) => (
              <TableHead key={name} scope="col">
                {name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{properties.children}</TableBody>
      </Table>
    </Card>
  );
}

/** No second invite: the toolbar holds the one. The card matches the table's, so the tab keeps its shape. */
export function NothingWaiting(properties: { readonly line: string }) {
  return (
    <Card className="mt-4 px-4 py-10">
      <EmptyState line={properties.line} />
    </Card>
  );
}

/** Focus moving between the row's own buttons keeps it held; only leaving the row lets go. */
export function WaitingRow<Item>(properties: {
  readonly item: Item;
  readonly onHeld: (item: Item | undefined) => void;
  readonly children: ReactNode;
}) {
  const { item, onHeld } = properties;
  return (
    <TableRow
      onFocus={() => {
        onHeld(item);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onHeld(undefined);
      }}
    >
      {properties.children}
    </TableRow>
  );
}

export function DayCell(properties: { readonly instant: string }) {
  return <TableCell className="tabular-nums">{dayWords(properties.instant)}</TableCell>;
}

/** With no row held, `nothingHeld` says where focus goes first rather than acting on none. */
export function useKeystrokeOnHeld<Item>(
  keystroke: Keystroke,
  held: Item | undefined,
  action: (item: Item) => void,
  nothingHeld: () => void,
) {
  useKeystroke(keystroke, () => {
    if (held === undefined) nothingHeld();
    else action(held);
  });
}
