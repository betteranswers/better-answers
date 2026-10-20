import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  provision,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
  switcherOf,
} from "./harness.ts";
import { askedAt } from "./refused-read.ts";

const MEMBER_READ = "session.member";

const A_FAILED_READ = {
  error: {
    message: "INTERNAL_SERVER_ERROR",
    code: -32_603,
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  },
};

/** The shell's read is dropped and the frame's batched one fails, so the page draws unread; the lone retry waits on `landed`. */
const memberUnreadUntil = async (page: Page, landed: Promise<void>): Promise<void> => {
  let shellRead = true;
  await page.route(
    (url) => askedAt(url.href).includes(MEMBER_READ),
    async (route) => {
      const asked = askedAt(route.request().url());
      if (shellRead) {
        shellRead = false;
        await route.abort();
        return;
      }
      if (asked.length === 1) {
        await landed;
        await route.continue();
        return;
      }
      const answered = await route.fetch();
      const answers: readonly unknown[] = await answered.json();
      await route.fulfill({
        response: answered,
        json: answers.map((answer, at) => (asked[at] === MEMBER_READ ? A_FAILED_READ : answer)),
      });
    },
  );
};

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

const sensitivityOf = (page: Page) =>
  sourceNamed(page)
    .getByRole("term")
    .filter({ hasText: /^Sensitivity$/ })
    .first()
    .locator("xpath=following-sibling::dd[1]");

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
  test("an act pressed before the member read still lands", async ({ page, request }) => {
    const landed = Promise.withResolvers<void>();
    await atSourcesUnread(page, request, "Hebble Brassworks", landed.promise);
    const panel = await narrowOpened(page);

    const narrowed = page.waitForResponse((answer) =>
      askedAt(answer.url()).includes("sources.narrow"),
    );
    await panel.getByRole("button", { name: "Narrow", exact: true }).click();
    landed.resolve();

    expect((await narrowed).ok(), "the act was refused before the member read").toBe(true);
    await expect(switcherOf(page, "Hebble Brassworks")).toBeVisible();
    await expect(page).toHaveURL(/\/sources/);
    await expect(sensitivityOf(page)).toHaveText("Restricted");
  });

  test("an open panel stays open as the member read lands", async ({ page, request }) => {
    const landed = Promise.withResolvers<void>();
    await atSourcesUnread(page, request, "Hebble Tinworks", landed.promise);
    const panel = await narrowOpened(page);

    landed.resolve();

    await expect(switcherOf(page, "Hebble Tinworks")).toBeVisible();
    await expect(panel, "the page was drawn again and lost its panel").toBeVisible();
  });
});
