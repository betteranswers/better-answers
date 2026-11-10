import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { collectionNameOf } from "@better-answers/schema/collection-name";

import { PASSKEY_WORDS } from "@/features/auth/account-words.ts";
import { EDITOR_WORDS, FORMATTING_WORDS } from "@/features/knowledge/editing/editor-words.ts";
import {
  CONCEPT_KEYSTROKES as KEY,
  EDITOR_KEYSTROKES,
} from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE as SEARCH } from "@/shared/knowledge/concept-address.ts";
import { CONCEPT_WORDS } from "@/shared/knowledge/concept-words.ts";

import { expect, test } from "../browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  clockTheNextKey,
  nameOwners,
  person,
  provision,
  signIn,
  skipLinkReachesThePage,
  medianActionWithinBudget,
} from "../harness.ts";
import {
  conceptsSeeded,
  isKnowledgeFind,
  listsItsKeystrokes,
  scrolledSideways,
} from "../knowledge.ts";
import { aVirtualAuthenticator } from "../virtual-authenticator.ts";

const LIST_BUDGET_MS = 1000;

const COMMITTEE = "Audit Committee";

const SALARY = "Audit Salary Bands";

const RETENTION = "Audit Logs Retention";

const CALENDAR = "Audit Calendar";

const POLICY = "Records policy";

const MINUTES = "Board minutes";

const MINUTES_DOCUMENT = "Closed session record, March";

const STANDARD = "Retention standard";

const CHARTER = "Committee charter";

const POLICY_PASSAGE = "Audit logs are kept for seven years, then deleted.";

const MINUTES_PASSAGE = "The board fixed the period in closed session.";

const CHARTER_PASSAGE = "The committee meets in the first week of each quarter.";

const CLAIM = "We keep audit logs for seven years, then delete them.";

const LEASE = "Yard Lease";

const CONTRACTS = "contracts";

const LEASE_DOCUMENT = "Yard lease 2024.pdf";

const IMAGE_HOST = "images.example.test";

const RETENTION_BODY = [
  `${CLAIM}[^source-1]`,
  "",
  "## Who decides",
  "",
  "The audit committee sets the period.[^source-3] The standard gives its page.[^source-4]",
  "",
  "<script>window.ranByABody = true</script>",
  "",
  `![The approval flow](https://${IMAGE_HOST}/approval-flow.png)`,
  "",
  "A [script link](javascript:window.ranByABody=true) stays words.",
].join("\n");

const IRI_PREFIX = "https://better-answers.com/c/";

type Seeded = Awaited<ReturnType<typeof conceptsSeeded>>;

const iriOf = (concepts: Seeded, title: string): string => {
  const iri = concepts.get(title)?.iri;
  if (iri === undefined) throw new Error(`${title} was not seeded`);
  return iri;
};

const pageOf = (concepts: Seeded, title: string): string =>
  `${SEARCH.path}/${iriOf(concepts, title).slice(IRI_PREFIX.length)}`;

const aWorkspaceOfConcepts = async (api: APIRequestContext, name: string) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const writer = { workspaceId: workspace.workspaceId, userId: workspace.admin.id };
  const first = await conceptsSeeded(api, {
    ...writer,
    concepts: [
      {
        title: COMMITTEE,
        conceptType: "Team",
        body: "The committee meets each quarter.",
        sources: [{ title: CHARTER, passages: [CHARTER_PASSAGE] }],
      },
      {
        title: SALARY,
        body: "Each salary band is reviewed by the audit committee.",
        sensitivity: "Restricted",
      },
      {
        title: RETENTION,
        body: RETENTION_BODY,
        trust: "machine-confirmed",
        linksTo: [COMMITTEE],
        sources: [
          { title: POLICY, passages: [POLICY_PASSAGE] },
          {
            title: MINUTES_DOCUMENT,
            label: MINUTES,
            passages: [MINUTES_PASSAGE],
            sensitivity: "Restricted",
          },
          { concept: COMMITTEE },
          { title: STANDARD, at: "p.4" },
        ],
        frontmatter: {
          description: "How long audit logs are kept, and who decides.",
          tags: ["audit", "retention"],
          verified: [{ by: "process:records-verifier", at: "2026-03-03T09:41:00Z" }],
          review_cycle: "Yearly",
        },
      },
    ],
  });
  const second = await conceptsSeeded(api, {
    ...writer,
    concepts: [
      {
        title: CALENDAR,
        body: `See [the retention rule](${iriOf(first, RETENTION)}) and [the salary bands](${iriOf(first, SALARY)}).`,
      },
    ],
  });
  return { workspace, adminEmail, concepts: new Map([...first, ...second]) };
};

