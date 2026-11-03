import type { Locator, Page, Response } from "@playwright/test";

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
  saysOfItsRead,
  seedConnectedSources,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { heldBack } from "../knowledge.ts";

const EVERYONE = "Everyone in the workspace";

const saidNowIn = async (region: Locator): Promise<string> => (await region.textContent()) ?? "";

const A_SYNC_UNDER_WAY = /^\D+\d{2}:\d{2}/;

const isTheList = (url: URL): boolean => url.pathname.includes("sources.list");

const answeredTheList = async (answer: Response): Promise<boolean> => {
  const calls = new URL(answer.url()).pathname.split("/").at(-1)?.split(",") ?? [];
  const body: unknown = await answer.json();
  const own: unknown = Array.isArray(body) ? body[calls.indexOf("sources.list")] : body;
  return typeof own === "object" && own !== null && "result" in own;
};

const listsNothingConnected = async (page: Page, open: () => Promise<unknown>): Promise<void> => {
  const list = await heldBack(page, isTheList);
  await open();
  await list.reached;
  const region = connectedSourcesRegion(page);
  await saysOfItsRead(region);
  const whileLoading = await saidNowIn(region.locator('[aria-live="polite"]'));
  const answered = page.waitForResponse((answer) => isTheList(new URL(answer.url())));
  list.release();
  expect(await answeredTheList(await answered), "the list's read was not answered").toBe(true);
  await expect(
    region.locator('[aria-live="polite"]'),
    "the list still says it is loading",
  ).not.toHaveText(whileLoading);
  await saysOfItsRead(region);
  await expect(region.getByRole("listitem")).toHaveCount(0);
};

test("an Admin connects by keyboard, then publishes within 100 ms", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace } = await anAdminAtSources(page, request, { workspace: "Airedale Tooling" });

  await test.step("an Admin connects by keyboard and sees received, indexing, indexed", async () => {
    await listsNothingConnected(page, () => page.goto("/sources/connected-sources"));
    await expect(connectedSourcesRegion(page)).toMatchAriaSnapshot(`
      - region "Connected Sources":
        - /children: equal
        - heading "Connected Sources" [level=2]
        - status
        - status
        - button "Connect a Document"
        - status
        - paragraph
    `);
    await expect(
      page.getByRole("button", { name: /^connect/i }),
      "the head's action is the one way to connect",
    ).toHaveCount(1);
    await passesTheAccessibilityGate();
    await skipLinkReachesThePage(page);

    // The wait switches on Chromium's chooser interception, which can land after an immediate
    // key press, leaving the chooser uncaught and cancelled.
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Connect a Document" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/\S/);
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toHaveAccessibleDescription(
      /\S/,
    );
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

    await expect(dialog.getByRole("progressbar", { name: "Upload of handbook.md" })).toBeVisible();
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
    const whileQueued = await saidNowIn(lastSynced);
    await expect(sensitivityOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("Indexing");
    await expect(lastSynced, "a sync that started is said as it was while queued").not.toHaveText(
      whileQueued,
    );
    await expect(lastSynced).toHaveText(A_SYNC_UNDER_WAY);

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("Indexed");
    await expect(lastSyncedOf(page, "The staff handbook")).toHaveText(/^\d{2}:\d{2} · /);
  });

  await test.step("publishes within 100 ms after stating confirmations and audit row", async () => {
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

    const carried = dialog.getByRole("region", { name: "What the Audit Log Will Record" });
    await expect(carried).toMatchAriaSnapshot(`
      - region "What the Audit Log Will Record":
        - heading "What the Audit Log Will Record" [level=3]
        - term: Action
        - definition
        - term: Connected Source
        - definition: Staff handbook
        - term: By
        - definition
        - term: Sensitivity
        - definition: Internal
        - term: Audience
        - definition: ${EVERYONE}
        - term: Lawful Basis Recorded
        - definition
        - term: Privacy Information Updated
        - definition
        - term: DPIA Reference Recorded
        - definition
        - term: Findings, Special Category
        - definition: "0"
        - term: Findings, Bank Details
        - definition: "2"
        - term: Findings, Government Identifier
        - definition: "0"
        - term: Findings, Date of Birth
        - definition: "0"
        - term: Findings, Home Address
        - definition: "1"
        - term: Findings, Personal Contact
        - definition: "0"
        - term: Findings, Person Name
        - definition: "0"
        - term: Findings, Job Title
        - definition: "0"
        - term: DPIA Input
        - definition
    `);

    const waiting = carried.getByRole("definition").filter({
      hasText: await saidNowIn(
        carried
          .getByRole("term")
          .filter({ hasText: "Lawful Basis Recorded" })
          .locator("xpath=following-sibling::dd[1]"),
      ),
    });
    await expect(waiting).toHaveCount(3);
    await expect(dialog.getByRole("checkbox", { name: "Lawful basis recorded" })).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("checkbox", { name: "Privacy information updated" }),
    ).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("checkbox", { name: "DPIA reference recorded" })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(waiting, "a ticked confirmation is carried as not yet made").toHaveCount(0);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(commit).toBeFocused();

    await clockTheNextKey(page, {
      at: "//li[.//h3[.='Staff handbook']]//dt[.='State']/following-sibling::dd[1]",
      reads: "Published",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "publish");

    await expect(saidIn(page)).toContainText("Staff handbook");
    await expect(stateOf(page, "Staff handbook")).toHaveText("Published");
    await expect(rowAction(page, "Staff handbook", "publish")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 3, name: "Staff handbook", exact: true }),
    ).toBeFocused();
  });
});
