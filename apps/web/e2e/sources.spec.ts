import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { RAIL } from "@/app/words.ts";
import {
  AUDIENCE_WORDS,
  CONNECTOR_WORDS,
  DESTINATIONS_TERM,
  NEEDS_OCR,
  REVIEW_WORDS,
  ROW_ACTIONS,
  ruleWordOf,
  SENSITIVITY_PANEL_WORDS,
  type SensitivityAndAudience,
  sentenceCased,
  STATE_WORDS,
} from "@/features/sources/words.ts";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  keepsItsWordOffThePage,
  keystrokesDismissed,
  moveTheSync,
  notFoundOfferingHome,
  person,
  provision,
  quoted,
  saysARefusal,
  saysOfItsRead,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
} from "./harness.ts";
import { heldBack } from "./knowledge.ts";
import { refusalAnswering } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

/** Any id the platform mints: the page shows none, a finding's least of all. */
const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const CONNECTED_SOURCES = pageNamed(menuGroupIn(CONTROL_CENTRE, "sources"), "Connected sources");

const nav = (page: Page) => page.getByRole("navigation", { name: CONTROL_CENTRE.name });

const connectedSourcesRegion = (page: Page) =>
  page.getByRole("region", { name: "Connected sources" });

/** The region's outcome line: its count and the connect action's progress are statuses before it. */
const saidIn = (page: Page): Locator => connectedSourcesRegion(page).getByRole("status").last();

/** What a region says now, as `toHaveText` reads it, for telling a later state from this one. */
const saidNowIn = async (region: Locator): Promise<string> => (await region.textContent()) ?? "";

/** A sync not yet finished is said in words before its time; a finished one is its time alone. */
const A_SYNC_UNDER_WAY = /^\D+\d{2}:\d{2}/;

const isTheList = (url: URL): boolean => url.pathname.includes("sources.list");

/**
 * The empty list's line draws as the loading line does, so it must say something else than it
 * said while the list's read was held.
 */
