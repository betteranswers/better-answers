import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, RAIL } from "@/app/words.ts";
import { SAID_OF_A_CONNECTED_SOURCE } from "@/features/sources/refusal-words.ts";
import { NOTHING_CONNECTED } from "@/features/sources/words.ts";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  keystrokesDismissed,
  moveTheSync,
  notFoundOfferingHome,
  person,
  provision,
  saysItsSentenceNotItsWord,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
  theActLandedWithinItsBudget,
  type SeedConnectedSource,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

/** Any id the platform mints: the page shows none, a finding's least of all. */
const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const CONNECTED_SOURCES = pageNamed(menuGroupIn(CONTROL_CENTRE, "sources"), "Connected sources");

const nav = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const connectedSourcesRegion = (page: Page) =>
  page.getByRole("region", { name: "Connected sources" });

const connectedSourceNamed = (page: Page, name: string): Locator =>
  connectedSourcesRegion(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });

/** The lead's one definition a term names, read the way a screen reader pairs them. */
const leadOf = (page: Page, name: string, term: string): Locator =>
  connectedSourceNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]");

const stateOf = (page: Page, name: string) => leadOf(page, name, "State");

const lastSyncedOf = (page: Page, name: string) => leadOf(page, name, "Last synced");

const classOf = (page: Page, name: string) => leadOf(page, name, "Class");

/** An Admin of a fresh workspace, signed in on the product's own page and standing on Sources. */
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
  await nav(page).getByRole("link", { name: CONNECTED_SOURCES.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  return { workspace, seeded };
};

/** An absence asserted straight after a key would pass before React drew what the key did. */
const twoFramesDrawn = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );

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

    // A fresh document, so no list is already in the page's cache.
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
    await expect(stateOf(page, "Case studies")).toHaveText("published");
    await expect(stateOf(page, "Contracts")).toHaveText("received");
    await expect(stateOf(page, "Framework returns")).toHaveText("indexing");
    await expect(stateOf(page, "Staff handbook")).toHaveText("indexed");
    await expect(lastSyncedOf(page, "Safety records")).toHaveText("Not synced yet");

    const handbook = connectedSourceNamed(page, "Staff handbook");
    await expect(handbook).toMatchAriaSnapshot(`
      - listitem:
        - heading "Staff handbook" [level=3]
        - button "Review Staff handbook"
        - button "Publish Staff handbook"
        - button "Narrow Staff handbook"
        - button "Widen Staff handbook"
        - term: Connector
        - definition: upload
        - term: Class
        - definition: Internal
        - term: Audience
        - definition: Everyone in the workspace
        - term: State
        - definition: indexed
        - term: Last synced
        - definition: /^\\d{2}:\\d{2} · \\d{1,2} \\w+ \\d{4}/
        - button "More about Staff handbook" [expanded=false]
    `);

    await expect(handbook).not.toContainText("searchable");
    await handbook.getByRole("button", { name: "More about Staff handbook" }).click();
    await expect(handbook).toContainText(
      "searchable: Its passages are found by search and opened by the readers it is published to.",
    );
    await expect(handbook).toContainText(
      "keep: The platform holds the record; nothing leaves without an Admin's act.",
    );
    await expect(page.locator("main")).not.toContainText(AN_ID);
  });

  test("tells an Admin why documents are quarantined, counting OCR ones", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Holme Surveys",
      connectedSources: [
        indexed("Site archive", {
          documents: [
            { title: "Floor plan", quarantineError: "NeedsOcrError" },
            { title: "Site survey", quarantineError: "NeedsOcrError" },
            { title: "Archive", quarantineError: "DeadlineExceededError" },
            { title: "Old minutes", quarantineError: "UnicodeDecodeError" },
            { title: "Handover notes" },
          ],
        }),
      ],
    });

    const archive = connectedSourceNamed(page, "Site archive");
    await archive.getByRole("button", { name: "More about Site archive" }).click();

    await expect(archive).toContainText("4 documents quarantined, 2 want OCR.");
    await expect(archive.getByRole("listitem")).toHaveText([
      "Archive: took too long",
      "Floor plan: needs OCR",
      "Old minutes: could not be read",
      "Site survey: needs OCR",
    ]);
  });

  test("shows an Editor Connected sources as not found, connecting nothing", async ({
    page,
    request,
  }) => {
    const workspace = await provision(request, { name: "Pennine Fabrication" });
    await seedConnectedSources(request, {
      workspaceId: workspace.workspaceId,
      connectedSources: [indexed("Staff handbook")],
    });
    const email = anAddress("editor");
    const editor = await person(request, email);
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: editor.id,
      role: "Editor",
    });
    await page.goto("/sign-in");
    await signIn(page, request, email);
    // Control Centre is the Admin's alone, so an Editor reaches Connected sources by address only.
    await page.goto(CONNECTED_SOURCES.path);

    await notFoundOfferingHome(page, "Editor");
    await expect(connectedSourcesRegion(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Staff handbook");

    await page.keyboard.press("b");
    await expect(page.getByRole("dialog", { name: "Connect a document" })).toHaveCount(0);
  });
});

