import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  anAddress,
  provision,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
} from "./harness.ts";

const controlCentreNav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

export const connectedSourcesRegion = (page: Page) =>
  page.getByRole("region", { name: "Connected Sources" });

export const saidIn = (page: Page): Locator =>
  connectedSourcesRegion(page).getByRole("status").last();

export const connectedSourceNamed = (page: Page, name: string): Locator =>
  connectedSourcesRegion(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });

const firstDefinitionOf = (page: Page, name: string, term: string): Locator =>
  connectedSourceNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]");

export const stateOf = (page: Page, name: string) => firstDefinitionOf(page, name, "State");

export const lastSyncedOf = (page: Page, name: string) =>
  firstDefinitionOf(page, name, "Last Synced");

export const sensitivityOf = (page: Page, name: string) =>
  firstDefinitionOf(page, name, "Sensitivity");

const ROW_ACTIONS = {
  review: "Review Findings",
  publish: "Publish",
  narrow: "Narrow Sensitivity",
  widen: "Widen Sensitivity or Audience",
} as const;

export const rowAction = (page: Page, name: string, action: keyof typeof ROW_ACTIONS): Locator =>
  connectedSourceNamed(page, name).getByRole("button", {
    name: `${ROW_ACTIONS[action]} ${name}`,
    exact: true,
  });

export const anAdminAtSources = async (
  page: Page,
  api: APIRequestContext,
  input: { readonly workspace: string; readonly connectedSources?: readonly SeedConnectedSource[] },
) => {
  const email = anAddress("admin");
  const workspace = await provision(api, { name: input.workspace, adminEmail: email });
  const seeded =
    input.connectedSources === undefined
      ? { connectedSources: [] }
      : await seedConnectedSources(api, {
          workspaceId: workspace.workspaceId,
          connectedSources: input.connectedSources,
        });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await controlCentreNav(page).getByRole("link", { name: "Connected Sources" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  return { workspace, seeded };
};

export const indexed = (
  name: string,
  overrides: Partial<SeedConnectedSource> = {},
): SeedConnectedSource => ({
  name,
  sensitivity: "Internal",
  sync: "done",
  documents: [{ title: `${name}.md` }],
  ...overrides,
});
