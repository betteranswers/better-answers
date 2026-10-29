import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page, Response } from "@playwright/test";

import { NEEDS_OCR, SELECT_A_CONNECTED_SOURCE_FIRST } from "@/features/sources/words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  keepsItsWordOffThePage,
  keystrokesButton,
  keystrokesDismissed,
  moveTheSync,
  notFoundOfferingHome,
  person,
  provision,
  saysARefusal,
  saysOfItsRead,
  type SeedConnectedSource,
  seedConnectedSources,
  signIn,
  skipLinkReachesThePage,
  theActionLandedWithinItsBudget,
  holdingTheFirstAnswer,
} from "../harness.ts";
import { heldBack } from "../knowledge.ts";
import { refusalAnswering } from "../refused-read.ts";

const LIST_BUDGET_MS = 1000;

const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const CONNECTED_SOURCES = pageNamed(menuGroupIn(CONTROL_CENTRE, "sources"), "Connected Sources");

const nav = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const EVERYONE = "Everyone in the workspace";

const NAMED_GROUPS = "Named groups";

const DESTINATIONS_TERM = "Destinations";

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

const detailOf = (page: Page, name: string, term: string): Locator =>
  connectedSourceNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .last()
    .locator("xpath=following-sibling::dd[1]");

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

  test("reads an Admin a row's stored values as words", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Elland Brassworks",
      connectedSources: [indexed("Staff handbook")],
    });

    const handbook = connectedSourceNamed(page, "Staff handbook");
    await expect(handbook).toMatchAriaSnapshot(`
      - listitem:
        - heading "Staff handbook" [level=3]
        - button "Review Findings Staff handbook" [expanded=false]
        - button "Publish Staff handbook"
        - button "Narrow Sensitivity Staff handbook"
        - button "Widen Sensitivity or Audience Staff handbook"
        - term: Connector
        - definition: Upload
        - term: Sensitivity
        - definition: Internal
        - term: Audience
        - definition: ${EVERYONE}
        - term: State
        - definition: Indexed
        - term: Last Synced
        - definition: /^\\d{2}:\\d{2} · \\d{1,2} \\w+ \\d{4}/
        - button "More Details Staff handbook" [expanded=false]
    `);
    const list = connectedSourcesRegion(page).getByRole("list");
    for (const stored of ["received", "indexing", "indexed", "published", "upload"]) {
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
    await handbook.getByRole("button", { name: "More Details Staff handbook" }).click();

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

  test("tells an Admin why documents are unreadable, scans counted apart", async ({
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
      .getByRole("button", { name: "More Details Site archive" })
      .click();
    const archive = detailOf(page, "Site archive", "Unreadable");
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
      .getByRole("button", { name: "More Details Board minutes" })
      .click();
    const minutes = detailOf(page, "Board minutes", "Unreadable");
    await expect(
      minutes.getByRole("paragraph"),
      "scans are counted where no document is one",
    ).toHaveText(/^\D*\b1\b\D*$/);
  });

  test("shows an Editor Connected Sources as not found, connecting nothing", async ({
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
    await page.goto(CONNECTED_SOURCES.path);

    await notFoundOfferingHome(page, "Editor");
    await expect(connectedSourcesRegion(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Staff handbook");

    await page.keyboard.press("b");
    await expect(page.getByRole("dialog", { name: "Connect a Document" })).toHaveCount(0);
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

  test("refuses an Admin's unconvertible file, keeping the dialog open", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, { workspace: "Ryburn Signs" });

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Connect a Document" });
    await dialog.getByLabel("Name").fill("Shop photographs");
    await dialog.getByLabel("File").setInputFiles({
      name: "shopfront.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await dialog.getByRole("button", { name: "Connect", exact: true }).click();

    await saysARefusal(dialog.getByRole("alert"));
    await keepsItsWordOffThePage(page, "media-type-refused");
    await expect(dialog).toBeVisible();
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

const BANK_ACCOUNT_RULE = "Sort code and account number";

const HOME_ADDRESS_RULE = "Home address";

const HEALTH_CUE_RULE = "Health wording";

const BANK_ACCOUNT_BOX = `Select bank details by ${BANK_ACCOUNT_RULE} in Supplier form`;

const HOME_ADDRESS_BOX = `Select home address by ${HOME_ADDRESS_RULE} in Supplier form`;

const healthCueBoxIn = (title: string): string =>
  `Select special category by ${HEALTH_CUE_RULE} in ${title}`;

const HEALTH_CUE_BOX = healthCueBoxIn("Staff survey");

const aNoteOf = (findings: number): RegExp => new RegExp(String.raw`\b${String(findings)}\b`);

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

const reviewNamed = (page: Page, name: string) =>
  page.getByRole("region", { name: `Review of ${name}` });

const reviewOf = (page: Page, name: string) =>
  connectedSourceNamed(page, name).getByRole("region", { name: `Review of ${name}` });

const WIDENING = (url: URL): boolean => url.pathname.includes("sources.widen");

const reviewHeading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 4, name: `Review of ${name}` });

const findingRow = (page: Page, name: string, document: string, rule: string) =>
  reviewOf(page, name).getByRole("row").filter({ hasText: document }).filter({ hasText: rule });

const notesOf = (page: Page, name: string, document: string, rule: string) =>
  findingRow(page, name, document, rule).getByRole("paragraph");

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
              - checkbox "${BANK_ACCOUNT_BOX}" [checked=false]
            - cell "Bank details Always"
            - cell "${BANK_ACCOUNT_RULE}"
            - cell "Supplier form"
            - cell "2"
            - cell "Internal"
          - row:
            - cell:
              - checkbox "${HOME_ADDRESS_BOX}" [checked=false]
            - cell "Home address Default on"
            - cell "${HOME_ADDRESS_RULE}"
            - cell "Supplier form"
            - cell "1"
            - cell "Internal"
          - row:
            - cell:
              - checkbox "${HEALTH_CUE_BOX}" [checked=false]
            - cell "Special category Always"
            - cell "${HEALTH_CUE_RULE}"
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
      "Select government identifier by UK_PASSPORT in Passport scan",
    );
  });

  test("selects no group of findings once focus leaves the table", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Midgley Keys",
      connectedSources: [SUPPLIER_FORMS],
    });
    await rowAction(page, "Supplier forms", "review").click();
    const box = page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX });
    await box.focus();
    await reviewHeading(page, "Supplier forms").focus();

    await page.keyboard.press("x");
    await twoFramesDrawn(page);

    await expect(box, "x selected a group not in focus").not.toBeChecked();
    const keep = reviewOf(page, "Supplier forms").getByRole("button", { name: "Keep in Text" });
    await expect(keep).toBeDisabled();
    await expect(keep, "the review stopped saying to select first").toHaveAccessibleDescription(
      /\S/,
    );
  });

  test("narrows the source whose review holds focus, by key", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Midgley Panels",
      connectedSources: [SUPPLIER_FORMS],
    });
    await rowAction(page, "Supplier forms", "review").click();
    await page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX }).focus();

    await page.keyboard.press("n");

    await expect(rowAction(page, "Supplier forms", "narrow")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
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

    const describedBy = await review
      .getByRole("button", { name: "Keep in Text", exact: true })
      .getAttribute("aria-describedby");
    assert.ok(describedBy !== null, "Keep in Text is described by what enables it");
    const enabling = review.locator(`[id="${describedBy}"]`);
    await expect(enabling).toBeVisible();
    for (const label of [
      "Keep in Text",
      "Narrow These Documents",
      "Dismiss as Not Special Category",
    ]) {
      const action = review.getByRole("button", { name: label, exact: true });
      await expect(action).toBeDisabled();
      await expect(action).toHaveAccessibleDescription(/\S/);
      await expect(action).toHaveAttribute("aria-describedby", describedBy);
    }

    await review.getByRole("checkbox", { name: BANK_ACCOUNT_BOX }).click();
    await expect(enabling).toHaveCount(0);
    const keep = review.getByRole("button", { name: "Keep in Text", exact: true });
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
      reviewOf(page, "Supplier forms").getByRole("button", { name: "Keep in Text" }),
    ).toBeDisabled();
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", {
        name: "Narrow These Documents",
      }),
    ).toBeDisabled();
    await expect(reviewHeading(page, "Supplier forms")).toBeFocused();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeFocused();
    await page.keyboard.press("x");
    await expect(page.getByRole("checkbox", { name: BANK_ACCOUNT_BOX })).toBeChecked();

    await page.keyboard.press("k");
    const keeping = page.getByRole("dialog", { name: "Keep 1 Group of Findings in Text" });
    await expect(keeping.getByRole("listitem")).toContainText(BANK_ACCOUNT_RULE);
    await expect(keeping.getByRole("listitem")).toHaveText(/Supplier form\D+2\b/);
    await expect(keeping.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("The company's own bank details, printed on every invoice");
    await page.keyboard.press("Enter");

    const kept = /\b1\b\D+\b2\b/;
    await expect(outcomesOf(page, "Supplier forms")).toHaveText([kept]);
    await expect(
      reviewOf(page, "Supplier forms").getByRole("button", { name: "Keep in Text" }),
    ).toBeDisabled();

    await page.getByRole("checkbox", { name: HOME_ADDRESS_BOX }).focus();
    await page.keyboard.press("x");
    await page.keyboard.press("d");
    const narrowing = page.getByRole("dialog", { name: "Narrow 1 Document to Restricted" });
    await expect(narrowing.getByRole("listitem")).toHaveText(["Supplier form"]);
    await narrowing.getByRole("button", { name: "Narrow", exact: true }).focus();
    await page.keyboard.press("Enter");

    await expect(outcomesOf(page, "Supplier forms")).toHaveText([
      kept,
      /\b1\b\D+Restricted\D+\b0\b\D+\b0\b/,
    ]);
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", HOME_ADDRESS_RULE),
    ).toContainText("Restricted");
    await expect(
      findingRow(page, "Supplier forms", "Supplier form", BANK_ACCOUNT_RULE),
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
    const dismissal = review.getByRole("button", {
      name: "Dismiss as Not Special Category",
      exact: true,
    });
    await expect(dismissal).toBeDisabled();
    const notes = notesOf(page, "Supplier forms", "Staff survey", HEALTH_CUE_RULE);
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
    await expect(dismissal).toBeEnabled();

    await page.keyboard.press("s");
    const dismissing = page.getByRole("dialog", {
      name: "Dismiss 1 Group of Findings as Not Special Category",
    });
    await expect(dismissing.getByRole("listitem")).toContainText(HEALTH_CUE_RULE);
    await expect(dismissing.getByRole("listitem")).toHaveText(/Staff survey\D+1\b/);
    await expect(dismissing.getByLabel("Reason")).toBeFocused();
    await page.keyboard.type("A survey of the pumps our engineers diagnose, not of people");
    await clockTheNextKey(page, {
      at: `//tr[td[.='${HEALTH_CUE_RULE}']][td[.='Staff survey']]//p[contains(., '1')]`,
      reads: "1",
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "dismissal");

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
      notesOf(page, "Supplier forms", "Staff survey", HEALTH_CUE_RULE),
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
            - checkbox "${healthCueBoxIn("Absence log")}" [checked=false]
          - cell "Special category Always"
          - cell "${HEALTH_CUE_RULE}"
          - cell "Absence log"
          - cell "2"
          - cell /^Restricted/:
            - paragraph: /^\\D+$/
            - paragraph: /\\b1\\b/
        - row:
          - cell:
            - checkbox "${healthCueBoxIn("Pump service notes")}" [checked=false]
          - cell "Special category Always"
          - cell "${HEALTH_CUE_RULE}"
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
      notesOf(page, "Payroll exports", "March payroll", BANK_ACCOUNT_RULE),
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
    await page.getByRole("button", { name: "Preview Passages" }).click();

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

const aWideningOpened = async (page: Page, api: APIRequestContext, workspace: string) => {
  await anAdminAtSources(page, api, {
    workspace,
    connectedSources: [indexed("Staff handbook", { sensitivity: "Restricted" })],
  });
  const opener = rowAction(page, "Staff handbook", "widen");
  await opener.click();
  const panel = panelOf(page, "Staff handbook", "widen");
  const sensitivityPicked = panel.getByRole("combobox", { name: "Sensitivity" });
  await expect(sensitivityPicked).toBeFocused();
  return { opener, panel, sensitivityPicked };
};

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
    assert.ok(citedBy, "the harness seeded no citing concept");

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

    await commitOf(page, "Supplier payments", "narrow").focus();
    await page.keyboard.press("Enter");

    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Supplier payments" })).toBeFocused();
    await expect(sensitivityOf(page, "Supplier payments")).toHaveText("Restricted");
    await expect(saidIn(page)).toHaveText(/Supplier payments\D+Restricted\D+\b1\b\D+\b1\b/);
    await expect(page.getByText(citedBy.iri)).toBeVisible();
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
    await expect(commitOf(page, "Staff handbook", "widen")).toBeVisible();

    await panel.getByRole("combobox", { name: "Audience" }).press("Enter");
    await page.getByRole("option", { name: EVERYONE }).press("Enter");
    await expect(panel.getByRole("term")).toHaveText(["Sensitivity", "Audience"]);
    await expect(panel.getByRole("definition")).toHaveText([
      /Restricted.+Internal/,
      new RegExp(`${NAMED_GROUPS}.+${EVERYONE}`, "i"),
    ]);
    await commitOf(page, "Staff handbook", "widen").click();

    await expect(saidIn(page)).toHaveText(/Staff handbook\D+Internal/);
    await expect(sensitivityOf(page, "Staff handbook")).toHaveText("Internal");
    await expect(leadOf(page, "Staff handbook", "Audience")).toHaveText(EVERYONE);
  });

  test("cancels a widening, focus back on what opened it", async ({ page, request }) => {
    const { opener, panel } = await aWideningOpened(page, request, "Midgley Ropes");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel).toHaveCount(0);
    await expect(opener, "Cancel did not hand focus back to the button").toBeFocused();

    const moreAbout = connectedSourceNamed(page, "Staff handbook").getByRole("button", {
      name: "More Details Staff handbook",
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

  test("closes a widening on Escape, focus back on Widen", async ({ page, request }) => {
    const { opener, panel } = await aWideningOpened(page, request, "Mankinholes Rope");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(commitOf(page, "Staff handbook", "widen")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener, "Escape did not hand focus back to the button").toBeFocused();
    await expect(sensitivityOf(page, "Staff handbook")).toHaveText("Restricted");
  });

  test("Escape closes an open select, not the panel", async ({ page, request }) => {
    const { opener, panel, sensitivityPicked } = await aWideningOpened(
      page,
      request,
      "Lumbutts Mill",
    );
    await sensitivityPicked.press("Enter");
    await expect(page.getByRole("option", { name: "Internal" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(panel, "the Escape that closed the select closed the panel too").toBeVisible();
    await expect(sensitivityPicked).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("pressing Widen again closes its panel, focus kept", async ({ page, request }) => {
    const { opener, panel } = await aWideningOpened(page, request, "Todmorden Felt");

    await opener.click();

    await expect(panel).toHaveCount(0);
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener, "a second press moved focus off Widen").toBeFocused();
    await opener.press("Enter");
    await expect(panel).toBeVisible();
  });

  test("Narrow and Widen say whether their panel is open", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Walsden Dyeworks",
      connectedSources: [indexed("Staff handbook"), indexed("Price list")],
    });
    const narrow = rowAction(page, "Staff handbook", "narrow");
    const widen = rowAction(page, "Staff handbook", "widen");
    const otherWiden = rowAction(page, "Price list", "widen");
    const expandedAre = async (expected: { readonly narrow: string; readonly widen: string }) => {
      await expect(narrow).toHaveAttribute("aria-expanded", expected.narrow);
      await expect(widen).toHaveAttribute("aria-expanded", expected.widen);
      await expect(otherWiden).toHaveAttribute("aria-expanded", "false");
    };

    await expandedAre({ narrow: "false", widen: "false" });
    await widen.click();
    await expect(panelOf(page, "Staff handbook", "widen")).toBeVisible();
    await expandedAre({ narrow: "false", widen: "true" });

    await narrow.click();
    await expect(panelOf(page, "Staff handbook", "narrow")).toBeVisible();
    await expandedAre({ narrow: "true", widen: "false" });

    await panelOf(page, "Staff handbook", "narrow").getByRole("button", { name: "Cancel" }).click();
    await expandedAre({ narrow: "false", widen: "false" });
  });

  test("holds a second widening while the first is still pending", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Heptonstall Slate",
      connectedSources: [indexed("Bid library"), indexed("Case studies")],
    });

    const widening = await holdingTheFirstAnswer(page, WIDENING);

    await rowAction(page, "Bid library", "widen").click();
    await commitOf(page, "Bid library", "widen").click();
    await widening.reached;
    await expect(sensitivityOf(page, "Bid library")).toHaveText("Public");

    await rowAction(page, "Case studies", "widen").click();
    const second = commitOf(page, "Case studies", "widen");
    await expect(second).toHaveAttribute("aria-disabled", "true");
    await expect(second).toHaveAccessibleDescription(/\S/);
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(panelOf(page, "Case studies", "widen")).toBeVisible();
    await expect(sensitivityOf(page, "Case studies")).toHaveText("Internal");
    widening.release();

    await expect(saidIn(page)).toHaveText(/Bid library\D+Public/);
    await expect(second).toHaveAttribute("aria-disabled", "false");
    await expect(second).toHaveAccessibleDescription("");
    expect(widening.asked(), "the second press asked the api while the first was pending").toBe(1);
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
    await expect(audienceOf).toHaveText(new RegExp(`^${NAMED_GROUPS}\\D+1\\b`));

    await rowAction(page, "Price book", "widen").focus();
    await page.keyboard.press("w");
    const panel = panelOf(page, "Price book", "widen");
    await expect(panel.getByRole("combobox", { name: "Audience" })).toHaveText(EVERYONE);
    await expect(panel.getByRole("term"), "a term that stays is listed as a change").toHaveText([
      "Audience",
    ]);
    await passesTheAccessibilityGate();

    await commitOf(page, "Price book", "widen").press("Enter");

    await expect(saidIn(page)).toHaveText(/Price book\D+Public\D+\b0\b\D+\b0\b/);
    const whenWidened = await saidNowIn(saidIn(page));
    await expect(audienceOf).toHaveText(EVERYONE);
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
    await commitOf(page, "Service records", "widen").click();

    expect(await refused).toMatchObject({ word: "special-category-unreviewed" });
    await saysARefusal(connectedSourcesRegion(page).getByRole("alert"));
    await expect(sensitivityOf(page, "Service records")).toHaveText("Restricted");
  });
});

