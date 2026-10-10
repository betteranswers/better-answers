import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { JUMP_TO, RAIL } from "@/app/words.ts";
import { SAID_OF_A_CONNECTED_SOURCE } from "@/features/sources/refusal-words.ts";
import {
  AUDIENCE_WORDS,
  CONNECT_WORDS,
  CONNECTOR_WORDS,
  DESTINATIONS_TERM,
  destinationOf,
  NEEDS_OCR,
  NOTHING_CONNECTED,
  retentionOf,
  REVIEW_WORDS,
  ROW_ACTIONS,
  ruleWordOf,
  SENSITIVITY_PANEL_WORDS,
  sensitivityAndAudienceWords,
  sentenceCased,
  STATE_MEANS,
  STATE_WORDS,
  SYNC_OF_A_DISMISSAL,
  THE_CHANGE_BEFORE_IS_STILL_GOING,
  unreadableCounted,
  unreadableWordOf,
} from "@/features/sources/words.ts";
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
  quoted,
  saysItsSentenceNotItsWord,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
  type SeedConnectedSource,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

/** Any id the platform mints: the page shows none, a finding's least of all. */
const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const CONNECTED_SOURCES = pageNamed(menuGroupIn(CONTROL_CENTRE, "sources"), "Connected sources");

const nav = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const connectedSourcesRegion = (page: Page) =>
  page.getByRole("region", { name: "Connected sources" });

/** The region's outcome line: its count and the connect action's progress are statuses before it. */
const saidIn = (page: Page): Locator => connectedSourcesRegion(page).getByRole("status").last();

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

const sensitivityOf = (page: Page, name: string) => leadOf(page, name, "Sensitivity");

/** The lead's terms come first in a row, so the last of a name is More about's. */
const detailOf = (page: Page, name: string, term: string): Locator =>
  connectedSourceNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .last()
    .locator("xpath=following-sibling::dd[1]");

/** A row's action, named for its effect and then, for a screen reader, its connected source. */
const rowAction = (page: Page, name: string, action: keyof typeof ROW_ACTIONS): Locator =>
  connectedSourceNamed(page, name).getByRole("button", {
    name: `${ROW_ACTIONS[action]} ${name}`,
    exact: true,
  });

type SensitivityChange = keyof typeof SENSITIVITY_PANEL_WORDS;

/** Found inside its connected source's row, so a panel drawn anywhere else is not found. */
const panelOf = (page: Page, name: string, change: SensitivityChange): Locator =>
  connectedSourceNamed(page, name).getByRole("group", {
    name: SENSITIVITY_PANEL_WORDS[change].named(name),
  });

type Asked = Parameters<typeof sensitivityAndAudienceWords>[0];

