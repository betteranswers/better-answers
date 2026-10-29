import { screen, within } from "@testing-library/react";

import { server } from "@test/stub-server.ts";
import { ADA } from "@test/two-workspaces.ts";

const idOf = (stem: string): string => `${stem}${"0".repeat(25 - stem.length)}A`;

export const joined = (
  stem: string,
  displayName: string,
  role: string,
  groups: readonly object[] = [],
) => ({
  ...ADA,
  personId: idOf(stem),
  displayName,
  address: `${stem.toLowerCase()}@example.test`,
  role,
  groups,
});

export const PRIYA = joined("01JPRYA", "Priya Shah", "Editor");

export const SAM = joined("01JSAM", "Sam Okoro", "Viewer");

export const listed = () => within(screen.getByRole("region", { name: "Members" }));

export const rowOf = (name: string): HTMLElement => {
  const row = listed().getByRole("link", { name }).closest("tr");
  if (row === null) throw new Error(`${name} has no row`);
  return row;
};

export const outcome = (): HTMLElement | undefined => listed().getAllByRole("status").at(1);

export const asked = (procedure: string): unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);