test.describe("the Sources page's keystrokes", () => {
  test("drops the select-first line once a key acts", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Sowerby Clearing",
      connectedSources: [SUPPLIER_FORMS],
    });
    const said = connectedSourcesRegion(page).getByText(SELECT_A_CONNECTED_SOURCE_FIRST);
    await expect(rowAction(page, "Supplier forms", "narrow")).toBeVisible();
    await keystrokesButton(page).focus();

    await page.keyboard.press("n");
    await expect(said, "n with no connected source in focus said nothing").toHaveCount(1);

    await rowAction(page, "Supplier forms", "narrow").focus();
    await page.keyboard.press("n");
    await expect(rowAction(page, "Supplier forms", "narrow")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(said, "the select-first line outlived the narrow").toHaveCount(0);
  });

  test("acts on no source by key once focus leaves", async ({ page, request }) => {
    await anAdminAtSources(page, request, {
      workspace: "Sowerby Keys",
      connectedSources: [SUPPLIER_FORMS],
    });
    const saying = connectedSourcesRegion(page).getByRole("status").filter({ hasText: /\S/ });
    await expect(rowAction(page, "Supplier forms", "review")).toBeVisible();
    const atRest = await saying.count();
    await rowAction(page, "Supplier forms", "review").focus();
    await keystrokesButton(page).focus();

    for (const key of ["r", "p", "n", "w"]) await page.keyboard.press(key);
    await twoFramesDrawn(page);

    await expect(page.getByRole("dialog"), "a key published a source not in focus").toHaveCount(0);
    await expect(reviewNamed(page, "Supplier forms")).toHaveCount(0);
    await expect(saying, "a key with no connected source in focus said nothing").toHaveCount(
      atRest + 1,
    );
    for (const action of ["narrow", "widen"] as const) {
      await expect(rowAction(page, "Supplier forms", action)).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
  });

  test("lists keystrokes on ?, and one switch turns them off", async ({ page, request }) => {
    await anAdminAtSources(page, request, { workspace: "Luddenden Weaving" });

    await page.keyboard.press("?");
    const turnedOn = "Use single-key shortcuts on this browser";
    const heading = "Keyboard Shortcuts on Connected Sources";
    const listed = page.getByRole("dialog", { name: heading });
    await expect(listed).toMatchAriaSnapshot(`
      - dialog "${heading}":
        - heading "${heading}" [level=2]
        - paragraph
        - checkbox "${turnedOn}" [checked]
        - term: b
        - definition: Connect a Document
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
    const actions = listed.getByRole("definition");
    await expect(actions).toHaveText(Array.from({ length: 11 }, () => /\S/));
    const said = await actions.allInnerTexts();
    expect(new Set(said).size, "two keys are listed with one action").toBe(said.length);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    const keystrokes = page
      .getByRole("navigation", { name: "Areas" })
      .getByRole("button", { name: "Keyboard Shortcuts" });
    await expect(keystrokes).toHaveAttribute("aria-keyshortcuts", "?");
    await expect(keystrokes).toBeFocused();

    await page.keyboard.press("b");
    const connectedSource = page.getByRole("dialog", { name: "Connect a Document" });
    await expect(connectedSource).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(connectedSource).toHaveCount(0);

    await keystrokes.click();
    await listed.getByRole("checkbox", { name: turnedOn }).press("Space");
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
