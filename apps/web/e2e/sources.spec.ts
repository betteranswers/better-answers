import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  moveTheIndexRun,
  person,
  provision,
  seedBindings,
  signIn,
  skipLinkReachesTheScreen,
  type SeedBinding,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const ACT_BUDGET_MS = 100;

// Any id the platform mints: the screen shows none, a finding's least of all.
const AN_ID = /\b[0-9A-HJKMNP-TV-Z]{26}\b/;

const rail = (page: Page) => page.getByRole("navigation", { name: "Control Centre" });

const bindingsRegion = (page: Page) => page.getByRole("region", { name: "Bindings" });

const bindingNamed = (page: Page, name: string): Locator =>
  bindingsRegion(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });

// The lead's one definition a term names, read the way a screen reader pairs them.
const leadOf = (page: Page, name: string, term: string): Locator =>
  bindingNamed(page, name)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .first()
    .locator("xpath=following-sibling::dd[1]");

const stateOf = (page: Page, name: string) => leadOf(page, name, "State");

const lastRunOf = (page: Page, name: string) => leadOf(page, name, "Last run");

const classOf = (page: Page, name: string) => leadOf(page, name, "Class");

// An Admin of a fresh workspace, signed in on the product's own screen and standing on Sources.
const anAdminAtSources = async (
  page: Page,
  api: APIRequestContext,
  input: { readonly workspace: string; readonly bindings?: readonly SeedBinding[] },
) => {
  const email = anAddress("admin");
  const workspace = await provision(api, { name: input.workspace, adminEmail: email });
  const seeded =
    input.bindings === undefined
      ? { bindings: [] }
      : await seedBindings(api, { workspaceId: workspace.workspaceId, bindings: input.bindings });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await rail(page).getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  return { workspace, seeded };
};

// An absence asserted straight after a key would pass before React drew what the key did.
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

const indexed = (name: string, overrides: Partial<SeedBinding> = {}): SeedBinding => ({
  name,
  sensitivity: "Internal",
  run: "done",
  documents: [{ title: `${name}.md` }],
  ...overrides,
});

