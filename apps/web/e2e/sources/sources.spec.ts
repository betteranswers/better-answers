import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  clockTheNextKey,
  moveTheSync,
  provision,
  saysARefusal,
  saysOfItsRead,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { heldBack } from "../knowledge.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const nav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const EVERYONE = "Everyone in the workspace";

const connectedSourcesRegion = (page: Page) =>
  page.getByRole("region", { name: "Connected Sources" });

const saidIn = (page: Page): Locator => connectedSourcesRegion(page).getByRole("status").last();

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

const connectedSourceNamed = (page: Page, name: string): Locator =>
  connectedSourcesRegion(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });

const leadOf = (page: Page, name: string, term: string): Locator =>
  connectedSourceNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]");

const stateOf = (page: Page, name: string) => leadOf(page, name, "State");

const lastSyncedOf = (page: Page, name: string) => leadOf(page, name, "Last Synced");

const sensitivityOf = (page: Page, name: string) => leadOf(page, name, "Sensitivity");

const ROW_ACTIONS = {
  review: "Review Findings",
  publish: "Publish",
  narrow: "Narrow Sensitivity",
  widen: "Widen Sensitivity or Audience",
} as const;

const rowAction = (page: Page, name: string, action: keyof typeof ROW_ACTIONS): Locator =>
  connectedSourceNamed(page, name).getByRole("button", {
    name: `${ROW_ACTIONS[action]} ${name}`,
    exact: true,
  });

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

const anAdminAtSources = async (
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
  await nav(page).getByRole("link", { name: "Connected Sources" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  return { workspace, seeded };
};

const indexed = (
  name: string,
  overrides: Partial<SeedConnectedSource> = {},
): SeedConnectedSource => ({
  name,
  sensitivity: "Internal",
  sync: "done",
  documents: [{ title: `${name}.md` }],
  ...overrides,
});

test.describe("the Sources page's list of connected sources", () => {
  test("lists an Admin ten sources in a second, details folded", async ({ page, request }) => {
    const ten: SeedConnectedSource[] = [
      indexed("Bid library"),
      indexed("Case studies", { published: true }),
      indexed("Contracts", { sync: "queued" }),
      indexed("Framework returns", { sync: "claimed" }),
      indexed("HR policies", { sensitivity: "Restricted" }),
      indexed("Method statements", { published: true, sensitivity: "Public" }),
      indexed("Quality manual"),
      indexed("Safety records", { sync: "none" }),
      indexed("Staff handbook"),
      indexed("Tender archive", { published: true }),
    ];
    await anAdminAtSources(page, request, { workspace: "Calder Joinery", connectedSources: ten });

    const started = Date.now();
    await page.goto("/sources/connected-sources");
    await expect(connectedSourcesRegion(page).getByRole("heading", { level: 3 })).toHaveCount(10);
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "connected sources list", description: `${elapsed} ms` });
    expect(elapsed, "the list of ten connected sources rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(connectedSourcesRegion(page).getByRole("heading", { level: 3 })).toHaveText(
      ten.map((connectedSource) => connectedSource.name),
    );
    await expect(stateOf(page, "Case studies")).toHaveText("Published");
    await expect(stateOf(page, "Contracts")).toHaveText("Received");
    await expect(stateOf(page, "Framework returns")).toHaveText("Indexing");
    await expect(stateOf(page, "Staff handbook")).toHaveText("Indexed");
    await expect(
      lastSyncedOf(page, "Safety records"),
      "a connected source never synced shows a time",
    ).toHaveText(/^\D+$/);
    await expect(
      connectedSourcesRegion(page).getByRole("button", { name: /^More Details /, expanded: false }),
    ).toHaveCount(10);
    await expect(page.locator("main")).not.toContainText(AN_ID);
  });
});