type Workspace = Awaited<ReturnType<typeof aWorkspaceOfConcepts>>;

const signedInAsTheAdmin = async (page: Page, api: APIRequestContext, seeded: Workspace) => {
  await page.goto("/sign-in");
  await signIn(page, api, seeded.adminEmail);
};

const conceptOf = (page: Page, title: string): Locator =>
  page.getByRole("article", { name: title });

const sourcesOf = (page: Page): Locator => page.getByRole("region", { name: "Sources" });

const sourceLines = (page: Page): Locator => sourcesOf(page).getByRole("listitem");

const markOf = (page: Page, place: number, label: string): Locator =>
  page.getByRole("button", { name: `Source ${String(place)}: ${label}`, exact: true });

const panelOf = (page: Page, title: string): Locator => page.getByRole("dialog", { name: title });

const wayBack = (page: Page): Locator =>
  page.getByRole("main").getByRole("link", { name: "Back to Search" });

const asked = (query: string): string =>
  `${SEARCH.path}?${new URLSearchParams({ "knowledge.search": query }).toString()}`;

const matchOf = (page: Page, title: string): Locator =>
  page.getByRole("list", { name: "Matches" }).getByRole("link", { name: title, exact: true });

const atTheConcept = async (page: Page, seeded: Workspace, title: string): Promise<Locator> => {
  await page.goto(pageOf(seeded.concepts, title));
  const concept = conceptOf(page, title);
  await expect(concept).toBeVisible();
  return concept;
};

const NEW_TYPE = "Risk Register";

const NEW_TYPE_AS_TYPED = NEW_TYPE.toLowerCase();

const typeOf = (page: Page, title: string): Locator =>
  conceptOf(page, title).locator(
    `xpath=.//dt[normalize-space()="${CONCEPT_WORDS.type}"]/following-sibling::dd[1]`,
  );

const STATUS_OF_THE_EDITOR = "//article//section[.//h3]//output";

const edges = (drawn: Locator) =>
  drawn.evaluate((node) => {
    const { top, bottom, left, right } = node.getBoundingClientRect();
    return { top, bottom, left, right };
  });