const listsNothingConnected = async (page: Page, open: () => Promise<unknown>): Promise<void> => {
  const list = await heldBack(page, isTheList);
  await open();
  await list.reached;
  const region = connectedSourcesRegion(page);
  await saysOfItsRead(region);
  const whileLoading = await saidNowIn(region.locator('[aria-live="polite"]'));
  list.release();
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

const commitOf = (
  page: Page,
  name: string,
  change: SensitivityChange,
  asked: SensitivityAndAudience,
): Locator =>
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
    await expect(
      lastSyncedOf(page, "Safety records"),
      "a connected source never synced shows a time",
    ).toHaveText(/^\D+$/);
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
        - definition: ${quoted(AUDIENCE_WORDS.everyone)}
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

    // A stored value is one word, and what More about says of it is several.
    const aSentence = /\S\s+\S/;
    await expect(detailOf(page, "Staff handbook", "State")).toHaveText(aSentence);
    await expect(handbook.getByRole("term").filter({ hasText: /^Destination/ })).toHaveText([
      DESTINATIONS_TERM,
    ]);
    await expect(
      detailOf(page, "Staff handbook", DESTINATIONS_TERM).getByRole("paragraph"),
      "each of the two destinations it feeds does not have a sentence of its own",
    ).toHaveText([aSentence, aSentence]);
    await expect(detailOf(page, "Staff handbook", "Retention")).toHaveText(aSentence);
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
    // Four unreadable, two of them scans.
    await expect(archive.getByRole("paragraph")).toHaveText(/^\D*\b4\b\D+\b2\b\D*$/);
    const titles = ["Archive", "Floor plan", "Old minutes", "Site survey"];
    const unreadable = archive.getByRole("listitem");
    await expect(unreadable).toHaveText(titles.map((title) => new RegExp(`^${title}\\W+\\w`)));
    const lines = await unreadable.allInnerTexts();
    const [timedOut, aScan, undecoded, anotherScan] = titles.map((title, at) =>
      lines[at]?.replace(title, ""),
    );
    expect(aScan, "two scans are given different reasons").toBe(anotherScan);
    expect(
      new Set([timedOut, aScan, undecoded]).size,
      "two different faults are given one reason",
    ).toBe(3);
    for (const stored of [NEEDS_OCR, "DeadlineExceededError", "UnicodeDecodeError"]) {
      await expect(archive, `a reason is shown as the stored ${stored}`).not.toContainText(stored);
    }

    await connectedSourceNamed(page, "Board minutes")
      .getByRole("button", { name: "More about Board minutes" })
      .click();
    const minutes = detailOf(page, "Board minutes", "Unreadable");
    await expect(
      minutes.getByRole("paragraph"),
      "scans are counted where no document is one",
    ).toHaveText(/^\D*\b1\b\D*$/);
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
    await listsNothingConnected(page, () => page.goto("/sources/connected-sources"));
    await expect(connectedSourcesRegion(page)).toMatchAriaSnapshot(`
      - region "Connected sources":
        - /children: equal
        - heading "Connected sources" [level=2]
        - status
        - status
        - button "Connect a document"
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
    const dialog = page.getByRole("dialog", { name: "Connect a document" });
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

    // The connect action's own outcome: no other status names what was connected.
    await expect(
      connectedSourcesRegion(page).getByRole("status").filter({ hasText: "The staff handbook" }),
    ).toContainText("handbook.md");
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.received);
    const lastSynced = lastSyncedOf(page, "The staff handbook");
    await expect(lastSynced).toHaveText(A_SYNC_UNDER_WAY);
    const whileQueued = await saidNowIn(lastSynced);
    await expect(sensitivityOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.indexing);
    await expect(lastSynced, "a sync that started is said as it was while queued").not.toHaveText(
      whileQueued,
    );
    await expect(lastSynced).toHaveText(A_SYNC_UNDER_WAY);

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText(STATE_WORDS.indexed);
    await expect(lastSyncedOf(page, "The staff handbook")).toHaveText(/^\d{2}:\d{2} · /);
  });

  test("refuses an Admin's unconvertible file, keeping the dialog open", async ({
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

    await saysARefusal(dialog.getByRole("alert"));
    await keepsItsWordOffThePage(page, "media-type-refused");
    await expect(dialog).toBeVisible();
  });

  test("says in the dialog that the api refused an upload", async ({ page, request }) => {
    await anAdminAtSources(page, request, { workspace: "Ryburn Stores" });
    // The page lets a markdown file through, so the kind is changed on its way to the api.
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
    const dialog = page.getByRole("dialog", { name: "Connect a document" });
    await dialog.getByLabel("Name").fill("Shop notes");
    await dialog.getByLabel("File").setInputFiles({
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("The shop opens at eight.\n"),
    });
    const refused = refusalAnswering(page, "sources.connect");
    await dialog.getByRole("button", { name: "Connect the document" }).click();

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

/** A note that a document is narrowed counts nothing; one of findings dismissed or kept does. */
const aNoteOf = (findings: number): RegExp => new RegExp(String.raw`\b${String(findings)}\b`);

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

/** A finding's notes, each a line of its own under the document's sensitivity. */
const notesOf = (page: Page, name: string, document: string, rule: string) =>
  findingRow(page, name, document, rule).getByRole("paragraph");

/** The outcomes the review's actions have said, in the actions' order: keep, narrow, dismiss. */
const outcomesOf = (page: Page, name: string) =>
  reviewOf(page, name).getByRole("status").filter({ hasText: /\S/ });

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
        - caption: /^0\\b/
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
            - cell /^Restricted/:
              - paragraph: /^\\D+$/
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

    // One line on the page describes all three while nothing is ticked.
    const describedBy =
      (await review
        .getByRole("button", { name: REVIEW_WORDS.keep.label, exact: true })
        .getAttribute("aria-describedby")) ?? "";
    const enabling = review.locator(`[id="${describedBy}"]`);
    await expect(enabling).toBeVisible();
    for (const label of [
      REVIEW_WORDS.keep.label,
      REVIEW_WORDS.narrowDocuments.label,
      REVIEW_WORDS.dismiss.label,
    ]) {
      const action = review.getByRole("button", { name: label, exact: true });
      await expect(action).toBeDisabled();
      await expect(action).toHaveAccessibleDescription(/\S/);
      await expect(action).toHaveAttribute("aria-describedby", describedBy);
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
    await expect(keeping.getByRole("listitem")).toHaveText(/Supplier form\D+2\b/);
    await expect(keeping.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("The company's own bank details, printed on every invoice");
    await page.keyboard.press("Enter");

    // One group kept, its two findings restored: the line while it is pending counts no finding.
    const kept = /\b1\b\D+\b2\b/;
    await expect(outcomesOf(page, "Supplier forms")).toHaveText([kept]);
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

    // One document narrowed, and no concept or write-up moved with it.
    await expect(outcomesOf(page, "Supplier forms")).toHaveText([
      kept,
      /\b1\b\D+Restricted\D+\b0\b\D+\b0\b/,
    ]);
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
    const notes = notesOf(page, "Supplier forms", "Staff survey", ruleWordOf("HEALTH_CUE"));
    await expect(notes, "the survey is not noted as narrowed, and no more").toHaveText([/^\D+$/]);

    await page.keyboard.press("Tab");
    await page.keyboard.press("x");
    await expect(review.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeChecked();
    await expect(dismissal).toBeDisabled();
    await expect(dismissal).toHaveAccessibleDescription(/\S/);
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
    await expect(dismissing.getByRole("listitem")).toHaveText(/Staff survey\D+1\b/);
    await expect(dismissing.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("A survey of the pumps our engineers diagnose, not of people");
    await clockTheNextKey(page, {
      at: `//tr[td[.='${ruleWordOf("HEALTH_CUE")}']][td[.='Staff survey']]//p[contains(., '1')]`,
      reads: "1",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "dismissal");

    // One group dismissed, in one document: the line while it is pending counts no document.
    const dismissed = outcomesOf(page, "Supplier forms");
    await expect(dismissed).toHaveText([/\b1\b\D+\b1\b/]);
    const whileQueued = await saidNowIn(dismissed);
    await expect(healthCue, "focus did not come back to the row the action left").toBeFocused();
    await expect(notes, "the survey is not noted as one finding dismissed, and no more").toHaveText(
      [aNoteOf(1)],
    );
    await expect(lastSyncedOf(page, "Supplier forms")).toHaveText(A_SYNC_UNDER_WAY);

    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(dismissed, "the line did not follow its sync as it ran").not.toHaveText(
      whileQueued,
    );
    const whileRunning = await saidNowIn(dismissed);
    await moveTheSync(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(dismissed, "the line did not follow its sync to its end").not.toHaveText(
      whileRunning,
    );
    expect(await saidNowIn(dismissed), "a finished sync is said as a queued one").not.toBe(
      whileQueued,
    );
    await expect(page.locator("body")).not.toContainText(AN_ID);

    await page.reload();
    await rowAction(page, "Supplier forms", "review").click();
    await expect(
      notesOf(page, "Supplier forms", "Staff survey", ruleWordOf("HEALTH_CUE")),
      "the dismissal did not outlive the page that made it",
    ).toHaveText([aNoteOf(1)]);
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
          - cell /^Restricted/:
            - paragraph: /^\\D+$/
            - paragraph: /\\b1\\b/
        - row:
          - cell:
            - checkbox ${quoted(healthCueBoxIn("Pump service notes"))} [checked=false]
          - cell ${categoryCell("special-category", "always")}
          - cell ${quoted(ruleWordOf("HEALTH_CUE"))}
          - cell "Pump service notes"
          - cell "1"
          - cell /^Internal/:
            - paragraph: /\\b1\\b/
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

    await expect(
      notesOf(page, "Payroll exports", "March payroll", ruleWordOf("UK_BANK_ACCOUNT")),
      "the group is not noted as two kept findings still withheld, and no more",
    ).toHaveText([aNoteOf(2)]);
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
    const commit = dialog.getByRole("button", { name: "Publish Staff handbook" });
    await expect(commit).toBeDisabled();
    await expect(commit).toHaveAccessibleDescription(/\S/);

    const carried = dialog.getByRole("region", { name: "What the audit row will carry" });
    await expect(carried).toMatchAriaSnapshot(`
      - region "What the audit row will carry":
        - heading "What the audit row will carry" [level=3]
        - term: Action
        - definition
        - term: Connected source
        - definition: Staff handbook
        - term: By
        - definition
        - term: Sensitivity
        - definition: Internal
        - term: Audience
        - definition: ${quoted(AUDIENCE_WORDS.everyone)}
        - term: Lawful basis recorded
        - definition
        - term: Privacy information updated
        - definition
        - term: DPIA reference recorded
        - definition
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
        - definition
    `);

    // What the row carries of a confirmation not yet made, which a tick must change.
    const waiting = carried.getByRole("definition").filter({
      hasText: await saidNowIn(
        carried
          .getByRole("term")
          .filter({ hasText: "Lawful basis recorded" })
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
      reads: STATE_WORDS.published,
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "publish");

    await expect(saidIn(page)).toContainText("Staff handbook");
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
    await expect(panel).toHaveAccessibleDescription(/\S/);
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
    // One concept and one write-up moved with it.
    await expect(saidIn(page)).toHaveText(/Supplier payments\D+Restricted\D+\b1\b\D+\b1\b/);
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
    const commit = panel.getByRole("button", { name: /^Widen Tender answers to / });
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
    await expect(
      commitOf(page, "Tender answers", "widen", { sensitivity: "Internal", audience: "everyone" }),
    ).toBeFocused();

    await clockTheNextKey(page, {
      at: "(//li[.//h3[.='Tender answers']]//dt[.='Sensitivity'])[1]/following-sibling::dd[1]",
      reads: "Internal",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "widen");

    // One concept and one write-up moved with it.
    await expect(saidIn(page)).toHaveText(/Tender answers\D+Internal\D+\b1\b\D+\b1\b/);
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
    await expect(panel).toHaveAccessibleDescription(/\S/);
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

    await expect(saidIn(page)).toHaveText(/Staff handbook\D+Internal/);
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
    await expect(second).toHaveAccessibleDescription(/\S/);
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(panelOf(page, "Case studies", "widen")).toBeVisible();
    await expect(sensitivityOf(page, "Case studies")).toHaveText("Internal");
    answered.resolve();

    await expect(saidIn(page)).toHaveText(/Bid library\D+Public/);
    await expect(second).toHaveAttribute("aria-disabled", "false");
    await expect(second).toHaveAccessibleDescription("");
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
    await expect(audienceOf).toHaveText(new RegExp(`^${AUDIENCE_WORDS.groups}\\D+1\\b`));

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

    // The row reads widened before the api answers, and a late answer overwrites what the next
    // `w` says. The answer's counts tell it has landed.
    await expect(saidIn(page)).toHaveText(/Price book\D+Public\D+\b0\b\D+\b0\b/);
    const whenWidened = await saidNowIn(saidIn(page));
    await expect(audienceOf).toHaveText(AUDIENCE_WORDS.everyone);
    await expect(rowAction(page, "Price book", "widen")).toHaveCount(0);
    await rowAction(page, "Price book", "review").focus();
    await page.keyboard.press("w");
    await expect(
      saidIn(page),
      "nothing new is said of a widening with nothing wider",
    ).not.toHaveText(whenWidened);
    await expect(saidIn(page)).toHaveText(/^\D*Price book\D+Public\D*$/);
    await expect(panel).toHaveCount(0);
  });

  test("refuses widening with a special category finding unreviewed", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Mytholmroyd Pumps",
      connectedSources: [{ ...SERVICE_RECORDS, sensitivity: "Restricted", published: true }],
    });

    await rowAction(page, "Service records", "widen").click();
    const refused = refusalAnswering(page, "sources.widen");
    await commitOf(page, "Service records", "widen", {
      sensitivity: "Internal",
      audience: "everyone",
    }).click();

    expect(await refused).toMatchObject({ word: "special-category-unreviewed" });
    await saysARefusal(connectedSourcesRegion(page).getByRole("alert"));
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
        - paragraph
        - checkbox ${JSON.stringify(KEYSTROKE_WORDS.turnedOn)} [checked]
        - term: b
        - definition
        - term: r
        - definition
        - term: p
        - definition
        - term: "n"
        - definition
        - term: w
        - definition
        - term: x
        - definition
        - term: k
        - definition
        - term: d
        - definition
        - term: s
        - definition
        - term: "?"
        - definition
        - term: /⌘K|Ctrl K/
        - definition
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
  await listsNothingConnected(page, () =>
    nav(page).getByRole("link", { name: CONNECTED_SOURCES.name }).click(),
  );
});
