import type { Locator, Page, Response } from "@playwright/test";

import { AUDITED_CATEGORIES, CONNECT_WORDS, PUBLISH_WORDS } from "@/features/sources/words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";

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
  moveTheSync,
  listStatusHasText,
  seedConnectedSources,
  skipLinkReachesThePage,
  actionWithinBudget,
} from "../harness.ts";
import { holdRequests } from "../knowledge.ts";

const EVERYONE = "Everyone in the workspace";

const FOUND_IN_THE_HANDBOOK = {
  "special-category": 0,
  "bank-details": 2,
  "government-identifier": 0,
  "date-of-birth": 0,
  "home-address": 1,
  "personal-contact": 0,
  "person-name": 0,
  "job-title": 0,
} satisfies Record<(typeof AUDITED_CATEGORIES)[number]["category"], number>;

const textOf = async (region: Locator): Promise<string> => (await region.textContent()) ?? "";

const A_SYNC_UNDER_WAY = /^\D+\d{2}:\d{2}/;

const isTheList = (url: URL): boolean => url.pathname.includes("sources.list");

const answeredTheList = async (answer: Response): Promise<boolean> => {
  const calls = new URL(answer.url()).pathname.split("/").at(-1)?.split(",") ?? [];
  const body: unknown = await answer.json();
  const own: unknown = Array.isArray(body) ? body[calls.indexOf("sources.list")] : body;
  return typeof own === "object" && own !== null && "result" in own;
};

const listsNothingConnected = async (page: Page, open: () => Promise<unknown>): Promise<void> => {
  const list = await holdRequests(page, isTheList);
  await open();
  await list.reached;
  const region = connectedSourcesRegion(page);
  await listStatusHasText(region);
  const whileLoading = await textOf(region.locator('[aria-live="polite"]'));
  const answered = page.waitForResponse((answer) => isTheList(new URL(answer.url())));
  list.release();
  expect(
    await answeredTheList(await answered),
    "the request for the Connected Sources list got no answer",
  ).toBe(true);
  await expect(
    region.locator('[aria-live="polite"]'),
    "the list still says it is loading",
  ).not.toHaveText(whileLoading);
  await listStatusHasText(region);
  await expect(region.getByRole("listitem")).toHaveCount(0);
};