test.describe("the Sources screen's list of bindings", () => {
  test("lists ten bindings to an Admin within a second, each leading with what judges it and the rest one disclosure in", async ({
    page,
    request,
  }) => {
    const ten: SeedBinding[] = [
      indexed("Bid library"),
      indexed("Case studies", { published: true }),
      indexed("Contracts", { run: "queued" }),
      indexed("Framework returns", { run: "claimed" }),
      indexed("HR policies", { sensitivity: "Restricted" }),
      indexed("Method statements", { published: true, sensitivity: "Public" }),
      indexed("Quality manual"),
      indexed("Safety records", { run: "none" }),
      indexed("Staff handbook"),
      indexed("Tender archive", { published: true }),
    ];
    await anAdminAtSources(page, request, { workspace: "Calder Joinery", bindings: ten });

    // A fresh document, so no list is already in the page's cache.
    const started = Date.now();
    await page.goto("/sources/bindings");
    await expect(bindingsRegion(page).getByRole("heading", { level: 3 })).toHaveCount(10);
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: "bindings list", description: `${elapsed} ms` });
    expect(elapsed, "the list of ten bindings rendered past its budget").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await expect(bindingsRegion(page).getByRole("heading", { level: 3 })).toHaveText(
      ten.map((binding) => binding.name),
    );
    await expect(stateOf(page, "Case studies")).toHaveText("published");
    await expect(stateOf(page, "Contracts")).toHaveText("landed");
    await expect(stateOf(page, "Framework returns")).toHaveText("indexing");
    await expect(stateOf(page, "Staff handbook")).toHaveText("indexed");
    await expect(lastRunOf(page, "Safety records")).toHaveText("No run yet");

    const handbook = bindingNamed(page, "Staff handbook");
    await expect(handbook).toMatchAriaSnapshot(`
      - listitem:
        - heading "Staff handbook" [level=3]
        - button "Review Staff handbook"
        - button "Publish Staff handbook"
        - button "Narrow Staff handbook"
        - term: Connector
        - definition: upload
        - term: Class
        - definition: Internal
        - term: Audience
        - definition: Everyone in the workspace
        - term: State
        - definition: indexed
        - term: Last run
        - definition: /Index run done · \\d{2}:\\d{2} · \\d{1,2} \\w+ \\d{4}/
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

  test("tells an Admin why each document was quarantined, and how many of the binding's want OCR", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Holme Surveys",
      bindings: [
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

    const archive = bindingNamed(page, "Site archive");
    await archive.getByRole("button", { name: "More about Site archive" }).click();

    await expect(archive).toContainText("4 documents quarantined, 2 want OCR.");
    await expect(archive.getByRole("listitem")).toHaveText([
      "Archive: took too long",
      "Floor plan: needs OCR",
      "Old minutes: could not be read",
      "Site survey: needs OCR",
    ]);
  });

  test("tells a member who is not an Admin the refusal in its own word, with who can act", async ({
    page,
    request,
  }) => {
    const workspace = await provision(request, { name: "Pennine Fabrication" });
    await seedBindings(request, {
      workspaceId: workspace.workspaceId,
      bindings: [indexed("Staff handbook")],
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
    await rail(page).getByRole("link", { name: "Sources" }).click();

    await expect(bindingsRegion(page)).toContainText(
      "Refused: role-forbids. Only an Admin of this workspace may do this. An Admin can take it from here.",
    );
    await expect(bindingsRegion(page)).not.toContainText("Staff handbook");

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Bind a document" });
    await dialog.getByLabel("Name").fill("Tender answers");
    await dialog.getByLabel("File").setInputFiles({
      name: "answers.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("What the company answered."),
    });
    await dialog.getByRole("button", { name: "Bind the document" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Refused: role-forbids. Only an Admin of this workspace may do this. An Admin can take it from here.",
    );
  });
});

test.describe("binding a document on the Sources screen", () => {
  test("an Admin binds a document by keyboard and watches its state move landed, indexing, indexed as the worker runs", async ({
    page,
    request,
  }) => {
    const { workspace } = await anAdminAtSources(page, request, { workspace: "Airedale Tooling" });
    await page.goto("/sources/bindings");
    await expect(bindingsRegion(page)).toContainText("No document is bound yet.");
    await skipLinkReachesTheScreen(page);

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Bind a document" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("The staff handbook");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Class" })).toHaveText("Restricted");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("combobox", { name: "Audience" })).toBeFocused();
    await page.keyboard.press("Tab");

    const choosing = page.waitForEvent("filechooser");
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
    await expect(dialog.getByRole("button", { name: "Bind the document" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(dialog.getByRole("progressbar", { name: "Upload of handbook.md" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await devtools.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });

    await expect(page.getByText("Bound “The staff handbook”: handbook.md landed")).toBeVisible();
    await expect(stateOf(page, "The staff handbook")).toHaveText("landed");
    await expect(lastRunOf(page, "The staff handbook")).toContainText("Index run queued");
    await expect(classOf(page, "The staff handbook")).toHaveText("Restricted");

    await moveTheIndexRun(request, { workspaceId: workspace.workspaceId, to: "claimed" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("indexing");
    await expect(lastRunOf(page, "The staff handbook")).toContainText("Index run claimed");

    await moveTheIndexRun(request, { workspaceId: workspace.workspaceId, to: "done" });
    await expect(stateOf(page, "The staff handbook")).toHaveText("indexed");
    await expect(lastRunOf(page, "The staff handbook")).toContainText("Index run done");
  });

  test("refuses an Admin's file of a kind the platform does not convert before a byte leaves, in its own word", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, { workspace: "Ryburn Signs" });

    await page.keyboard.press("b");
    const dialog = page.getByRole("dialog", { name: "Bind a document" });
    await dialog.getByLabel("Name").fill("Shop photographs");
    await dialog.getByLabel("File").setInputFiles({
      name: "shopfront.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await dialog.getByRole("button", { name: "Bind the document" }).click();

    await expect(dialog.getByRole("alert")).toHaveText(
      "Refused: media-type-refused. The platform converts markdown, plain text, Word (.docx) and PDF, and this file is none of them. Choose a file of one of those kinds.",
    );
    await expect(dialog).toBeVisible();
  });
});

const SUPPLIER_FORMS: SeedBinding = indexed("Supplier forms", {
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

const reviewOf = (page: Page, name: string) =>
  page.getByRole("region", { name: `Review of ${name}` });

const findingRow = (page: Page, name: string, document: string, rule: string) =>
  reviewOf(page, name).getByRole("row").filter({ hasText: document }).filter({ hasText: rule });

test.describe("reviewing a binding's findings", () => {
  test("shows an Admin findings per category and rule with counts and no value, a special category document already narrowed", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Colne Valley Metals",
      bindings: [SUPPLIER_FORMS],
    });

    await bindingNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .focus();
    await page.keyboard.press("r");
    await expect(
      page.getByRole("heading", { level: 2, name: "Review of Supplier forms" }),
    ).toBeFocused();

    await expect(reviewOf(page, "Supplier forms").getByRole("table")).toMatchAriaSnapshot(`
      - table:
        - caption: 0 finding groups selected. Select a group with x, then keep it in text or narrow its document with the acts above.
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

  test("an Admin keeps the selected always-set groups in text and narrows the documents others sit in, never naming a finding", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Hebden Plastics",
      bindings: [SUPPLIER_FORMS],
    });
    await bindingNamed(page, "Supplier forms")
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
        "Kept 1 finding group in text: 2 spans restored, and the index run that lets them back in is queued.",
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

  test("shows an Admin a kept group an erasure overrides as still withheld, and says why", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Wharfe Catering",
      bindings: [
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
    await bindingNamed(page, "Payroll exports")
      .getByRole("button", { name: "Review Payroll exports" })
      .click();

    const row = findingRow(page, "Payroll exports", "March payroll", "UK_BANK_ACCOUNT");
    await expect(row).toContainText("Kept, still withheld");
    await expect(row).toContainText(
      "2 kept spans overridden by an erasure request: an erasure outranks a keep.",
    );
  });

  test("previews an unpublished binding's chunks to the Admin reviewing it", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Kirklees Print",
      bindings: [
        indexed("Staff handbook", {
          documents: [
            {
              title: "handbook.md",
              chunks: ["The handbook says what the company decided.", "Pay goes to [withheld]."],
            },
          ],
        }),
      ],
    });
    await bindingNamed(page, "Staff handbook")
      .getByRole("button", { name: "Review Staff handbook" })
      .click();
    await page
      .getByRole("button", { name: "Preview the chunks a reader would see once published" })
      .click();

    await expect(reviewOf(page, "Staff handbook").getByRole("listitem")).toHaveText([
      "The handbook says what the company decided.",
      "Pay goes to [withheld].",
    ]);
  });

  test("scrolls nothing sideways for an Admin at 320 pixels with the review open, the table holding its own width", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Marsden Mills",
      bindings: [SUPPLIER_FORMS],
    });
    await page.setViewportSize({ width: 320, height: 720 });
    await bindingNamed(page, "Supplier forms")
      .getByRole("button", { name: "Review Supplier forms" })
      .click();
    await expect(reviewOf(page, "Supplier forms").getByRole("checkbox")).toHaveCount(3);

    const room = await page.evaluate(() => ({
      scrolls: document.documentElement.scrollWidth,
      holds: document.documentElement.clientWidth,
    }));
    expect(room.scrolls, "the screen scrolls sideways at 320 pixels").toBeLessThanOrEqual(
      room.holds,
    );
  });
});

