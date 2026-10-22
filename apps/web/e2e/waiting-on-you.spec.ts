import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  EDIT_KEYSTROKES,
  WAITING_KEYSTROKES as KEY,
  WAITING_ON_YOU,
} from "@/features/inbox/inbox-state.ts";
import { detailAt } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  ACTION_SAMPLES,
  actionClocked,
  addMember,
  anAddress,
  clockTheNextKey,
  commitAuthorsOf,
  crumbOf,
  nameOwners,
  notFoundOfferingHome,
  person,
  provision,
  railOf,
  seedEditSuggestion,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  theActionsLandedWithinTheirBudget,
} from "./harness.ts";
import { conceptsSeeded, listsItsKeystrokes, scrolledSideways } from "./knowledge.ts";

const LIST_BUDGET_MS = 1000;

const LIST_SAMPLES = 3;

const NARROW = { width: 320, height: 720 };

const PROPOSER = "Ifan Morgan";

const VIEWER = "Rhian Pryce";

const EDITOR = "Cerys Lloyd";

const LEAVE = "Annual leave";

const CLAIMS = "Expense claims";

const DRILLS = "Fire drills";

const RETENTION = "Record retention";

const MINUTES_DOCUMENT = "Board minutes, March 2026";

const MINUTES = "board-minutes.pdf";

const MINUTES_PASSAGE = "The board agreed to keep payroll records for nine years.";

const REASON = "The figure is from last year";

type Member = { readonly id: string; readonly email: string };

type Seeded = Awaited<ReturnType<typeof conceptsSeeded>>;

type Owned = Parameters<typeof nameOwners>[1]["owners"][number];

type SeedConcept = Parameters<typeof conceptsSeeded>[1]["concepts"][number];

type Deciding = {
  readonly workspaceId: string;
  readonly admin: Member;
  readonly proposer: Member;
  readonly viewer: Member;
  readonly editor: Member;
  readonly concepts: Seeded;
  readonly iriOf: (title: string) => string;
};

const RETAINED: SeedConcept = {
  title: RETENTION,
  collection: "policies",
  body: "Payroll records are kept for nine years.",
  sources: [
    {
      title: MINUTES_DOCUMENT,
      label: MINUTES,
      passages: [MINUTES_PASSAGE],
      sensitivity: "Restricted",
    },
  ],
};

const aDecidingWorkspace = async (
  api: APIRequestContext,
  name: string,
  further: readonly SeedConcept[] = [],
): Promise<Deciding> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const joined = async (role: "Editor" | "Viewer", displayName: string): Promise<Member> => {
    const made = await person(api, anAddress(role.toLowerCase()), { displayName });
    await addMember(api, { workspaceId, role, userId: made.id });
    return made;
  };
  const proposer = await joined("Editor", PROPOSER);
  const viewer = await joined("Viewer", VIEWER);
  const editor = await joined("Editor", EDITOR);
  const concepts = await conceptsSeeded(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      { title: LEAVE, collection: "policies", body: "Everyone takes 25 days of leave." },
      { title: CLAIMS, collection: "policies", body: "Claims go in within 30 days." },
      { title: DRILLS, collection: "safety", body: "A fire drill runs each quarter." },
      ...further,
    ],
  });
  const iriOf = (title: string): string => {
    const iri = concepts.get(title)?.iri;
    if (iri === undefined) throw new Error(`${title} was not seeded`);
    return iri;
  };
  return {
    workspaceId,
    admin: { id: workspace.admin.id, email: adminEmail },
    proposer,
    viewer,
    editor,
    concepts,
    iriOf,
  };
};

const ownersNamed = (api: APIRequestContext, at: Deciding, owners: readonly Owned[]) =>
  nameOwners(api, { workspaceId: at.workspaceId, userId: at.admin.id, owners });

const suggested = (api: APIRequestContext, at: Deciding, title: string, body: string) =>
  seedEditSuggestion(api, {
    workspaceId: at.workspaceId,
    userId: at.proposer.id,
    iri: at.iriOf(title),
    body,
  });

const authorsOf = async (api: APIRequestContext, at: Deciding, title: string) =>
  (await commitAuthorsOf(api, { workspaceId: at.workspaceId, iri: at.iriOf(title) })).authors;

const itemAt = (suggestionId: string): string => detailAt(WAITING_ON_YOU, suggestionId);

const signedIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
};

const waiting = (page: Page): Locator => page.getByRole("region", { name: "Waiting on You" });

