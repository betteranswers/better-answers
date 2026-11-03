import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  memberUnreadUntil,
  provision,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
  switcherOf,
} from "../harness.ts";

const PUBLISHED: SeedConnectedSource = {
  name: "Supplier payments",
  sensitivity: "Internal",
  sync: "done",
  published: true,
  documents: [{ title: "Payment terms" }],
};

const sourceNamed = (page: Page) =>
  page
    .getByRole("region", { name: "Connected Sources" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: PUBLISHED.name, exact: true }) });

const narrowPanelOf = (page: Page) =>
  sourceNamed(page).getByRole("group", { name: `Narrow the Sensitivity of ${PUBLISHED.name}` });

const atSourcesUnread = async (
  page: Page,
  api: APIRequestContext,
  workspace: string,
  landed: Promise<void>,
): Promise<void> => {
  const email = anAddress("admin");
  const provisioned = await provision(api, { name: workspace, adminEmail: email });
  await seedConnectedSources(api, {
    workspaceId: provisioned.workspaceId,
    connectedSources: [PUBLISHED],
  });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page
    .getByRole("navigation", { name: "Control Centre" })
    .getByRole("link", { name: "Connected Sources" })
    .click();
  await expect(switcherOf(page, workspace)).toBeVisible();

  await memberUnreadUntil(page, landed);
  await page.reload();
  await expect(sourceNamed(page)).toBeVisible();
  await expect(
    switcherOf(page, workspace),
    "the member read landed before it was let through",
  ).toHaveCount(0);
};

const narrowOpened = async (page: Page) => {
  await sourceNamed(page)
    .getByRole("button", { name: `Narrow Sensitivity ${PUBLISHED.name}`, exact: true })
    .click();
  const panel = narrowPanelOf(page);
  await expect(panel.getByRole("combobox", { name: "Sensitivity" })).toBeFocused();
  return panel;
};

test.describe("a page drawn before the reader's member read lands", () => {
  test("an open panel stays open as the member read lands", async ({ page, request }) => {
    const landed = Promise.withResolvers<void>();
    await atSourcesUnread(page, request, "Hebble Tinworks", landed.promise);
    const panel = await narrowOpened(page);

    landed.resolve();

    await expect(switcherOf(page, "Hebble Tinworks")).toBeVisible();
    await expect(panel, "the page was drawn again and lost its panel").toBeVisible();
  });
});
