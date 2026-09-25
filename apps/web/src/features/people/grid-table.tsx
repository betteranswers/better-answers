import {
  flexRender,
  type RowData,
  type Table as HeldTable,
  type TableFeatures,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";

/** `empty` fills the body when no row is left, so the header still names the columns. */
export function GridTable<Features extends TableFeatures, Data extends RowData>(properties: {
  readonly table: HeldTable<Features, Data>;
  readonly caption: string;
  readonly empty: ReactNode;
}) {
  const { table } = properties;
  const rows = table.getRowModel().rows;

  return (
    <Table>
      <TableCaption className="sr-only">{properties.caption}</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="border-border hover:bg-transparent">
            {group.headers.map((header) => (
              <TableHead key={header.id} scope="col">
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow className="border-border hover:bg-transparent">
            <TableCell colSpan={table.getAllLeafColumns().length} className="p-0 whitespace-normal">
              {properties.empty}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.id} className="border-border">
              {row.getAllCells().map((cell) => (
                // Wrapping, not scrolling, is what keeps a 320px screen from hiding a column.
                <TableCell key={cell.id} className="whitespace-normal">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