const rowTitles = (page: Page): Locator => waiting(page).getByRole("heading", { level: 3 });

const rowLink = (page: Page, title: string): Locator =>
  waiting(page).getByRole("link", { name: title, exact: true });

const tickOf = (page: Page, title: string): Locator =>
  waiting(page).getByRole("checkbox", { name: `Select ${title}` });

const said = (page: Page): Locator => waiting(page).getByRole("status").nth(1);

const ownerAt = (title: string): string =>
  `(//li[.//h3[.='${title}']]//dt[.='Owner'])[1]/following-sibling::dd[1]`;

const SAID_AT = "(//section[.//h2[.='Waiting on You']]//output)[2]";

const itemOf = (page: Page, title: string): Locator => page.getByRole("article", { name: title });

const answered = async (page: Page, procedure: "accept" | "decline", act: () => Promise<void>) => {
  const answer = page.waitForResponse((each) => each.url().includes(`inbox.${procedure}`));
  await act();
  expect((await answer).ok(), `the ${procedure} was refused`).toBe(true);
};

const declinedWithAReason = async (page: Page, title: string): Promise<void> => {
  const item = itemOf(page, title);
  await item.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(item.getByLabel("Reason for Declining")).toBeFocused();
  await page.keyboard.type(REASON);
  await answered(page, "decline", () =>
    item.getByRole("button", { name: "Decline Suggestion" }).click(),
  );
};

const signedInAtTheList = async (page: Page, api: APIRequestContext, email: string) => {
  await signedIn(page, api, email);
  await page.goto(WAITING_ON_YOU.path);
  await expect(waiting(page).getByRole("heading", { level: 2 })).toBeVisible();
};