test.describe("connecting a document on the Sources page", () => {
  test("an Admin connects by keyboard and sees received, indexing, indexed", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const { workspace } = await anAdminAtSources(page, request, { workspace: "Airedale Tooling" });
    await page.goto("/sources/connected-sources");
    await expect(connectedSourcesRegion(page)).toMatchAriaSnapshot(`
      - region "Connected sources":
        - /children: equal
        - heading "Connected sources" [level=2]
        - paragraph: ${NOTHING_CONNECTED}
    `);
    await expect(
      page.getByRole("button", { name: /^connect/i }),
      "the toolbar's act is the one way to connect",
    ).toHaveCount(1);
    await passesTheAccessibilityGate();
    await skipLinkReachesThePage(page);

    // The wait switches on Chromium's chooser interception, which can land after an immediate
    // key press, leaving the chooser uncaught and cancelled.
    const choosing = page.waitForEvent("filechooser");
    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Connect a document" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("The staff handbook");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Class" })).toHaveText("Restricted");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByLabel("File")).toBeFocused();

    await page.keyboard.press("Space");
    // Large enough for the throttled upload to be seen partway.
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
    await expect(dialog.getByRole("button", { name: "Connect the document" })).toBeFocused();
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
      page.getByText("Connected “The staff handbook”: handbook.md was received"),
    ).toBeVisible();
    await expect(stateOf(page, "The staff handbook")).toHaveText("received");
    await expect(lastSyncedOf(page, "The staff handbook")).toContainText("Sync queued");
    await expect(classOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("indexing");
    await expect(lastSyncedOf(page, "The staff handbook")).toContainText("Syncing");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("indexed");
    await expect(lastSyncedOf(page, "The staff handbook")).toHaveText(/^\d{2}:\d{2} · /);
  });

  test("refuses an Admin's unconvertible file, naming the kinds that convert", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, { workspace: "Ryburn Signs" });

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Connect a document" });
    await dialog.getByLabel("Name").fill("Shop photographs");
    await dialog.getByLabel("File").setInputFiles({
      name: "shopfront.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await dialog.getByRole("button", { name: "Connect the document" }).click();

    await saysItsSentenceNotItsWord(dialog.getByRole("alert"), {
      table: SAID_OF_A_CONNECTED_SOURCE,
      word: "media-type-refused",
    });
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

const HEALTH_CUE_BOX = "Select special category by HEALTH_CUE in Staff survey";

const A_DISMISSED_SPAN =
  "Dismissed 1 span as not special category. The seam's verdict passes over a dismissed span, which stays withheld unless kept in text.";

/**
 * Two documents as a sync leaves them after a dismissal: one lifted to its connected source's class, one
 * still holding a span nobody dismissed.
 */
const SERVICE_RECORDS: SeedConnectedSource = indexed("Service records", {
  documents: [
    {
      title: "Pump service notes",
      findings: [
        {
          category: "special-category",
          ruleId: "HEALTH_CUE",
          tier: "always",
          spans: 1,
          dismissed: 1,
        },
      ],
    },
    {
      title: "Absence log",
      sensitivity: "Restricted",
      findings: [
        {
          category: "special-category",
          ruleId: "HEALTH_CUE",
          tier: "always",
          spans: 2,
          dismissed: 1,
        },
      ],
    },
  ],
});

const reviewOf = (page: Page, name: string) =>
  page.getByRole("region", { name: `Review of ${name}` });

const findingRow = (page: Page, name: string, document: string, rule: string) =>
  reviewOf(page, name).getByRole("row").filter({ hasText: document }).filter({ hasText: rule });

test.describe("reviewing a connected source's findings", () => {
  test("shows an Admin findings by category and rule, counts only", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Colne Valley Metals",
      connectedSources: [SUPPLIER_FORMS],
    });

    await connectedSourceNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .focus();
    await page.keyboard.press("r");
    await expect(
      page.getByRole("heading", { level: 2, name: "Review of Supplier forms" }),
    ).toBeFocused();

    await expect(reviewOf(page, "Supplier forms").getByRole("table")).toMatchAriaSnapshot(`
      - table:
        - caption: 0 finding groups selected. Select a group with x, then keep it in text, narrow its document or dismiss it as not special category with the acts above.
        - rowgroup:
          - row "Selected Category Rule Document Found Class":
            - columnheader "Selected"
            - columnheader "Category"
            - columnheader "Rule"
            - columnheader "Document"
            - columnheader "Found"
            - columnheader "Class"
        - rowgroup:
          - row:
            - cell:
              - checkbox "Select bank details by UK_BANK_ACCOUNT in Supplier form" [checked=false]
            - cell "bank details always"
            - cell "UK_BANK_ACCOUNT"
            - cell "Supplier form"
            - cell "2"
            - cell "Internal"
          - row:
            - cell:
              - checkbox "Select home address by UK_HOME_ADDRESS in Supplier form" [checked=false]
            - cell "home address default on"
            - cell "UK_HOME_ADDRESS"
            - cell "Supplier form"
            - cell "1"
            - cell "Internal"
          - row:
            - cell:
              - checkbox "Select special category by HEALTH_CUE in Staff survey" [checked=false]
            - cell "special category always"
            - cell "HEALTH_CUE"
            - cell "Staff survey"
            - cell "1"
            - cell:
              - text: Restricted
              - paragraph: Already narrowed A special category finding narrowed this document at the seam.
    `);
    await expect(page.locator("body")).not.toContainText(AN_ID);
  });

  test("lets an Admin keep groups in text and narrow documents", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Hebden Plastics",
      connectedSources: [SUPPLIER_FORMS],
    });
    await connectedSourceNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .click();

    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: "Keep in text" }),
    ).toBeDisabled();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: "Narrow these documents" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("heading", { level: 2, name: "Review of Supplier forms" }),
    ).toBeFocused();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("checkbox", {
        name: "Select bank details by UK_BANK_ACCOUNT in Supplier form",
      }),
    ).toBeFocused();
    await page.keyboard.press("x");
    await expect(
      page.getByRole("checkbox", {
        name: "Select bank details by UK_BANK_ACCOUNT in Supplier form",
      }),
    ).toBeChecked();

    await page.keyboard.press("k");
    const keeping = page.getByRole("dialog", { name: "Keep 1 finding group in text" });
    await expect(keeping).toContainText(
      "bank details by UK_BANK_ACCOUNT in Supplier form: 2 found",
    );
    await expect(keeping.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("The company's own bank details, printed on every invoice");
    await page.keyboard.press("Enter");

    await expect(
      page.getByText(
        "Kept 1 finding group in text: 2 spans restored, and the sync that lets them back in is queued.",
      ),
    ).toBeVisible();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: "Keep in text" }),
    ).toBeDisabled();

    await page
      .getByRole("checkbox", { name: "Select home address by UK_HOME_ADDRESS in Supplier form" })
      .focus();
    await page.keyboard.press("x");
    await page.keyboard.press("d");
    const narrowing = page.getByRole("dialog", { name: "Narrow 1 document to Restricted" });
    await expect(narrowing.getByRole("listitem")).toHaveText(["Supplier form"]);
    await narrowing.getByRole("button", { name: "Narrow 1 document to Restricted" }).focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByText(
        "Narrowed 1 document to Restricted; 0 concepts and 0 compositions moved with them.",
      ),
    ).toBeVisible();
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", "UK_HOME_ADDRESS"),
    ).toContainText("Restricted");
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", "UK_BANK_ACCOUNT"),
    ).toContainText("Restricted");
    await expect(page.locator("body")).not.toContainText(AN_ID);
  });

  test("dismisses a special category group, row and sync saying so", async ({ page, request }) => {
    const { workspace } = await anAdminAtSources(page, request, {
      workspace: "Ripponden Pumps",
      connectedSources: [SUPPLIER_FORMS],
    });
    await connectedSourceNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .click();
    const review = reviewOf(page, "Supplier forms");
    const dismissal = review.getByRole("button", { name: /^Dismiss .*as not special category$/ });
    await expect(dismissal).toBeDisabled();

    await page.keyboard.press("Tab");
    await page.keyboard.press("x");
    await expect(
      review.getByRole("checkbox", {
        name: "Select bank details by UK_BANK_ACCOUNT in Supplier form",
      }),
    ).toBeChecked();
    await expect(dismissal).toBeDisabled();
    await expect(review).toContainText(
      sentenceOf(SAID_OF_A_CONNECTED_SOURCE["not-special-category"]),
    );
    await page.keyboard.press("x");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const healthCue = review.getByRole("checkbox", { name: HEALTH_CUE_BOX });
    await expect(healthCue).toBeFocused();
    await page.keyboard.press("x");
    await expect(dismissal).toHaveAccessibleName("Dismiss 1 finding group as not special category");
    await expect(dismissal).toBeEnabled();

    await page.keyboard.press("s");
    const dismissing = page.getByRole("dialog", {
      name: "Dismiss 1 finding group as not special category",
    });
    await expect(dismissing).toContainText(
      "special category by HEALTH_CUE in Staff survey: 1 found",
    );
    await expect(dismissing.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("A survey of the pumps our engineers diagnose, not of people");
    await clockTheNextKey(page, {
      at: "//tr[td[.='HEALTH_CUE']][td[.='Staff survey']]",
      reads: "Dismissed",
    });
    await page.keyboard.press("Enter");
    await theActLandedWithinItsBudget(page, "dismissal");

    await expect(review).toContainText(
      "Dismissed 1 finding group as not special category in 1 document. The sync that reads the dismissal: queued.",
    );
    await expect(healthCue, "focus did not come back to the row the act left").toBeFocused();
    const row = findingRow(page, "Supplier forms", "Staff survey", "HEALTH_CUE");
    await expect(row).toContainText(A_DISMISSED_SPAN);
    await expect(row).not.toContainText("Already narrowed");
    await expect(lastSyncedOf(page, "Supplier forms")).toContainText("Sync queued");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(review).toContainText("The sync that reads the dismissal: claimed.");
    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(review).toContainText("The sync that reads the dismissal: done.");
    await expect(page.locator("body")).not.toContainText(AN_ID);

    await page.reload();
    await connectedSourceNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .click();
    await expect(
      findingRow(page, "Supplier forms", "Staff survey", "HEALTH_CUE"),
      "the dismissal did not outlive the page that made it",
    ).toContainText(A_DISMISSED_SPAN);
  });

  test("shows an Admin which dismissed documents are still narrowed", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Sowerby Hydraulics",
      connectedSources: [SERVICE_RECORDS],
    });
    await connectedSourceNamed(page, "Service records")
      .getByRole("button", { name: "Review Service records" })
      .click();

    await expect(reviewOf(page, "Service records").getByRole("rowgroup").last())
      .toMatchAriaSnapshot(`
      - rowgroup:
        - row:
          - cell:
            - checkbox "Select special category by HEALTH_CUE in Absence log" [checked=false]
          - cell "special category always"
          - cell "HEALTH_CUE"
          - cell "Absence log"
          - cell "2"
          - cell:
            - text: Restricted
            - paragraph: Already narrowed A special category finding narrowed this document at the seam.
            - paragraph: ${A_DISMISSED_SPAN}
        - row:
          - cell:
            - checkbox "Select special category by HEALTH_CUE in Pump service notes" [checked=false]
          - cell "special category always"
          - cell "HEALTH_CUE"
          - cell "Pump service notes"
          - cell "1"
          - cell:
            - text: Internal
            - paragraph: ${A_DISMISSED_SPAN}
    `);
  });

  test("shows an Admin a kept group an erasure still withholds", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Wharfe Catering",
      connectedSources: [
        indexed("Payroll exports", {
          documents: [
            {
              title: "March payroll",
              findings: [
                {
                  category: "bank-details",
                  ruleId: "UK_BANK_ACCOUNT",
                  tier: "always",
                  spans: 2,
                  overriddenByErasure: true,
                },
              ],
            },
          ],
        }),
      ],
    });
    await connectedSourceNamed(page, "Payroll exports")
      .getByRole("button", { name: "Review Payroll exports" })
      .click();

    const row = findingRow(page, "Payroll exports", "March payroll", "UK_BANK_ACCOUNT");
    await expect(row).toContainText("Kept, still withheld");
    await expect(row).toContainText(
      "2 kept spans overridden by an erasure request: an erasure outranks a keep.",
    );
  });

  test("previews an unpublished source's passages to the Admin reviewing it", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Kirklees Print",
      connectedSources: [
        indexed("Staff handbook", {
          documents: [
            {
              title: "handbook.md",
              passages: ["The handbook says what the company decided.", "Pay goes to [withheld]."],
            },
          ],
        }),
      ],
    });
    await connectedSourceNamed(page, "Staff handbook")
      .getByRole("button", { name: "Review Staff handbook" })
      .click();
    await page
      .getByRole("button", { name: "Preview the passages a reader would see once published" })
      .click();

    await expect(reviewOf(page, "Staff handbook").getByRole("listitem")).toHaveText([
      "The handbook says what the company decided.",
      "Pay goes to [withheld].",
    ]);
  });

  test("scrolls nothing sideways at 320 pixels with the review open", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Marsden Mills",
      connectedSources: [SUPPLIER_FORMS],
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await connectedSourceNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .click();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);
    await reviewOf(page, "Supplier forms").getByRole("checkbox", { name: HEALTH_CUE_BOX }).click();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", {
        name: "Dismiss 1 finding group as not special category",
      }),
    ).toBeEnabled();

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

    await connectedSourceNamed(page, "Staff handbook")
      .getByRole("button", { name: "Review Staff handbook" })
      .focus();
    await page.keyboard.press("p");
    const dialog = page.getByRole("dialog", { name: "Publish Staff handbook" });
    await expect(dialog.getByRole("button", { name: "Publish Staff handbook" })).toBeDisabled();

    const carried = dialog.getByRole("region", { name: "What the audit row will carry" });
    await expect(carried).toMatchAriaSnapshot(`
      - region "What the audit row will carry":
        - heading "What the audit row will carry" [level=3]
        - term: Action
        - definition: Connected source published
        - term: Connected source
        - definition: Staff handbook
        - term: By
        - definition: You, at the instant the platform records it
        - term: Class
        - definition: Internal
        - term: Audience
        - definition: Everyone in the workspace
        - term: Lawful basis recorded
        - definition: Not yet confirmed
        - term: Privacy information updated
        - definition: Not yet confirmed
        - term: DPIA reference recorded
        - definition: Not yet confirmed
        - term: Findings, special category
        - definition: "0"
        - term: Findings, bank details
        - definition: "2"
        - term: Findings, government identifier
        - definition: "0"
        - term: Findings, date of birth
        - definition: "0"
        - term: Findings, home address
        - definition: "1"
        - term: Findings, personal contact
        - definition: "0"
        - term: Findings, person name
        - definition: "0"
        - term: Findings, job title
        - definition: "0"
        - term: DPIA input
        - definition: The hash of this connected source's DPIA input, taken at the click
    `);

    await expect(dialog.getByRole("checkbox", { name: "Lawful basis recorded" })).toBeFocused();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(carried.getByText("Confirmed", { exact: true })).toHaveCount(3);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Publish Staff handbook" })).toBeFocused();

    await clockTheNextKey(page, {
      at: "//li[.//h3[.='Staff handbook']]//dt[.='State']/following-sibling::dd[1]",
      reads: "published",
    });
    await page.keyboard.press("Enter");
    await theActLandedWithinItsBudget(page, "publish");

    await expect(
      page.getByText(
        "Published “Staff handbook”: its passages reach everyone in the workspace now",
      ),
    ).toBeVisible();
    await expect(stateOf(page, "Staff handbook")).toHaveText("published");
    await expect(
      connectedSourceNamed(page, "Staff handbook").getByRole("button", {
        name: "Publish Staff handbook",
      }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Staff handbook" })).toBeFocused();
  });

  test("narrows a published source with its citing concepts and compositions", async ({
    page,
    request,
  }) => {
    const { seeded } = await anAdminAtSources(page, request, {
      workspace: "Todmorden Engineering",
      connectedSources: [
        indexed("Supplier payments", {
          published: true,
          documents: [{ title: "Payment terms", cited: true }],
        }),
      ],
    });
    const citedBy = seeded.connectedSources[0]?.documents[0]?.citedBy;
    expect(citedBy, "the harness seeded no citing concept").toBeDefined();

    await connectedSourceNamed(page, "Supplier payments")
      .getByRole("button", { name: "Narrow Supplier payments" })
      .focus();
    await page.keyboard.press("n");
    const dialog = page.getByRole("dialog", { name: "Narrow Supplier payments" });
    await expect(dialog.getByRole("combobox", { name: "Class" })).toHaveText("Restricted");
    await dialog.getByRole("button", { name: "Narrow Supplier payments to Restricted" }).focus();
    await page.keyboard.press("Enter");

    await expect(classOf(page, "Supplier payments")).toHaveText("Restricted");
    await expect(
      page.getByText(
        "Narrowed “Supplier payments” to Restricted. 1 concept and 1 composition moved with it.",
      ),
    ).toBeVisible();
    await expect(page.getByText(citedBy?.iri ?? "")).toBeVisible();
  });

  test("widens by keyboard within 100 ms, audit row shown first", async ({
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
    expect(citedBy, "the harness seeded no citing concept").toBeDefined();

    await connectedSourceNamed(page, "Tender answers")
      .getByRole("button", { name: "Widen Tender answers" })
      .focus();
    await page.keyboard.press("w");
    const dialog = page.getByRole("dialog", { name: "Widen Tender answers" });
    await expect(dialog).toHaveAccessibleDescription(
      "Its passages reach more readers the moment you widen it, and every concept citing its documents, and every composition including one, moves with it in the same act. A document with a narrower class of its own keeps it.",
    );
    const classPicked = dialog.getByRole("combobox", { name: "Class" });
    await expect(classPicked).toBeFocused();
    await expect(classPicked).toHaveText("Internal");
    await expect(dialog.getByRole("region", { name: "What the audit row will carry" }))
      .toMatchAriaSnapshot(`
      - region "What the audit row will carry":
        - heading "What the audit row will carry" [level=3]
        - term: Action
        - definition: Connected source widened
        - term: Connected source
        - definition: Tender answers
        - term: By
        - definition: You, at the instant the platform records it
        - term: Class, from
        - definition: Restricted
        - term: Class, to
        - definition: Internal
        - term: Audience, from
        - definition: Everyone in the workspace
        - term: Audience, to
        - definition: Everyone in the workspace
    `);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Enter");
    await page.getByRole("option", { name: "Restricted" }).press("Enter");
    await expect(classPicked).toHaveText("Restricted");
    await expect(classPicked, "the list of classes did not hand focus back").toBeFocused();
    const commit = dialog.getByRole("button", { name: /^Widen Tender answers to / });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAccessibleDescription(
      sentenceOf(SAID_OF_A_CONNECTED_SOURCE["not-wider"]),
    );

    await classPicked.press("Enter");
    await page.getByRole("option", { name: "Internal" }).press("Enter");
    await expect(classPicked).toHaveText("Internal");
    await expect(classPicked, "the list of classes did not hand focus back").toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", {
        name: "Widen Tender answers to Internal for everyone in the workspace",
      }),
    ).toBeFocused();

    await clockTheNextKey(page, {
      at: "//li[.//h3[.='Tender answers']]//dt[.='Class']/following-sibling::dd[1]",
      reads: "Internal",
    });
    await page.keyboard.press("Enter");
    await theActLandedWithinItsBudget(page, "widen");

    await expect(connectedSourcesRegion(page).getByRole("status")).toContainText(
      "Widened “Tender answers” to Internal for everyone in the workspace. 1 concept and 1 composition moved with it.",
    );
    await expect(page.getByText(citedBy?.iri ?? "")).toBeVisible();
    await expect(classOf(page, "Tender answers")).toHaveText("Internal");
    await expect(page.getByRole("heading", { level: 3, name: "Tender answers" })).toBeFocused();
  });

  test("widens a Public source's audience, then says nothing is wider", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Ripponden Glass",
      connectedSources: [
        indexed("Price book", { sensitivity: "Public", audience: "groups", published: true }),
      ],
    });
    const audienceOf = leadOf(page, "Price book", "Audience");
    await expect(audienceOf).toHaveText("Named groups (1 group)");

    await connectedSourceNamed(page, "Price book")
      .getByRole("button", { name: "Widen Price book" })
      .focus();
    await page.keyboard.press("w");
    const dialog = page.getByRole("dialog", { name: "Widen Price book" });
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toHaveText(
      "Everyone in the workspace",
    );
    await expect(dialog.getByRole("region", { name: "What the audit row will carry" }))
      .toMatchAriaSnapshot(`
      - region "What the audit row will carry":
        - heading "What the audit row will carry" [level=3]
        - term: Action
        - definition: Connected source widened
        - term: Connected source
        - definition: Price book
        - term: By
        - definition: You, at the instant the platform records it
        - term: Class, from
        - definition: Public
        - term: Class, to
        - definition: Public
        - term: Audience, from
        - definition: Named groups
        - term: Audience, to
        - definition: Everyone in the workspace
    `);
    await passesTheAccessibilityGate();

    await dialog
      .getByRole("button", { name: "Widen Price book to Public for everyone in the workspace" })
      .press("Enter");

    // The row reads widened before the api answers, and a late answer overwrites the next
    // `w`'s sentence.
    await expect(connectedSourcesRegion(page).getByRole("status")).toHaveText(
      "Widened “Price book” to Public for everyone in the workspace. 0 concepts and 0 compositions moved with it.",
    );
    await expect(audienceOf).toHaveText("Everyone in the workspace");
    await expect(
      connectedSourceNamed(page, "Price book").getByRole("button", { name: "Widen Price book" }),
    ).toHaveCount(0);
    await connectedSourceNamed(page, "Price book")
      .getByRole("button", { name: "Review Price book" })
      .focus();
    await page.keyboard.press("w");
    await expect(connectedSourcesRegion(page).getByRole("status")).toHaveText(
      "“Price book” is Public for everyone in the workspace, and no class or audience is wider.",
    );
  });

  test("refuses widening with a special category finding unreviewed", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Mytholmroyd Pumps",
      connectedSources: [{ ...SERVICE_RECORDS, sensitivity: "Restricted", published: true }],
    });

    await connectedSourceNamed(page, "Service records")
      .getByRole("button", { name: "Widen Service records" })
      .click();
    await page
      .getByRole("dialog", { name: "Widen Service records" })
      .getByRole("button", {
        name: "Widen Service records to Internal for everyone in the workspace",
      })
      .click();

    await expect(connectedSourcesRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_A_CONNECTED_SOURCE["special-category-unreviewed"]),
    );
    await expect(classOf(page, "Service records")).toHaveText("Restricted");
  });
});