test.describe("connecting a document on the Sources page", () => {
  test("an Admin connects by keyboard and sees received, indexing, indexed", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { workspace } = await anAdminAtSources(page, request, { workspace: "Airedale Tooling" });
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

  test("says in the dialog that the api refused an upload", async ({ page, request }) => {
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
    await saysARefusal(dialog.getByRole("alert"));
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

const healthCueBoxIn = (title: string): string =>
  `Select special category by ${HEALTH_CUE_RULE} in ${title}`;

const HEALTH_CUE_BOX = healthCueBoxIn("Staff survey");

const reviewOf = (page: Page, name: string) =>
  connectedSourceNamed(page, name).getByRole("region", { name: `Review of ${name}` });

test.describe("reviewing a connected source's findings", () => {
  test("scrolls nothing sideways at 320 pixels, review and panel open", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Marsden Mills",
      connectedSources: [SUPPLIER_FORMS],
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await rowAction(page, "Supplier forms", "review").click();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);
    await reviewOf(page, "Supplier forms").getByRole("checkbox", { name: HEALTH_CUE_BOX }).click();
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
    expect(room.scrolls, "the page scrolls sideways at 320 pixels").toBeLessThanOrEqual(room.holds);
  });
});

test.describe("publishing, narrowing and widening a connected source", () => {
  test("publishes within 100 ms after stating confirmations and audit row", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Spen Valley Bakery",
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
    await expect(page.getByRole("heading", { level: 3, name: "Staff handbook" })).toBeFocused();
  });

  test("widens by keyboard within 100 ms, listing what changes", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { seeded } = await anAdminAtSources(page, request, {
      workspace: "Hebden Bridge Joinery",
      connectedSources: [
        indexed("Tender answers", {
          sensitivity: "Restricted",
          published: true,
          documents: [{ title: "Method statement", cited: true }],
        }),
      ],
    });
    const citedBy = seeded.connectedSources[0]?.documents[0]?.citedBy;
    assert.ok(citedBy, "the harness seeded no citing concept");

    await rowAction(page, "Tender answers", "widen").focus();
    await page.keyboard.press("w");
    const panel = panelOf(page, "Tender answers", "widen");
    await expect(panel).toHaveAccessibleDescription(/\S/);
    const sensitivityPicked = panel.getByRole("combobox", { name: "Sensitivity" });
    await expect(sensitivityPicked).toBeFocused();
    await expect(sensitivityPicked).toHaveText("Internal");
    await expect(panel.getByRole("term")).toHaveText(["Sensitivity"]);
    await expect(panel.getByRole("definition")).toHaveText([/Restricted.+Internal/]);
    await expect(page.getByRole("dialog"), "the widening opened a dialog").toHaveCount(0);
    await expect(
      connectedSourceNamed(page, "Tender answers").getByRole("region"),
      "the panel shows the audit row's shape",
    ).toHaveCount(0);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Restricted" }).press("Enter");
    await expect(sensitivityPicked).toHaveText("Restricted");
    await expect(
      sensitivityPicked,
      "the list of sensitivities did not hand focus back",
    ).toBeFocused();
    const commit = commitOf(page, "Tender answers", "widen");
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAccessibleDescription(/\S/);
    await expect(panel.getByRole("term")).toHaveCount(0);

    await sensitivityPicked.press("Enter");
    await page.getByRole("option", { name: "Internal" }).press("Enter");
    await expect(sensitivityPicked).toHaveText("Internal");
    await expect(
      sensitivityPicked,
      "the list of sensitivities did not hand focus back",
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(commit).toBeFocused();

    await clockTheNextKey(page, {
      at: "(//li[.//h3[.='Tender answers']]//dt[.='Sensitivity'])[1]/following-sibling::dd[1]",
      reads: "Internal",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "widen");

    await expect(saidIn(page)).toHaveText(/Tender answers\D+Internal\D+\b1\b\D+\b1\b/);
    await expect(page.getByText(citedBy.iri)).toBeVisible();
    await expect(sensitivityOf(page, "Tender answers")).toHaveText("Internal");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Tender answers" })).toBeFocused();
  });
});