test.describe("Waiting on You", () => {
  test("a Viewer owning a collection accepts, the proposer authoring it", async ({
    page,
    request,
  }) => {
    const at = await aDecidingWorkspace(request, "Teme Valley Surveys");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.viewer.id }]);
    await suggested(request, at, LEAVE, "Everyone takes 28 days of leave.");
    await signedIn(page, request, at.viewer.email);

    await expect(railOf(page).getByRole("link", { name: "Inbox" })).toBeVisible();
    await railOf(page).getByRole("link", { name: "Inbox" }).click();
    await expect(rowTitles(page)).toHaveText([LEAVE]);
    await expect(waiting(page)).toMatchAriaSnapshot(`
      - region "Waiting on You":
        - heading "Waiting on You" [level=2]
        - status: /\\b1\\b/
        - button "Accept Selected"
        - status
        - list:
          - listitem ${JSON.stringify(LEAVE)}:
            - checkbox ${JSON.stringify(`Select ${LEAVE}`)}
            - heading ${JSON.stringify(LEAVE)} [level=3]:
              - link ${JSON.stringify(LEAVE)}
            - term: Suggested By
            - definition: ${JSON.stringify(PROPOSER)}
            - term: Suggested On
            - definition
    `);

    await tickOf(page, LEAVE).check();
    await answered(page, "accept", () =>
      waiting(page).getByRole("button", { name: "Accept Selected" }).click(),
    );

    await expect(said(page)).toContainText(PROPOSER);
    await expect(rowTitles(page)).toHaveCount(0);
    const [newest] = await authorsOf(request, at, LEAVE);
    expect(newest, "the newest commit is not the proposer's").toContain(PROPOSER);
  });

  test("an Editor owner declines with a reason, leaving the list", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Wye Gorge Partners");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.editor.id }]);
    const { suggestionId } = await suggested(request, at, CLAIMS, "Claims go in within 60 days.");
    await signedInAtTheList(page, request, at.editor.email);

    await rowLink(page, CLAIMS).click();
    await expect(page).toHaveURL(new RegExp(`${itemAt(suggestionId)}$`));
    await declinedWithAReason(page, CLAIMS);

    await expect(page).toHaveURL(new RegExp(`${WAITING_ON_YOU.path}$`));
    await expect(said(page)).toContainText(PROPOSER);
    await expect(rowTitles(page)).toHaveCount(0);
    await expect(authorsOf(request, at, CLAIMS)).resolves.not.toContainEqual(
      expect.stringContaining(PROPOSER),
    );
  });

  test("a Viewer owning nothing finds no Inbox and no item", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Lugg Meadow Supplies");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.editor.id }]);
    const { suggestionId } = await suggested(request, at, LEAVE, "Leave is 30 days.");
    await signedIn(page, request, at.viewer.email);

    await expect(railOf(page).getByRole("link")).toHaveText(["Ask", "Knowledge"]);
    await page.goto(WAITING_ON_YOU.path);
    await notFoundOfferingHome(page, "Viewer");
    await page.goto(itemAt(suggestionId));
    await notFoundOfferingHome(page, "Viewer");
  });

  test("an owner of one concept sees its suggestion alone", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Arrow Valley Joinery");
    await ownersNamed(request, at, [{ iri: at.iriOf(CLAIMS), personId: at.viewer.id }]);
    await suggested(request, at, LEAVE, "Leave is 30 days.");
    await suggested(request, at, CLAIMS, "Claims go in within a week.");
    await signedIn(page, request, at.viewer.email);

    await railOf(page).getByRole("link", { name: "Inbox" }).click();
    await expect(rowTitles(page)).toHaveText([CLAIMS]);
  });

  test("an Admin sees every edit, owners named, deciding by address", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Clun Forest Herbs");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.viewer.id }]);
    const owned = await suggested(request, at, LEAVE, "Leave is 30 days.");
    await suggested(request, at, DRILLS, "A fire drill runs each month.");

    await signedInAtTheList(page, request, at.viewer.email);
    await expect(rowTitles(page)).toHaveText([LEAVE]);
    await page.context().clearCookies();

    await signedInAtTheList(page, request, at.admin.email);
    await expect(rowTitles(page)).toHaveText([LEAVE, DRILLS]);
    await expect(page.locator(ownerAt(LEAVE))).toHaveText(VIEWER);
    await expect(page.locator(ownerAt(DRILLS))).toHaveText(/\S/);
    await expect(page.locator(ownerAt(DRILLS))).not.toContainText(VIEWER);

    await page.goto(itemAt(owned.suggestionId));
    await declinedWithAReason(page, LEAVE);
    await expect(said(page)).toContainText(PROPOSER);
    await expect(rowTitles(page)).toHaveText([DRILLS]);
  });

  test("returns a suggestion to its proposer once the concept moved", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Onny Mill Textiles");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.viewer.id }]);
    const first = await suggested(request, at, LEAVE, "Leave is 28 days.");
    const second = await suggested(request, at, LEAVE, "Leave is 30 days.");
    await signedIn(page, request, at.viewer.email);

    await page.goto(itemAt(first.suggestionId));
    await answered(page, "accept", () =>
      itemOf(page, LEAVE).getByRole("button", { name: "Accept", exact: true }).click(),
    );
    await expect(said(page)).toContainText(PROPOSER);
    const authorsBefore = await authorsOf(request, at, LEAVE);

    await page.goto(itemAt(second.suggestionId));
    await answered(page, "accept", () =>
      itemOf(page, LEAVE).getByRole("button", { name: "Accept", exact: true }).click(),
    );
    await expect(page).toHaveURL(new RegExp(`${WAITING_ON_YOU.path}$`));
    await expect(said(page)).toContainText(PROPOSER);
    await expect(rowTitles(page)).toHaveCount(0);
    expect(await authorsOf(request, at, LEAVE), "the returned suggestion committed").toEqual(
      authorsBefore,
    );
  });

  test("shows a withheld source as words, its document nowhere", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Teme Bridge Bakery", [RETAINED]);
    await ownersNamed(request, at, [{ collection: "policies", personId: at.viewer.id }]);
    const { suggestionId } = await suggested(request, at, RETENTION, "Records are kept ten years.");
    await signedIn(page, request, at.viewer.email);

    await page.goto(itemAt(suggestionId));
    const sources = itemOf(page, RETENTION).getByRole("region", { name: "Suggested Sources" });
    await expect(sources.getByRole("listitem")).toHaveText([new RegExp(MINUTES)]);
    await expect(sources.getByRole("link")).toHaveCount(0);

    const [withheld] = at.concepts.get(RETENTION)?.documents.map((cited) => cited.documentId) ?? [];
    expect(withheld, "the harness named no Restricted document").toEqual(expect.any(String));
    const drawn = await page.content();
    for (const hidden of [withheld, MINUTES_DOCUMENT, MINUTES_PASSAGE]) {
      expect(drawn, `the page holds ${String(hidden)}`).not.toContain(hidden);
    }
  });

  test("an Editor owner bulk-accepts by keyboard alone at 320px", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Corve Dale Cider");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.editor.id }]);
    await suggested(request, at, LEAVE, "Leave is 30 days.");
    await suggested(request, at, CLAIMS, "Claims go in within a week.");
    await page.setViewportSize(NARROW);
    await signedInAtTheList(page, request, at.editor.email);

    await skipLinkReachesThePage(page);
    await listsItsKeystrokes(page, "Waiting on You", KEY, [
      "Select or Clear the Suggestion in Focus",
      "Accept the Selected Suggestions",
    ]);
    await tabUntilFocused(page, rowLink(page, LEAVE));
    await page.keyboard.press(KEY.tick.key);
    await expect(tickOf(page, LEAVE)).toBeChecked();
    await tabUntilFocused(page, rowLink(page, CLAIMS));
    await page.keyboard.press(KEY.tick.key);
    await expect(tickOf(page, CLAIMS)).toBeChecked();
    await answered(page, "accept", () => page.keyboard.press(`Shift+${KEY.acceptSelected.key}`));

    await expect(said(page)).toContainText(LEAVE);
    await expect(said(page)).toContainText(CLAIMS);
    await expect(rowTitles(page)).toHaveCount(0);
    expect(await scrolledSideways(page), "the list scrolls sideways at 320px").toBe(0);
  });

  test("an item's link survives sign-in, and Back refocuses its row", async ({ page, request }) => {
    const at = await aDecidingWorkspace(request, "Kemp Valley Builders");
    await ownersNamed(request, at, [{ collection: "policies", personId: at.viewer.id }]);
    const { suggestionId } = await suggested(request, at, CLAIMS, "Claims go in within a week.");

    await page.goto(itemAt(suggestionId));
    await signIn(page, request, at.viewer.email);
    await expect(itemOf(page, CLAIMS)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${itemAt(suggestionId)}$`));
    await expect(crumbOf(page, CLAIMS)).toBeVisible();
    await listsItsKeystrokes(page, "Waiting on You", EDIT_KEYSTROKES, ["Accept This Suggestion"]);

    await itemOf(page, CLAIMS).getByRole("link", { name: "Back to Waiting on You" }).click();
    await expect(rowLink(page, CLAIMS)).toBeFocused();
  });

  test("renders within its budget", async ({ page, request }) => {
    test.slow();
    const collections = ["policies", "safety", "finance", "people", "estates"];
    const adminEmail = anAddress("admin");
    const workspace = await provision(request, { name: "Rhondda Valley Logistics", adminEmail });
    const { workspaceId } = workspace;
    const proposer = await person(request, anAddress("editor"), { displayName: PROPOSER });
    await addMember(request, { workspaceId, userId: proposer.id, role: "Editor" });
    const concepts = await conceptsSeeded(request, {
      workspaceId,
      userId: workspace.admin.id,
      concepts: collections.flatMap((collection) =>
        [1, 2].map((at) => ({
          title: `${collection} rule ${String(at)}`,
          collection,
          body: `The ${collection} rule ${String(at)} holds.`,
        })),
      ),
    });
    const titles = [...concepts.keys()];
    for (const title of titles) {
      for (const draft of [1, 2, 3, 4, 5]) {
        await seedEditSuggestion(request, {
          workspaceId,
          userId: proposer.id,
          iri: concepts.get(title)?.iri ?? "",
          body: `Draft ${String(draft)} of ${title}.`,
        });
      }
    }
    await signedIn(page, request, adminEmail);

    const rendered: number[] = [];
    for (let sample = 0; sample < LIST_SAMPLES; sample += 1) {
      const started = Date.now();
      await page.goto(WAITING_ON_YOU.path);
      await expect(rowTitles(page)).toHaveCount(50);
      rendered.push(Date.now() - started);
    }
    const median = rendered.toSorted((one, other) => one - other)[1] ?? Infinity;
    test.info().annotations.push({
      type: "waiting on you",
      description: `${rendered.map((elapsed) => `${String(elapsed)} ms`).join(", ")}; median ${String(median)} ms`,
    });
    expect(median, "the list rendered past its budget").toBeLessThan(LIST_BUDGET_MS);

    const clocked: number[] = [];
    for (const title of titles.slice(0, ACTION_SAMPLES)) {
      await tickOf(page, title).first().check();
      await clockTheNextKey(page, { at: SAID_AT, reads: title });
      await answered(page, "accept", async () => {
        await page.keyboard.press(`Shift+${KEY.acceptSelected.key}`);
        clocked.push(await actionClocked(page));
      });
      await expect(said(page)).toContainText(PROPOSER);
    }
    theActionsLandedWithinTheirBudget("accepting a suggestion", clocked);
  });
});