const commitOf = (page: Page, name: string, change: SensitivityChange, asked: Asked): Locator =>
  panelOf(page, name, change).getByRole("button", {
    name: SENSITIVITY_PANEL_WORDS[change].commit(name, asked),
    exact: true,
  });

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
    await expect(stateOf(page, "Case studies")).toHaveText(STATE_WORDS.published);
    await expect(stateOf(page, "Contracts")).toHaveText(STATE_WORDS.received);
    await expect(stateOf(page, "Framework returns")).toHaveText(STATE_WORDS.indexing);
    await expect(stateOf(page, "Staff handbook")).toHaveText(STATE_WORDS.indexed);
    await expect(lastSyncedOf(page, "Safety records")).toHaveText("Not synced yet");
    await expect(
      connectedSourcesRegion(page).getByRole("button", { name: /^More about /, expanded: false }),
    ).toHaveCount(10);
    await expect(page.locator("main")).not.toContainText(AN_ID);
  });

  test("reads an Admin a row's stored values as words", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Elland Brassworks",
      connectedSources: [indexed("Staff handbook")],
    });

    const handbook = connectedSourceNamed(page, "Staff handbook");
    await expect(handbook).toMatchAriaSnapshot(`
      - listitem:
        - heading "Staff handbook" [level=3]
        - button ${quoted(`${ROW_ACTIONS.review} Staff handbook`)} [expanded=false]
        - button ${quoted(`${ROW_ACTIONS.publish} Staff handbook`)}
        - button ${quoted(`${ROW_ACTIONS.narrow} Staff handbook`)}
        - button ${quoted(`${ROW_ACTIONS.widen} Staff handbook`)}
        - term: Connector
        - definition: ${quoted(CONNECTOR_WORDS.upload)}
        - term: Sensitivity
        - definition: Internal
        - term: Audience
        - definition: Everyone in the workspace
        - term: State
        - definition: ${quoted(STATE_WORDS.indexed)}
        - term: Last synced
        - definition: /^\\d{2}:\\d{2} · \\d{1,2} \\w+ \\d{4}/
        - button "More about Staff handbook" [expanded=false]
    `);
    const list = connectedSourcesRegion(page).getByRole("list");
    for (const stored of [...Object.keys(STATE_WORDS), ...Object.keys(CONNECTOR_WORDS)]) {
      await expect(list, `the list shows the stored value ${stored}`).not.toContainText(stored);
    }
  });

  test("tells an Admin more about a source in sentences", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Greetland Castings",
      connectedSources: [indexed("Staff handbook")],
    });

    const handbook = connectedSourceNamed(page, "Staff handbook");
    await expect(handbook.getByRole("term").filter({ hasText: DESTINATIONS_TERM })).toHaveCount(0);
    await handbook.getByRole("button", { name: "More about Staff handbook" }).click();

    await expect(detailOf(page, "Staff handbook", "State")).toHaveText(STATE_MEANS.indexed);
    await expect(handbook.getByRole("term").filter({ hasText: /^Destination/ })).toHaveText([
      DESTINATIONS_TERM,
    ]);
    await expect(
      detailOf(page, "Staff handbook", DESTINATIONS_TERM).getByRole("paragraph"),
    ).toHaveText([destinationOf("passage-index").means, destinationOf("bundle").means]);
    await expect(detailOf(page, "Staff handbook", "Retention")).toHaveText(
      retentionOf("keep").means,
    );
  });

  test("tells an Admin why documents are unreadable, OCR when needed", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Holme Surveys",
      connectedSources: [
        indexed("Board minutes", {
          documents: [{ title: "Minutes 2019", unreadableReason: "DeadlineExceededError" }],
        }),
        indexed("Site archive", {
          documents: [
            { title: "Floor plan", unreadableReason: NEEDS_OCR },
            { title: "Site survey", unreadableReason: NEEDS_OCR },
            { title: "Archive", unreadableReason: "DeadlineExceededError" },
            { title: "Old minutes", unreadableReason: "UnicodeDecodeError" },
            { title: "Handover notes" },
          ],
        }),
      ],
    });

    await connectedSourceNamed(page, "Site archive")
      .getByRole("button", { name: "More about Site archive" })
      .click();
    const archive = detailOf(page, "Site archive", "Unreadable");
    await expect(archive.getByRole("paragraph")).toHaveText(unreadableCounted(4, 2));
    await expect(archive.getByRole("listitem")).toHaveText([
      `Archive: ${unreadableWordOf("DeadlineExceededError")}`,
      `Floor plan: ${unreadableWordOf(NEEDS_OCR)}`,
      `Old minutes: ${unreadableWordOf("UnicodeDecodeError")}`,
      `Site survey: ${unreadableWordOf(NEEDS_OCR)}`,
    ]);

    await connectedSourceNamed(page, "Board minutes")
      .getByRole("button", { name: "More about Board minutes" })
      .click();
    const minutes = detailOf(page, "Board minutes", "Unreadable");
    await expect(minutes.getByRole("paragraph")).toHaveText(unreadableCounted(1, 0));
    await expect(minutes, "OCR is named where no document needs it").not.toContainText("OCR");
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
        - status
        - status
        - button "Connect a document"
        - status
        - paragraph: ${NOTHING_CONNECTED}
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
    const dialog = page.getByRole("dialog", { name: "Connect a document" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(CONNECT_WORDS.consequence);
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toHaveAccessibleDescription(
      CONNECT_WORDS.audienceHint,
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
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.received);
    await expect(lastSyncedOf(page, "The staff handbook")).toContainText("Sync queued");
    await expect(sensitivityOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.indexing);
    await expect(lastSyncedOf(page, "The staff handbook")).toContainText("Syncing");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.indexed);
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

const BANK_ACCOUNT_BOX = REVIEW_WORDS.select({
  category: "bank-details",
  ruleId: "UK_BANK_ACCOUNT",
  title: "Supplier form",
});

const HOME_ADDRESS_BOX = REVIEW_WORDS.select({
  category: "home-address",
  ruleId: "UK_HOME_ADDRESS",
  title: "Supplier form",
});

const healthCueBoxIn = (title: string): string =>
  REVIEW_WORDS.select({ category: "special-category", ruleId: "HEALTH_CUE", title });

const HEALTH_CUE_BOX = healthCueBoxIn("Staff survey");

/** A note as a row reads it: its tag, then what the tag means here. */
const ALREADY_NARROWED = `${REVIEW_WORDS.alreadyNarrowed.tag} ${REVIEW_WORDS.alreadyNarrowed.says}`;

const A_DISMISSED_FINDING = `${REVIEW_WORDS.dismissed.tag} ${REVIEW_WORDS.dismissed.says(1)}`;

const theDismissalsSync = (status: keyof typeof SYNC_OF_A_DISMISSAL): string =>
  `The sync that reads the dismissal ${SYNC_OF_A_DISMISSAL[status]}.`;

/** A category over its tier, as one cell of the review's table reads them. */
const categoryCell = (category: string, tier: string): string =>
  quoted(`${sentenceCased(category)} ${sentenceCased(tier)}`);

/**
 * Two documents as a sync leaves them after a dismissal: one lifted to its connected source's sensitivity, one
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

/** A connected source's review wherever the page draws it, for saying none is drawn. */
const reviewNamed = (page: Page, name: string) =>
  page.getByRole("region", { name: REVIEW_WORDS.heading(name) });

/** Found inside its connected source's row, so a review drawn anywhere else is not found. */
const reviewOf = (page: Page, name: string) =>
  connectedSourceNamed(page, name).getByRole("region", { name: REVIEW_WORDS.heading(name) });

const WIDENING = (url: URL): boolean => url.pathname.includes("sources.widen");

const reviewHeading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 4, name: REVIEW_WORDS.heading(name) });

