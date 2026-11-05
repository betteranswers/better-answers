import assert from "node:assert/strict";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAdminAtSources,
  connectedSourceNamed,
  connectedSourcesRegion,
  indexed,
  lastSyncedOf,
  rowAction,
  saidIn,
  sensitivityOf,
  stateOf,
} from "../connected-sources.ts";
import {
  clockTheNextKey,
  alertHasText,
  type SeedConnectedSource,
  actionWithinBudget,
} from "../harness.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const SENSITIVITY_PANELS = {
  narrow: { named: (name: string) => `Narrow the Sensitivity of ${name}`, commit: "Narrow" },
  widen: {
    named: (name: string) => `Widen the Sensitivity or Audience of ${name}`,
    commit: "Widen",
  },
} as const;

type SensitivityChange = keyof typeof SENSITIVITY_PANELS;

const panelOf = (page: Page, name: string, change: SensitivityChange): Locator =>
  connectedSourceNamed(page, name).getByRole("group", {
    name: SENSITIVITY_PANELS[change].named(name),
  });

const commitOf = (page: Page, name: string, change: SensitivityChange): Locator =>
  panelOf(page, name, change).getByRole("button", {
    name: SENSITIVITY_PANELS[change].commit,
    exact: true,
  });

test.describe("connecting a document on the Sources page", () => {
  test("shows an upload refusal in the Connect a Document dialog", async ({ page, request }) => {
    await anAdminAtSources(page, request, { workspace: "Ryburn Stores" });
    await page.route(
      (url) => url.pathname.endsWith("sources.connect"),
      (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            "x-upload-media-type": encodeURIComponent(JSON.stringify("image/png")),
          },
        }),
    );

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Connect a Document" });
    await dialog.getByLabel("Name").fill("Shop notes");
    await dialog.getByLabel("File").setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("The shop opens at eight.\n"),
    });
    const refused = refusalAnswering(page, "sources.connect");
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();

    expect(await refused).toMatchObject({ word: "media-type-refused", class: "inapplicable" });
    await alertHasText(dialog.getByRole("alert"));
    await expect(dialog).toBeVisible();
  });
});

const SUPPLIER_FORMS: SeedConnectedSource = indexed("Supplier forms", {
  documents: [
    {
      title: "Supplier form",
      findings: [
        { category: "bank-details", ruleId: "UK_BANK_ACCOUNT", tier: "always", spans: 2 },
        { category: "home-address", ruleId: "UK_HOME_ADDRESS", tier: "default-on", spans: 1 },
      ],
    },
    {
      title: "Staff survey",
      sensitivity: "Restricted",
      findings: [{ category: "special-category", ruleId: "HEALTH_CUE", tier: "always", spans: 1 }],
    },
  ],
});

const HEALTH_CUE_RULE = "Health wording";

const healthCueCheckboxIn = (title: string): string =>
  `Select special category findings in ${title} found by the ${HEALTH_CUE_RULE} rule`;

const HEALTH_CUE_CHECKBOX = healthCueCheckboxIn("Staff survey");

const reviewOf = (page: Page, name: string) =>
  connectedSourceNamed(page, name).getByRole("region", { name: `Review of ${name}` });

const TENDER_ANSWERS = indexed("Tender answers", {
  sensitivity: "Restricted",
  published: true,
  documents: [{ title: "Method statement", cited: true }],
});

const TEN: readonly SeedConnectedSource[] = [
  indexed("Bid library"),
  indexed("Case studies", { published: true }),
  indexed("Contracts", { sync: "queued" }),
  indexed("Framework returns", { sync: "claimed" }),
  indexed("HR policies", { sensitivity: "Restricted" }),
  indexed("Method statements", { published: true, sensitivity: "Public" }),
  indexed("Safety records", { sync: "none" }),
  indexed("Staff handbook"),
  SUPPLIER_FORMS,
  TENDER_ANSWERS,
];

