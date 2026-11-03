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

export const MEMBERS = "/people/members";

export const siteLeads = (memberCount: number) => ({
  id: "01JSITE0000000000000000001",
  name: "Site leads",
  origin: "admin-curated",
  memberCount,
});

export const PRIYA = joined("01JPRYA", "Priya Shah", "Editor");

export const SAM = joined("01JSAM", "Sam Okoro", "Viewer");

export const listed = () => within(screen.getByRole("region", { name: "Members" }));

export const namesShown = (): (string | null)[] =>
  listed()
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 0)
    .map((row) => within(row).getAllByRole("link").at(0)?.textContent ?? null);

export const rowOf = (name: string): HTMLElement => {
  const row = listed().getByRole("link", { name }).closest("tr");
  if (row === null) throw new Error(`${name} has no row`);
  return row;
};

export const outcome = (): HTMLElement | undefined => listed().getAllByRole("status").at(1);

export const asked = (procedure: string): unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);