const findingRow = (page: Page, name: string, document: string, rule: string) =>
  reviewOf(page, name).getByRole("row").filter({ hasText: document }).filter({ hasText: rule });

test.describe("reviewing a connected source's findings", () => {
  test("shows an Admin findings by category and rule, counts only", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Colne Valley Metals",
      connectedSources: [SUPPLIER_FORMS],
    });

    await rowAction(page, "Supplier forms", "review").focus();
    await page.keyboard.press("r");
    await expect(reviewHeading(page, "Supplier forms")).toBeFocused();

    await expect(reviewOf(page, "Supplier forms").getByRole("table")).toMatchAriaSnapshot(`
      - table:
        - caption: 0 groups of findings selected. Select a group with x, then keep it in text, narrow its document or dismiss it as not special category with the actions above.
        - rowgroup:
          - row "Selected Category Rule Document Found Sensitivity":
            - columnheader "Selected"
            - columnheader "Category"
            - columnheader "Rule"
            - columnheader "Document"
            - columnheader "Found"
            - columnheader "Sensitivity"
        - rowgroup:
          - row:
            - cell:
              - checkbox ${quoted(BANK_ACCOUNT_BOX)} [checked=false]
            - cell ${categoryCell("bank-details", "always")}
            - cell ${quoted(ruleWordOf("UK_BANK_ACCOUNT"))}
            - cell "Supplier form"
            - cell "2"
            - cell "Internal"
          - row:
            - cell:
              - checkbox ${quoted(HOME_ADDRESS_BOX)} [checked=false]
            - cell ${categoryCell("home-address", "default-on")}
            - cell ${quoted(ruleWordOf("UK_HOME_ADDRESS"))}
            - cell "Supplier form"
            - cell "1"
            - cell "Internal"
          - row:
            - cell:
              - checkbox ${quoted(HEALTH_CUE_BOX)} [checked=false]
            - cell ${categoryCell("special-category", "always")}
            - cell ${quoted(ruleWordOf("HEALTH_CUE"))}
            - cell "Staff survey"
            - cell "1"
            - cell:
              - text: Restricted
              - paragraph: ${quoted(ALREADY_NARROWED)}
    `);
    for (const ruleId of ["UK_BANK_ACCOUNT", "UK_HOME_ADDRESS", "HEALTH_CUE"]) {
      await expect(
        reviewOf(page, "Supplier forms"),
        `the review shows the rule id ${ruleId}`,
      ).not.toContainText(ruleId);
    }
    await expect(page.locator("body")).not.toContainText(AN_ID);
  });

  test("shows an Admin an unmet rule as its id", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Brighouse Travel",
      connectedSources: [
        indexed("Visa files", {
          documents: [
            {
              title: "Passport scan",
              findings: [
                {
                  category: "government-identifier",
                  ruleId: "UK_PASSPORT",
                  tier: "always",
                  spans: 1,
                },
              ],
            },
          ],
        }),
      ],
    });
    await rowAction(page, "Visa files", "review").click();

    const row = findingRow(page, "Visa files", "Passport scan", "UK_PASSPORT");
    await expect(row.getByRole("cell", { name: "UK_PASSPORT", exact: true })).toBeVisible();
    await expect(row.getByRole("checkbox")).toHaveAccessibleName(
      REVIEW_WORDS.select({
        category: "government-identifier",
        ruleId: "UK_PASSPORT",
        title: "Passport scan",
      }),
    );
  });

  test("opens an Admin's review inside its source's row", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Shelf Coachworks",
      connectedSources: [SUPPLIER_FORMS],
    });
    const opener = rowAction(page, "Supplier forms", "review");
    await expect(opener).toHaveAttribute("aria-expanded", "false");

    await opener.click();

    await expect(reviewOf(page, "Supplier forms")).toBeVisible();
    await expect(reviewHeading(page, "Supplier forms")).toBeFocused();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
  });

  test("closes a review when its button is pressed again", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Southowram Stone",
      connectedSources: [SUPPLIER_FORMS],
    });
    const opener = rowAction(page, "Supplier forms", "review");
    await opener.click();
    await expect(reviewOf(page, "Supplier forms")).toBeVisible();

    await opener.focus();
    await page.keyboard.press("Enter");

    await expect(reviewNamed(page, "Supplier forms")).toHaveCount(0);
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener, "closing the review took focus off its button").toBeFocused();
  });

  test("closes one source's review as an Admin opens another's", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Northowram Dairy",
      connectedSources: [SUPPLIER_FORMS, SERVICE_RECORDS],
    });

    await rowAction(page, "Supplier forms", "review").click();
    await expect(reviewOf(page, "Supplier forms")).toBeVisible();
    await rowAction(page, "Service records", "review").click();

    await expect(reviewOf(page, "Service records")).toBeVisible();
    await expect(reviewHeading(page, "Service records")).toBeFocused();
    await expect(reviewNamed(page, "Supplier forms")).toHaveCount(0);
    await expect(rowAction(page, "Supplier forms", "review")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("tells an Admin what enables the review's three actions", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Stainland Fasteners",
      connectedSources: [SUPPLIER_FORMS],
    });
    await rowAction(page, "Supplier forms", "review").click();
    const review = reviewOf(page, "Supplier forms");

    const enabling = review.getByText(REVIEW_WORDS.selectFirst, { exact: true });
    await expect(enabling).toBeVisible();
    for (const label of [
      REVIEW_WORDS.keep.label,
      REVIEW_WORDS.narrowDocuments.label,
      REVIEW_WORDS.dismiss.label,
    ]) {
      const action = review.getByRole("button", { name: label, exact: true });
      await expect(action).toBeDisabled();
      await expect(action).toHaveAccessibleDescription(REVIEW_WORDS.selectFirst);
    }

    await review.getByRole("checkbox", { name: BANK_ACCOUNT_BOX }).click();
    await expect(enabling).toHaveCount(0);
    const keep = review.getByRole("button", { name: REVIEW_WORDS.keep.named(1), exact: true });
    await expect(keep).toBeEnabled();
    await expect(keep).toHaveAccessibleDescription("");
  });

  test("lets an Admin keep groups in text and narrow documents", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Hebden Plastics",
      connectedSources: [SUPPLIER_FORMS],
    });
    await rowAction(page, "Supplier forms", "review").click();

    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: REVIEW_WORDS.keep.label }),
    ).toBeDisabled();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", {
        name: REVIEW_WORDS.narrowDocuments.label,
      }),
    ).toBeDisabled();
    await expect(reviewHeading(page, "Supplier forms")).toBeFocused();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeFocused();
    await page.keyboard.press("x");
    await expect(page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeChecked();

    await page.keyboard.press("k");
    const keeping = page.getByRole("dialog", { name: REVIEW_WORDS.keep.named(1) });
    await expect(keeping.getByRole("listitem")).toContainText(ruleWordOf("UK_BANK_ACCOUNT"));
    await expect(keeping.getByRole("listitem")).toContainText("Supplier form: 2 found");
    await expect(keeping.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("The company's own bank details, printed on every invoice");
    await page.keyboard.press("Enter");

    await expect(page.getByText(REVIEW_WORDS.keep.done(1, 2))).toBeVisible();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: REVIEW_WORDS.keep.label }),
    ).toBeDisabled();

    await page.getByRole("checkbox", { name: HOME_ADDRESS_BOX }).focus();
    await page.keyboard.press("x");
    await page.keyboard.press("d");
    const narrowing = page.getByRole("dialog", { name: "Narrow 1 document to Restricted" });
    await expect(narrowing.getByRole("listitem")).toHaveText(["Supplier form"]);
    await narrowing.getByRole("button", { name: "Narrow 1 document to Restricted" }).focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByText(
        "Narrowed 1 document to Restricted; 0 concepts and 0 write-ups moved with them.",
      ),
    ).toBeVisible();
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", ruleWordOf("UK_HOME_ADDRESS")),
    ).toContainText("Restricted");
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", ruleWordOf("UK_BANK_ACCOUNT")),
    ).toContainText("Restricted");
    await expect(page.locator("body")).not.toContainText(AN_ID);
  });

  test("dismisses a special category group, row and sync saying so", async ({ page, request }) => {
    const { workspace } = await anAdminAtSources(page, request, {
      workspace: "Ripponden Pumps",
      connectedSources: [SUPPLIER_FORMS],
    });
    await rowAction(page, "Supplier forms", "review").click();
    const review = reviewOf(page, "Supplier forms");
    const dismissal = review.getByRole("button", { name: /^Dismiss .*as not special category$/ });
    await expect(dismissal).toBeDisabled();

    await page.keyboard.press("Tab");
    await page.keyboard.press("x");
    await expect(review.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeChecked();
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
    await expect(dismissal).toHaveAccessibleName(REVIEW_WORDS.dismiss.named(1));
    await expect(dismissal).toBeEnabled();

    await page.keyboard.press("s");
    const dismissing = page.getByRole("dialog", { name: REVIEW_WORDS.dismiss.named(1) });
    await expect(dismissing.getByRole("listitem")).toContainText(ruleWordOf("HEALTH_CUE"));
    await expect(dismissing.getByRole("listitem")).toContainText("Staff survey: 1 found");
    await expect(dismissing.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("A survey of the pumps our engineers diagnose, not of people");
    await clockTheNextKey(page, {
      at: `//tr[td[.='${ruleWordOf("HEALTH_CUE")}']][td[.='Staff survey']]`,
      reads: REVIEW_WORDS.dismissed.tag,
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "dismissal");

    await expect(review).toContainText(
      `Dismissed 1 group of findings as not special category in 1 document. ${theDismissalsSync("queued")}`,
    );
    await expect(healthCue, "focus did not come back to the row the action left").toBeFocused();
    const row = findingRow(page, "Supplier forms", "Staff survey", ruleWordOf("HEALTH_CUE"));
    await expect(row).toContainText(A_DISMISSED_FINDING);
    await expect(row).not.toContainText(REVIEW_WORDS.alreadyNarrowed.tag);
    await expect(lastSyncedOf(page, "Supplier forms")).toContainText("Sync queued");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(review).toContainText(theDismissalsSync("claimed"));
    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(review).toContainText(theDismissalsSync("done"));
    await expect(page.locator("body")).not.toContainText(AN_ID);

    await page.reload();
    await rowAction(page, "Supplier forms", "review").click();
    await expect(
      findingRow(page, "Supplier forms", "Staff survey", ruleWordOf("HEALTH_CUE")),
      "the dismissal did not outlive the page that made it",
    ).toContainText(A_DISMISSED_FINDING);
  });

  test("shows an Admin which dismissed documents are still narrowed", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Sowerby Hydraulics",
      connectedSources: [SERVICE_RECORDS],
    });
    await rowAction(page, "Service records", "review").click();

    await expect(reviewOf(page, "Service records").getByRole("rowgroup").last())
      .toMatchAriaSnapshot(`
      - rowgroup:
        - row:
          - cell:
            - checkbox ${quoted(healthCueBoxIn("Absence log"))} [checked=false]
          - cell ${categoryCell("special-category", "always")}
          - cell ${quoted(ruleWordOf("HEALTH_CUE"))}
          - cell "Absence log"
          - cell "2"
          - cell:
            - text: Restricted
            - paragraph: ${quoted(ALREADY_NARROWED)}
            - paragraph: ${quoted(A_DISMISSED_FINDING)}
        - row:
          - cell:
            - checkbox ${quoted(healthCueBoxIn("Pump service notes"))} [checked=false]
          - cell ${categoryCell("special-category", "always")}
          - cell ${quoted(ruleWordOf("HEALTH_CUE"))}
          - cell "Pump service notes"
          - cell "1"
          - cell:
            - text: Internal
            - paragraph: ${quoted(A_DISMISSED_FINDING)}
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
    await rowAction(page, "Payroll exports", "review").click();

    const row = findingRow(page, "Payroll exports", "March payroll", ruleWordOf("UK_BANK_ACCOUNT"));
    await expect(row).toContainText(REVIEW_WORDS.keptStillWithheld.tag);
    await expect(row).toContainText(REVIEW_WORDS.keptStillWithheld.says(2));
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
    await rowAction(page, "Staff handbook", "review").click();
    await page
      .getByRole("button", { name: "Preview the passages a reader would see once published" })
      .click();

    await expect(reviewOf(page, "Staff handbook").getByRole("listitem")).toHaveText([
      "The handbook says what the company decided.",
      "Pay goes to [withheld].",
    ]);
  });

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
        name: REVIEW_WORDS.dismiss.named(1),
      }),
    ).toBeEnabled();
    await rowAction(page, "Supplier forms", "widen").click();
    await expect(
      commitOf(page, "Supplier forms", "widen", { sensitivity: "Public", audience: "everyone" }),
    ).toBeVisible();

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
        - term: Sensitivity
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
        - definition: The hash of this connected source’s DPIA input, taken at the click
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
      reads: STATE_WORDS.published,
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "publish");

    await expect(
      page.getByText(
        "Published “Staff handbook”: its passages reach everyone in the workspace now",
      ),
    ).toBeVisible();
    await expect(stateOf(page, "Staff handbook")).toHaveText(STATE_WORDS.published);
    await expect(rowAction(page, "Staff handbook", "publish")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Staff handbook" })).toBeFocused();
  });

  test("narrows a published source inline, its citing concepts moving too", async ({
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

    await rowAction(page, "Supplier payments", "narrow").focus();
    await page.keyboard.press("n");
    const panel = panelOf(page, "Supplier payments", "narrow");
    await expect(panel).toHaveAccessibleDescription(SENSITIVITY_PANEL_WORDS.narrow.consequence());
    const sensitivityPicked = panel.getByRole("combobox", { name: "Sensitivity" });
    await expect(sensitivityPicked).toBeFocused();
    await expect(sensitivityPicked).toHaveText("Restricted");
    await expect(panel.getByRole("combobox")).toHaveCount(1);
    await expect(panel.getByRole("term")).toHaveText(["Sensitivity"]);
    await expect(panel.getByRole("definition")).toHaveText([/Internal.+Restricted/]);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await commitOf(page, "Supplier payments", "narrow", {
      sensitivity: "Restricted",
      audience: "everyone",
    }).focus();
    await page.keyboard.press("Enter");

    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Supplier payments" })).toBeFocused();
    await expect(sensitivityOf(page, "Supplier payments")).toHaveText("Restricted");
    await expect(
      page.getByText(
        "Narrowed “Supplier payments” to Restricted. 1 concept and 1 write-up moved with it.",
      ),
    ).toBeVisible();
    await expect(page.getByText(citedBy?.iri ?? "")).toBeVisible();
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
    expect(citedBy, "the harness seeded no citing concept").toBeDefined();

    await rowAction(page, "Tender answers", "widen").focus();
    await page.keyboard.press("w");
    const panel = panelOf(page, "Tender answers", "widen");
    await expect(panel).toHaveAccessibleDescription(
      SENSITIVITY_PANEL_WORDS.widen.consequence(true),
    );
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
    const commit = panel.getByRole("button", { name: /^Widen Tender answers to / });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAccessibleDescription(
      sentenceOf(SAID_OF_A_CONNECTED_SOURCE["not-wider"]),
    );
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
    await expect(
      commitOf(page, "Tender answers", "widen", { sensitivity: "Internal", audience: "everyone" }),
    ).toBeFocused();

    await clockTheNextKey(page, {
      at: "(//li[.//h3[.='Tender answers']]//dt[.='Sensitivity'])[1]/following-sibling::dd[1]",
      reads: "Internal",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "widen");

    await expect(saidIn(page)).toContainText(
      "Widened “Tender answers” to Internal for everyone in the workspace. 1 concept and 1 write-up moved with it.",
    );
    await expect(page.getByText(citedBy?.iri ?? "")).toBeVisible();
    await expect(sensitivityOf(page, "Tender answers")).toHaveText("Internal");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Tender answers" })).toBeFocused();
  });

  test("lists the audience among the changes once it widens too", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Cragg Vale Textiles",
      connectedSources: [
        indexed("Staff handbook", { sensitivity: "Restricted", audience: "groups" }),
      ],
    });

    await rowAction(page, "Staff handbook", "widen").click();
    const panel = panelOf(page, "Staff handbook", "widen");
    await expect(panel).toHaveAccessibleDescription(
      SENSITIVITY_PANEL_WORDS.widen.consequence(false),
    );
    await expect(panel.getByRole("combobox", { name: "Sensitivity" })).toBeFocused();
    await expect(panel.getByRole("combobox", { name: "Sensitivity" })).toHaveText("Internal");
    await expect(panel.getByRole("term")).toHaveText(["Sensitivity"]);
    await expect(panel.getByRole("definition")).toHaveText([/Restricted.+Internal/]);
    await expect(
      commitOf(page, "Staff handbook", "widen", { sensitivity: "Internal", audience: "groups" }),
    ).toBeVisible();

    await panel.getByRole("combobox", { name: "Audience" }).press("Enter");
    await page.getByRole("option", { name: AUDIENCE_WORDS.everyone }).press("Enter");
    await expect(panel.getByRole("term")).toHaveText(["Sensitivity", "Audience"]);
    await expect(panel.getByRole("definition")).toHaveText([
      /Restricted.+Internal/,
      new RegExp(`${AUDIENCE_WORDS.groups}.+${AUDIENCE_WORDS.everyone}`, "i"),
    ]);
    const widened = { sensitivity: "Internal", audience: "everyone" } as const;
    await commitOf(page, "Staff handbook", "widen", widened).click();

    await expect(saidIn(page)).toContainText(sensitivityAndAudienceWords(widened));
    await expect(sensitivityOf(page, "Staff handbook")).toHaveText("Internal");
    await expect(leadOf(page, "Staff handbook", "Audience")).toHaveText(AUDIENCE_WORDS.everyone);
  });

  test("cancels a widening, focus back on what opened it", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Midgley Ropes",
      connectedSources: [indexed("Staff handbook", { sensitivity: "Restricted" })],
    });

    const opener = rowAction(page, "Staff handbook", "widen");
    await opener.click();
    const panel = panelOf(page, "Staff handbook", "widen");
    await expect(panel.getByRole("combobox", { name: "Sensitivity" })).toBeFocused();
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toHaveCount(0);
    await expect(opener, "Cancel did not hand focus back to the button").toBeFocused();

    const moreAbout = connectedSourceNamed(page, "Staff handbook").getByRole("button", {
      name: "More about Staff handbook",
    });
    await moreAbout.focus();
    await page.keyboard.press("w");
    await expect(panel.getByRole("combobox", { name: "Sensitivity" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel).toHaveCount(0);
    await expect(moreAbout, "Cancel did not hand focus back to where w was pressed").toBeFocused();
    await expect(sensitivityOf(page, "Staff handbook")).toHaveText("Restricted");
  });

  test("holds a second widening while the first is still pending", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Heptonstall Slate",
      connectedSources: [indexed("Bid library"), indexed("Case studies")],
    });
    const toPublic = { sensitivity: "Public", audience: "everyone" } as const;

    // The first widening reaches the api and its answer is held, so the second press meets it pending.
    const reached = Promise.withResolvers<void>();
    const answered = Promise.withResolvers<void>();
    let asked = 0;
    await page.route(WIDENING, async (route) => {
      asked += 1;
      const first = asked === 1;
      const response = await route.fetch();
      if (first) {
        reached.resolve();
        await answered.promise;
      }
      await route.fulfill({ response });
    });

    await rowAction(page, "Bid library", "widen").click();
    await commitOf(page, "Bid library", "widen", toPublic).click();
    await reached.promise;
    await expect(sensitivityOf(page, "Bid library")).toHaveText("Public");

    await rowAction(page, "Case studies", "widen").click();
    const second = commitOf(page, "Case studies", "widen", toPublic);
    await expect(second).toHaveAttribute("aria-disabled", "true");
    await expect(second).toHaveAccessibleDescription(THE_CHANGE_BEFORE_IS_STILL_GOING);
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(panelOf(page, "Case studies", "widen")).toBeVisible();
    await expect(sensitivityOf(page, "Case studies")).toHaveText("Internal");
    answered.resolve();

    await expect(saidIn(page)).toContainText(
      `“Bid library” to ${sensitivityAndAudienceWords(toPublic)}`,
    );
    await expect(second).toHaveAttribute("aria-disabled", "false");
    expect(asked, "the second press asked the api while the first was pending").toBe(1);
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

    await rowAction(page, "Price book", "widen").focus();
    await page.keyboard.press("w");
    const panel = panelOf(page, "Price book", "widen");
    await expect(panel.getByRole("combobox", { name: "Audience" })).toHaveText(
      AUDIENCE_WORDS.everyone,
    );
    await expect(panel.getByRole("term"), "a term that stays is listed as a change").toHaveText([
      "Audience",
    ]);
    await passesTheAccessibilityGate();

    await commitOf(page, "Price book", "widen", {
      sensitivity: "Public",
      audience: "everyone",
    }).press("Enter");

    // The row reads widened before the api answers, and a late answer overwrites the next
    // `w`'s sentence.
    await expect(saidIn(page)).toHaveText(
      "Widened “Price book” to Public for everyone in the workspace. 0 concepts and 0 write-ups moved with it.",
    );
    await expect(audienceOf).toHaveText("Everyone in the workspace");
    await expect(rowAction(page, "Price book", "widen")).toHaveCount(0);
    await rowAction(page, "Price book", "review").focus();
    await page.keyboard.press("w");
    await expect(saidIn(page)).toHaveText(
      "“Price book” is Public for everyone in the workspace, and no sensitivity or audience is wider.",
    );
  });

  test("refuses widening with a special category finding unreviewed", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Mytholmroyd Pumps",
      connectedSources: [{ ...SERVICE_RECORDS, sensitivity: "Restricted", published: true }],
    });

    await rowAction(page, "Service records", "widen").click();
    await commitOf(page, "Service records", "widen", {
      sensitivity: "Internal",
      audience: "everyone",
    }).click();

    await expect(connectedSourcesRegion(page).getByRole("alert")).toHaveText(
      sentenceOf(SAID_OF_A_CONNECTED_SOURCE["special-category-unreviewed"]),
    );
    await expect(sensitivityOf(page, "Service records")).toHaveText("Restricted");
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
        - definition: Select or clear the group of findings in focus
        - term: k
        - definition: Keep the selected groups of findings in text
        - term: d
        - definition: Narrow the documents the selected groups of findings sit in
        - term: s
        - definition: Dismiss the selected groups of findings as not special category
        - term: "?"
        - definition: ${JSON.stringify(KEYSTROKE_WORDS.showTheList)}
        - term: /⌘K|Ctrl K/
        - definition: ${JSON.stringify(JUMP_TO.name)}
    `);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    // The rail's: the toolbar keeps the page's own actions alone.
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

test("tells a spec why the harness refused its seed", async ({ page, request }) => {
  const email = anAddress("admin");
  const workspace = await provision(request, { name: "Aire Scanning", adminEmail: email });

  await expect(
    seedConnectedSources(request, {
      workspaceId: workspace.workspaceId,
      connectedSources: [
        indexed("Scans", {
          documents: [{ title: "Floor plan", unreadableReason: "No text layer" }],
        }),
      ],
    }),
    "the refused seed's failure names no field or rule",
  ).rejects.toThrow(/answered 400.*unreadableReason.*no space/s);

  await page.goto("/sign-in");
  await signIn(page, request, email);
  await nav(page).getByRole("link", { name: CONNECTED_SOURCES.name }).click();
  await expect(connectedSourcesRegion(page).getByText(NOTHING_CONNECTED)).toBeVisible();
});