test("an Admin connects a document by keyboard, then publishes it", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace } = await anAdminAtSources(page, request, { workspace: "Airedale Tooling" });

  await test.step("an Admin connects a document by keyboard and sees its state go from Received to Indexing to Indexed", async () => {
    await listsNothingConnected(page, () => page.goto("/sources/connected-sources"));
    await expect(connectedSourcesRegion(page)).toMatchAriaSnapshot(`
      - region ${JSON.stringify(pageById(menuGroupIn(CONTROL_CENTRE, "sources"), "connected-sources").name)}:
        - /children: equal
        - heading ${JSON.stringify(pageById(menuGroupIn(CONTROL_CENTRE, "sources"), "connected-sources").name)} [level=2]
        - status
        - status
        - button ${JSON.stringify(CONNECT_WORDS.action)}
        - status
        - paragraph
    `);
    await expect(
      page.getByRole("button", { name: /^connect/i }),
      "the page does not show exactly one Connect button",
    ).toHaveCount(1);
    await passesTheAccessibilityGate();
    await skipLinkReachesThePage(page);

    // Start waiting before the key press. Chromium's file chooser interception can start late,
    // and Chromium cancels a chooser it misses.
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: CONNECT_WORDS.action });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/\S/);
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("The staff handbook");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Sensitivity" })).toHaveText("Restricted");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("File")).toBeFocused();

    await page.keyboard.press("Space");
    await (
      await choosing
    ).setFiles({
      name: "handbook.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("The handbook says what the company decided.\n".repeat(6000)),
    });

    const devtools = await page.context().newCDPSession(page);
    await devtools.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: 96 * 1024,
    });

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Connect", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(dialog.getByRole("progressbar", { name: "Uploading handbook.md" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await devtools.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    await expect(
      connectedSourcesRegion(page).getByRole("status").filter({ hasText: "The staff handbook" }),
    ).toContainText("handbook.md");
    await expect(stateOf(page, "The staff handbook")).toHaveText("Received");
    const lastSynced = lastSyncedOf(page, "The staff handbook");
    await expect(lastSynced).toHaveText(A_SYNC_UNDER_WAY);
    const whileQueued = await textOf(lastSynced);
    await expect(sensitivityOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("Indexing");
    await expect(
      lastSynced,
      "the last-synced text did not change when the queued sync started",
    ).not.toHaveText(whileQueued);
    await expect(lastSynced).toHaveText(A_SYNC_UNDER_WAY);

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("Indexed");
    await expect(lastSyncedOf(page, "The staff handbook")).toHaveText(/^\d{2}:\d{2} · /);
  });

  await test.step("an Admin ticks the three confirmations, sees what the audit log will record, and publishes within 100 ms", async () => {
    await seedConnectedSources(request, {
      workspaceId: workspace.workspaceId,
      connectedSources: [
        indexed("Staff handbook", {
          documents: [
            {
              title: "handbook.md",
              findings: [
                { category: "bank-details", ruleId: "UK_BANK_ACCOUNT", tier: "always", spans: 2 },
                {
                  category: "home-address",
                  ruleId: "UK_HOME_ADDRESS",
                  tier: "default-on",
                  spans: 1,
                },
              ],
            },
          ],
        }),
      ],
    });
    await page.goto("/sources/connected-sources");
    await expect(connectedSourceNamed(page, "Staff handbook")).toBeVisible();

    await rowAction(page, "Staff handbook", "review").focus();
    await page.keyboard.press("p");
    const dialog = page.getByRole("dialog", { name: "Publish Staff handbook" });
    const commit = dialog.getByRole("button", { name: "Publish", exact: true });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAccessibleDescription(/\S/);

    const auditRecord = dialog.getByRole("region", { name: PUBLISH_WORDS.audit });
    await expect(auditRecord).toMatchAriaSnapshot(`
      - region ${JSON.stringify(PUBLISH_WORDS.audit)}:
        - heading ${JSON.stringify(PUBLISH_WORDS.audit)} [level=3]
        - term: Action
        - definition
        - term: ${PUBLISH_WORDS.connectedSource}
        - definition: Staff handbook
        - term: By
        - definition
        - term: Sensitivity
        - definition: Internal
        - term: Audience
        - definition: ${EVERYONE}
${Object.values(PUBLISH_WORDS.confirmations)
  .map((term) => `        - term: ${term}\n        - definition`)
  .join("\n")}
${AUDITED_CATEGORIES.map(
  ({ category, term }) =>
    `        - term: ${term}\n        - definition: "${FOUND_IN_THE_HANDBOOK[category]}"`,
).join("\n")}
        - term: ${PUBLISH_WORDS.dpiaInput}
        - definition
    `);

    const unconfirmed = auditRecord.getByRole("definition").filter({
      hasText: await textOf(
        auditRecord
          .getByRole("term")
          .filter({ hasText: PUBLISH_WORDS.confirmations.lawfulBasisRecorded })
          .locator("xpath=following-sibling::dd[1]"),
      ),
    });
    await expect(unconfirmed).toHaveCount(3);
    await expect(
      dialog.getByRole("checkbox", { name: PUBLISH_WORDS.confirmations.lawfulBasisRecorded }),
    ).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("checkbox", { name: PUBLISH_WORDS.confirmations.privacyInformationUpdated }),
    ).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("checkbox", { name: PUBLISH_WORDS.confirmations.dpiaReferenced }),
    ).toBeFocused();
    await page.keyboard.press("Space");
    await expect(
      unconfirmed,
      "the audit record still shows a ticked confirmation as not confirmed",
    ).toHaveCount(0);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(commit).toBeFocused();

    await clockTheNextKey(page, {
      at: "//li[.//h3[.='Staff handbook']]//dt[.='State']/following-sibling::dd[1]",
      reads: "Published",
    });
    await page.keyboard.press("Enter");
    await actionWithinBudget(page, "publish");

    await expect(saidIn(page)).toContainText("Staff handbook");
    await expect(stateOf(page, "Staff handbook")).toHaveText("Published");
    await expect(rowAction(page, "Staff handbook", "publish")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 3, name: "Staff handbook", exact: true }),
    ).toBeFocused();
  });
});