test.describe("the Sources page's keystrokes", () => {
  test("lists keystrokes on ?, and one switch turns them off", async ({ page, request }) => {
    await anAdminAtSources(page, request, { workspace: "Luddenden Weaving" });

    await page.keyboard.press("?");
    const heading = keystrokesOn(CONNECTED_SOURCES.name);
    const listed = page.getByRole("dialog", { name: heading });
    await expect(listed).toMatchAriaSnapshot(`
      - dialog ${JSON.stringify(heading)}:
        - heading ${JSON.stringify(heading)} [level=2]
        - paragraph: ${JSON.stringify(KEYSTROKE_WORDS.where)}
        - checkbox ${JSON.stringify(KEYSTROKE_WORDS.turnedOn)} [checked]
        - text: ${JSON.stringify(KEYSTROKE_WORDS.turnedOn)}
        - term: b
        - definition: Connect a document
        - term: r
        - definition: Review the connected source in focus
        - term: p
        - definition: Publish the connected source in focus
        - term: "n"
        - definition: Narrow the connected source in focus
        - term: w
        - definition: Widen the connected source in focus
        - term: x
        - definition: Select or clear the finding group in focus
        - term: k
        - definition: Keep the selected finding groups in text
        - term: d
        - definition: Narrow the documents the selected finding groups sit in
        - term: s
        - definition: Dismiss the selected finding groups as not special category
        - term: "?"
        - definition: ${JSON.stringify(KEYSTROKE_WORDS.showTheList)}
        - term: /⌘K|Ctrl K/
        - definition: ${JSON.stringify(JUMP_TO.name)}
    `);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    // The rail's: the toolbar keeps the page's own acts alone.
    const keystrokes = page
      .getByRole("navigation", { name: RAIL })
      .getByRole("button", { name: KEYSTROKE_WORDS.button });
    await expect(keystrokes).toHaveAttribute("aria-keyshortcuts", "?");
    await expect(keystrokes).toBeFocused();

    await page.keyboard.press("b");
    const connectedSource = page.getByRole("dialog", { name: "Connect a document" });
    await expect(connectedSource).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(connectedSource).toHaveCount(0);

    await keystrokes.click();
    await listed.getByRole("checkbox", { name: KEYSTROKE_WORDS.turnedOn }).press("Space");
    // A key sent into the closing list is ignored as the list's own, however the setting reads.
    await keystrokesDismissed(page, listed);
    await page.keyboard.press("b");
    await page.keyboard.press("?");
    await twoFramesDrawn(page);
    await expect(connectedSource, "a keystroke turned off still bound").toHaveCount(0);
    await expect(listed, "a keystroke turned off still listed").toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await page.keyboard.press("b");
    await twoFramesDrawn(page);
    await expect(connectedSource, "the choice did not survive a reload").toHaveCount(0);
  });
});