test.describe("publishing and narrowing a binding", () => {
  test("the publish dialog states an Admin's three confirmations and the audit row before the click, and the act lands within 100 ms", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, {
      workspace: "Spen Valley Bakery",
      bindings: [
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

    await bindingNamed(page, "Staff handbook")
      .getByRole("button", { name: "Review Staff handbook" })
      .focus();
    await page.keyboard.press("p");
    const dialog = page.getByRole("dialog", { name: "Publish Staff handbook" });
    await expect(dialog.getByRole("button", { name: "Publish Staff handbook" })).toBeDisabled();

    const carried = dialog.getByRole("region", { name: "What the audit row will carry" });
    await expect(carried).toMatchAriaSnapshot(`
      - region "What the audit row will carry":
        - heading "What the audit row will carry" [level=3]
        - term: Act
        - definition: sources.binding.published
        - term: Binding
        - definition: Staff handbook
        - term: By
        - definition: You, at the instant the platform records it
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
        - definition: The hash of this binding's DPIA input, taken at the click
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

    await page.evaluate(() => {
      const stateWord = () => {
        const heading = [...document.querySelectorAll("h3")].find(
          (candidate) => candidate.textContent === "Staff handbook",
        );
        const terms = [...(heading?.closest("li")?.querySelectorAll("dt") ?? [])];
        return terms.find((term) => term.textContent === "State")?.nextElementSibling?.textContent;
      };
      const landed = new Promise<number>((resolve) => {
        document.addEventListener(
          "keydown",
          () => {
            const pressedAt = performance.now();
            const observer = new MutationObserver(() => {
              if (stateWord() !== "published") return;
              observer.disconnect();
              resolve(performance.now() - pressedAt);
            });
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              characterData: true,
            });
          },
          { capture: true, once: true },
        );
      });
      Reflect.set(window, "publishLanded", landed);
    });
    await page.keyboard.press("Enter");
    const elapsed = await page.evaluate(() => Reflect.get(window, "publishLanded"));
    test.info().annotations.push({ type: "publish act", description: `${elapsed} ms` });
    expect(elapsed, "the publish did not read as landed within its budget").toBeLessThan(
      ACT_BUDGET_MS,
    );

    await expect(
      page.getByText(
        "Published “Staff handbook”: its passages reach everyone in the workspace now",
      ),
    ).toBeVisible();
    await expect(stateOf(page, "Staff handbook")).toHaveText("published");
    await expect(
      bindingNamed(page, "Staff handbook").getByRole("button", { name: "Publish Staff handbook" }),
    ).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: "Staff handbook" })).toBeFocused();
  });

  test("an Admin's narrowing of a published binding moves every concept citing it and every composition including one", async ({
    page,
    request,
  }) => {
    const { seeded } = await anAdminAtSources(page, request, {
      workspace: "Todmorden Engineering",
      bindings: [
        indexed("Supplier payments", {
          published: true,
          documents: [{ title: "Payment terms", cited: true }],
        }),
      ],
    });
    const citedBy = seeded.bindings[0]?.documents[0]?.citedBy;
    expect(citedBy, "the harness seeded no citing concept").toBeDefined();

    await bindingNamed(page, "Supplier payments")
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
});

test.describe("the Sources screen's keystrokes", () => {
  test("? lists an Admin every keystroke, b binds from anywhere on the screen, and one switch turns them off", async ({
    page,
    request,
  }) => {
    await anAdminAtSources(page, request, { workspace: "Luddenden Weaving" });

    await page.keyboard.press("?");
    const listed = page.getByRole("dialog", { name: "Keystrokes on Sources" });
    await expect(listed).toMatchAriaSnapshot(`
      - dialog "Keystrokes on Sources":
        - heading "Keystrokes on Sources" [level=2]
        - paragraph: Each works from anywhere on the screen outside a field or a dialog.
        - checkbox "Single-key keystrokes, kept on this browser" [checked]
        - text: Single-key keystrokes, kept on this browser
        - term: b
        - definition: Bind a document
        - term: r
        - definition: Review the binding in focus
        - term: p
        - definition: Publish the binding in focus
        - term: "n"
        - definition: Narrow the binding in focus
        - term: x
        - definition: Select or clear the finding group in focus
        - term: k
        - definition: Keep the selected finding groups in text
        - term: d
        - definition: Narrow the documents the selected finding groups sit in
        - term: "?"
        - definition: List these keystrokes
    `);
    await page.keyboard.press("Escape");
    await expect(listed).toHaveCount(0);
    const keystrokes = page.getByRole("button", { name: "Keystrokes" });
    await expect(keystrokes).toHaveAttribute("aria-keyshortcuts", "?");
    await expect(keystrokes).toBeFocused();

    await page.keyboard.press("b");
    const binding = page.getByRole("dialog", { name: "Bind a document" });
    await expect(binding).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(binding).toHaveCount(0);

    await keystrokes.click();
    await listed
      .getByRole("checkbox", { name: "Single-key keystrokes, kept on this browser" })
      .press("Space");
    await page.keyboard.press("Escape");
    await page.keyboard.press("b");
    await page.keyboard.press("?");
    await twoFramesDrawn(page);
    await expect(binding, "a keystroke turned off still bound").toHaveCount(0);
    await expect(listed, "a keystroke turned off still listed").toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await page.keyboard.press("b");
    await twoFramesDrawn(page);
    await expect(binding, "the choice did not survive a reload").toHaveCount(0);
  });
});