test.describe("publishing, narrowing and widening a connected source", () => {
  test("an Admin widens sensitivity by keyboard and sees what changes", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { seeded } = await anAdminAtSources(page, request, {
      workspace: "Hebden Bridge Joinery",
      connectedSources: TEN,
    });
    const citedBy = seeded.connectedSources.find(
      (connectedSource) => connectedSource.name === TENDER_ANSWERS.name,
    )?.documents[0]?.citedBy;
    assert.ok(citedBy, "the harness did not seed a citing concept");

    await test.step("shows an Admin all ten sources within the list time budget, each with its details closed", async () => {
      const started = Date.now();
      await page.goto("/sources/connected-sources");
      await expect(connectedSourcesRegion(page).getByRole("heading", { level: 3 })).toHaveCount(
        TEN.length,
      );
      const elapsed = Date.now() - started;
      test
        .info()
        .annotations.push({ type: "connected sources list", description: `${elapsed} ms` });
      expect(
        elapsed,
        "the list of ten connected sources took longer than its time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);

      await expect(connectedSourcesRegion(page).getByRole("heading", { level: 3 })).toHaveText(
        TEN.map((connectedSource) => connectedSource.name),
      );
      await expect(stateOf(page, "Case studies")).toHaveText("Published");
      await expect(stateOf(page, "Contracts")).toHaveText("Received");
      await expect(stateOf(page, "Framework returns")).toHaveText("Indexing");
      await expect(stateOf(page, "Staff handbook")).toHaveText("Indexed");
      await expect(
        lastSyncedOf(page, "Safety records"),
        "a connected source that has never synced shows a sync time",
      ).toHaveText(/^\D+$/);
      await expect(
        connectedSourcesRegion(page).getByRole("button", {
          name: /^More Details /,
          expanded: false,
        }),
      ).toHaveCount(TEN.length);
      await expect(page.locator("main")).not.toContainText(AN_ID);
    });

    const panel = panelOf(page, TENDER_ANSWERS.name, "widen");
    const sensitivityPicked = panel.getByRole("combobox", { name: "Sensitivity" });
    const commit = commitOf(page, TENDER_ANSWERS.name, "widen");

    await test.step("opens the Widen panel with the W key, lists what changes, and passes the accessibility checks", async () => {
      await rowAction(page, "Tender answers", "widen").focus();
      await page.keyboard.press("w");
      await expect(panel).toHaveAccessibleDescription(/\S/);
      await expect(sensitivityPicked).toBeFocused();
      await expect(sensitivityPicked).toHaveText("Internal");
      await expect(panel.getByRole("term")).toHaveText(["Sensitivity"]);
      await expect(panel.getByRole("definition")).toHaveText([/Restricted.+Internal/]);
      await expect(page.getByRole("dialog"), "the Widen panel opened as a dialog").toHaveCount(0);
      await expect(
        connectedSourceNamed(page, "Tender answers").getByRole("region"),
        "the Widen panel has a What the Audit Log Will Record section",
      ).toHaveCount(0);
      await passesTheAccessibilityGate();
    });

    await test.step("an Admin widens the sensitivity to Internal by keyboard within 100 ms and sees what changed", async () => {
      await page.keyboard.press("Enter");
      await page.getByRole("option", { name: "Restricted" }).press("Enter");
      await expect(sensitivityPicked).toHaveText("Restricted");
      await expect(
        sensitivityPicked,
        "focus did not return to the Sensitivity list after a choice",
      ).toBeFocused();
      await expect(commit).toBeDisabled();
      await expect(commit).toHaveAccessibleDescription(/\S/);
      await expect(panel.getByRole("term")).toHaveCount(0);

      await sensitivityPicked.press("Enter");
      await page.getByRole("option", { name: "Internal" }).press("Enter");
      await expect(sensitivityPicked).toHaveText("Internal");
      await expect(
        sensitivityPicked,
        "focus did not return to the Sensitivity list after a choice",
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await expect(commit).toBeFocused();

      await clockTheNextKey(page, {
        at: "(//li[.//h3[.='Tender answers']]//dt[.='Sensitivity'])[1]/following-sibling::dd[1]",
        reads: "Internal",
      });
      await page.keyboard.press("Enter");
      await actionWithinBudget(page, "widen");

      await expect(saidIn(page)).toHaveText(/Tender answers\D+Internal\D+\b1\b\D+\b1\b/);
      await expect(page.getByText(citedBy.iri)).toBeVisible();
      await expect(sensitivityOf(page, "Tender answers")).toHaveText("Internal");
      await expect(panel).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 3, name: "Tender answers" })).toBeFocused();
      await passesTheAccessibilityGate();
    });

    await test.step("does not scroll sideways at 320 pixels with the review and the Widen panel open", async () => {
      await page.setViewportSize({ width: 320, height: 720 });
      await page.goto("/sources/connected-sources");
      await rowAction(page, "Supplier forms", "review").click();
      await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);
      await reviewOf(page, "Supplier forms")
        .getByRole("checkbox", { name: HEALTH_CUE_CHECKBOX })
        .click();
      await expect(
        reviewOf(page, "Supplier forms").getByRole("button", {
          name: "Dismiss as Not Special Category",
        }),
      ).toBeEnabled();
      await rowAction(page, "Supplier forms", "widen").click();
      await expect(commitOf(page, "Supplier forms", "widen")).toBeVisible();

      const room = await page.evaluate(() => ({
        scrolls: document.documentElement.scrollWidth,
        holds: document.documentElement.clientWidth,
      }));
      expect(room.scrolls, "the page scrolls sideways at 320 pixels").toBeLessThanOrEqual(
        room.holds,
      );
    });
  });
});