test.describe("the concept page", () => {
  test("keeps focus in the search box after going back fails", async ({ page, request }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Ouse Annals");
    await signedInAsTheAdmin(page, request, seeded);
    await page.goto(asked("audit"));
    await matchOf(page, RETENTION).click();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await page.reload();
    await expect(conceptOf(page, RETENTION)).toBeVisible();
    await page.route(isKnowledgeFind, (route) => route.abort());
    await wayBack(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await page.unroute(isKnowledgeFind);

    const box = page.getByRole("searchbox", { name: "Search by a word or a question" });
    await box.fill("audit logs");

    await expect(matchOf(page, RETENTION)).toBeVisible();
    await expect(box, "the search box lost focus when the matches loaded").toBeFocused();
  });

  test("an Admin edits a concept's title and sees it saved", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Wye Ledgers");
    await signedInAsTheAdmin(page, request, seeded);
    await atTheConcept(page, seeded, COMMITTEE);

    await page.keyboard.press(EDITOR_KEYSTROKES.edit.key);
    const opened = page.getByRole("region", { name: EDITOR_WORDS.headingEdit });
    await expect(opened.getByRole("heading", { name: EDITOR_WORDS.headingEdit })).toBeFocused();
    await passesTheAccessibilityGate();
    await opened.getByRole("button", { name: "Markdown" }).click();
    await expect(opened.getByRole("textbox", { name: "Body" })).toContainText(
      "The committee meets each quarter.",
    );
    await passesTheAccessibilityGate();
    await opened.getByRole("button", { name: EDITOR_WORDS.close }).click();
    await expect(opened).toHaveCount(0);

    const samples: number[] = [];
    let title = COMMITTEE;
    for (let sample = 1; sample <= ACTION_SAMPLES; sample += 1) {
      title = `${COMMITTEE} ${String(sample)}`;
      await page.keyboard.press(EDITOR_KEYSTROKES.edit.key);
      const editor = page.getByRole("region", { name: EDITOR_WORDS.headingEdit });
      await editor.getByRole("textbox", { name: "Title" }).fill(title);

      await page.keyboard.down("Control");
      await clockTheNextKey(page, { at: STATUS_OF_THE_EDITOR, reads: EDITOR_WORDS.saving });
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");

      samples.push(await actionClocked(page));
      await expect(
        conceptOf(page, title).getByRole("status"),
        "the concept was not saved under its new title",
      ).toHaveText(/\S/u);
    }
    medianActionWithinBudget("save", samples);

    await page.reload();
    await expect(conceptOf(page, title)).toBeVisible();
  });

  test("an Admin picks a type and formats in the editor", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Test Pickers");
    await signedInAsTheAdmin(page, request, seeded);
    const title = COMMITTEE;
    await atTheConcept(page, seeded, title);

    await test.step("names each formatting button and tips it", async () => {
      await page.keyboard.press(EDITOR_KEYSTROKES.edit.key);
      const editor = page.getByRole("region", { name: EDITOR_WORDS.headingEdit });
      const toolbar = editor.getByRole("toolbar", { name: FORMATTING_WORDS.toolbar });
      const { toolbar: _own, ...buttons } = FORMATTING_WORDS;

      for (const name of Object.values(buttons)) {
        await toolbar.getByRole("button", { name, exact: true }).hover();
        await expect(page.getByRole("tooltip"), `${name} showed no tooltip`).toHaveText(name);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("tooltip")).toHaveCount(0);
      }
      await editor.getByRole("button", { name: EDITOR_WORDS.close }).click();
      await expect(editor).toHaveCount(0);
    });

    await test.step("picks from the workspace's types and saves a new one", async () => {
      await page.keyboard.press(EDITOR_KEYSTROKES.edit.key);
      const editor = page.getByRole("region", { name: EDITOR_WORDS.headingEdit });
      const field = editor.getByRole("combobox", { name: EDITOR_WORDS.conceptType });
      await field.click();
      const types = page.getByRole("listbox", { name: EDITOR_WORDS.conceptTypes });
      await expect(types.getByRole("option", { name: "Team", exact: true })).toBeVisible();
      await passesTheAccessibilityGate();

      const search = page.getByRole("combobox", { name: EDITOR_WORDS.searchConceptTypes });
      await search.fill("teams");
      await expect(types.getByRole("option"), "a plural of a listed type offered Add").toHaveText([
        "Team",
      ]);

      await search.fill(NEW_TYPE_AS_TYPED);
      await page.getByRole("option", { name: EDITOR_WORDS.addConceptType(NEW_TYPE) }).click();
      await expect(field).toHaveText(NEW_TYPE);
      await expect(field, "focus did not return to the type field").toBeFocused();

      await page.keyboard.down("Control");
      await page.keyboard.press("Enter");
      await page.keyboard.up("Control");
      await expect(editor, "the editor stayed open after the save").toHaveCount(0);

      await page.reload();
      await expect(typeOf(page, title)).toHaveText(NEW_TYPE);

      await page.keyboard.press(EDITOR_KEYSTROKES.edit.key);
      await editor.getByRole("combobox", { name: EDITOR_WORDS.conceptType }).click();
      await expect(types.getByRole("option", { name: NEW_TYPE, exact: true })).toBeVisible();
    });
  });

  test("the passkey offer sits under the concept title", async ({ page, request }) => {
    await aVirtualAuthenticator(page);
    const seeded = await aWorkspaceOfConcepts(request, "Kennet Offers");
    await page.goto(pageOf(seeded.concepts, COMMITTEE));
    await signIn(page, request, seeded.adminEmail);

    const concept = conceptOf(page, COMMITTEE);
    const offer = concept.getByRole("region", { name: PASSKEY_WORDS.heading });
    await expect(offer).toBeVisible();
    const title = await edges(concept.getByRole("heading", { level: 1 }));
    const offered = await edges(offer);
    expect(offered.top, "the offer is above the concept's title").toBeGreaterThanOrEqual(
      title.bottom,
    );
  });

  test("an Admin reads who checked and owns a concept", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const adminEmail = anAddress("admin");
    const workspace = await provision(request, { name: "Tay Leases", adminEmail });
    const owner = await person(request, anAddress("editor"), { displayName: "Ifan Morgan" });
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: owner.id,
      role: "Editor",
    });
    const writer = { workspaceId: workspace.workspaceId, userId: workspace.admin.id };
    const seeded = await conceptsSeeded(request, {
      ...writer,
      concepts: [
        {
          title: LEASE,
          collection: CONTRACTS,
          conceptType: "Contract",
          body: "The yard lease runs for ten years.",
          trust: "human-reviewed",
          sources: [{ title: LEASE_DOCUMENT, at: "p.3" }],
          frontmatter: { description: "The terms of the yard lease.", stale_after: "2027-03-01" },
        },
      ],
    });
    await nameOwners(request, {
      ...writer,
      owners: [{ collection: CONTRACTS, personId: owner.id }],
    });
    await page.goto("/sign-in");
    await signIn(page, request, adminEmail);
    await page.goto(pageOf(seeded, LEASE));
    await expect(conceptOf(page, LEASE)).toBeVisible();

    const rowOf = (label: string): Locator =>
      page
        .getByRole("complementary", { name: "About this concept" })
        .locator(`xpath=.//dt[normalize-space()="${label}"]/following-sibling::dd[1]`);
    await expect(rowOf("Trust")).toContainText(`Verified by ${workspace.admin.name}`);
    await expect(rowOf(CONCEPT_WORDS.titleBlock.checkedBy)).toContainText(workspace.admin.name);
    await expect(rowOf("Owner")).toContainText("Ifan Morgan");
    await expect(rowOf("Owner")).toContainText(
      CONCEPT_WORDS.titleBlock.ownerOf(collectionNameOf(CONTRACTS)),
    );
    await expect(rowOf("Review by")).toHaveText("1 March 2027");
    await expect(rowOf("Sources")).toHaveText("1");
    await expect(page.getByText(/details from the file/iu)).toHaveCount(0);
    await passesTheAccessibilityGate();
  });

  test("an Admin reads a concept's sources and links by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const seeded = await aWorkspaceOfConcepts(request, "Calder Registers");
    await signedInAsTheAdmin(page, request, seeded);

    const startedAtMs = Date.now();
    await page.goto(pageOf(seeded.concepts, RETENTION));
    await expect(conceptOf(page, RETENTION).getByText(CLAIM)).toBeVisible();
    const elapsedMs = Date.now() - startedAtMs;
    test.info().annotations.push({ type: "concept page", description: `${elapsedMs} ms` });
    expect(elapsedMs, "the concept took longer than its time budget to render").toBeLessThan(
      LIST_BUDGET_MS,
    );

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Search", KEY, [
      KEY.back.action,
      KEY.sources.action,
      KEY.links.action,
    ]);

    await page.keyboard.press(KEY.sources.key);
    await expect(sourcesOf(page).getByRole("heading", { name: "Sources" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(sourceLines(page).nth(0).getByRole("button", { name: POLICY })).toBeFocused();
    await page.keyboard.press("Enter");
    const panel = panelOf(page, POLICY);
    await expect(panel.getByRole("heading", { name: POLICY })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panel.getByRole("button", { name: "Close" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      sourceLines(page).nth(0).getByRole("button", { name: POLICY }),
      "Tab from the panel did not move focus back to the page",
    ).toBeFocused();
    await passesTheAccessibilityGate();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);

    await page.keyboard.press(KEY.links.key);
    await expect(page.getByRole("heading", { name: "Links" })).toBeFocused();
    await page.keyboard.press(KEY.back.key);
    await expect(page).toHaveURL(new RegExp(`${SEARCH.path}$`));
    await expect(
      page.getByRole("searchbox", { name: "Search by a word or a question" }),
    ).toBeVisible();

    await test.step("opens a source under its claim at 320 px", async () => {
      await page.setViewportSize({ width: 320, height: 720 });
      const concept = await atTheConcept(page, seeded, RETENTION);

      const mark = markOf(page, 1, POLICY);
      await mark.click();
      const inline = concept.getByRole("region", { name: POLICY });
      await expect(inline).toContainText(POLICY_PASSAGE);
      await expect(inline.getByRole("heading", { name: POLICY })).toBeFocused();
      await expect(panelOf(page, POLICY)).toHaveCount(0);
      const claim = await edges(concept.getByText(CLAIM));
      const next = await edges(concept.getByRole("heading", { name: "Who decides" }));
      const drawn = await edges(inline);
      expect(drawn.top, "the panel is not under its claim").toBeGreaterThanOrEqual(claim.bottom);
      expect(drawn.bottom, "the panel is not above the next heading").toBeLessThanOrEqual(next.top);
      expect(await scrolledSideways(page), "the page scrolls sideways at 320 px").toBe(0);

      await page.keyboard.press("Escape");
      await expect(inline).toHaveCount(0);
      await expect(mark).toBeFocused();

      const listed = sourceLines(page).nth(2).getByRole("button", { name: COMMITTEE });
      await listed.click();
      const listedInline = sourceLines(page).nth(2).getByRole("region", { name: COMMITTEE });
      await expect(listedInline).toContainText("The committee meets each quarter.");
      await listedInline.getByRole("button", { name: "Close" }).click();
      await expect(listedInline).toHaveCount(0);
      await expect(listed).toBeFocused();
    });
  });
});
