import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { QUESTIONS_KEYSTROKES as KEY } from "@/features/questions/questions-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  provision,
  saysARefusal,
  seedConcepts,
  seedQuestions,
  signIn,
  type SeedRecord,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const QUESTIONS_ASKED = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Questions Asked").path;

const AUDIT_CONCEPT = "Audit Logs Retention";

const FLAGGED_QUESTION = "How long do you keep audit logs for buyers?";

const NEWER_QUESTION = "Who can see the audit log?";

const DISPUTED = "Audit logs are kept for one year.";

const questionsAsked = (page: Page) => page.getByRole("region", { name: "Questions Asked" });

const groupNamed = (page: Page, name: string) =>
  questionsAsked(page).getByRole("region", { name, exact: true });

const rowsOf = (region: Locator) => region.getByRole("listitem").getByRole("button");

const recordOf = (page: Page, question: string) => page.getByRole("dialog", { name: question });

type AtTheQuestions = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly concepts: ReadonlyMap<string, string>;
};

const aWorkspaceWithConcepts = async (
  api: APIRequestContext,
  name: string,
): Promise<AtTheQuestions> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name, adminEmail });
  const { workspaceId } = workspace;
  const seeded = await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      {
        title: AUDIT_CONCEPT,
        collection: "audits",
        body: "We keep audit logs for seven years, then delete them.",
      },
    ],
  });
  return {
    workspaceId,
    adminId: workspace.admin.id,
    adminEmail,
    concepts: new Map(seeded.concepts.map((concept) => [concept.title, concept.iri])),
  };
};

const iriOf = (at: AtTheQuestions, title: string): string => {
  const iri = at.concepts.get(title);
  if (iri === undefined) throw new Error(`no concept titled ${title} was seeded`);
  return iri;
};

const signedInAtTheQuestions = async (page: Page, api: APIRequestContext, at: AtTheQuestions) => {
  await page.goto("/sign-in");
  await signIn(page, api, at.adminEmail);
  await page
    .getByRole("navigation", { name: "Control Centre" })
    .getByRole("link", { name: "Questions Asked" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${QUESTIONS_ASKED}$`));
};

const aFlagAndANewerQuestion = (at: AtTheQuestions): readonly SeedRecord[] => [
  {
    askedBy: at.adminId,
    transport: "mcp",
    question: FLAGGED_QUESTION,
    verdict: "ok",
    judgeState: "judged",
    concepts: [{ iri: iriOf(at, AUDIT_CONCEPT), judged: "yes" }],
    flags: [
      { reason: "wrong", disputedSentence: DISPUTED, disputedConcept: iriOf(at, AUDIT_CONCEPT) },
    ],
  },
  { askedBy: at.adminId, question: NEWER_QUESTION, verdict: "related" },
];

const aPageAndOneMoreOpened = async (page: Page, api: APIRequestContext, name: string) => {
  const at = await aWorkspaceWithConcepts(api, name);
  const records = Array.from({ length: 51 }, (_, nth): SeedRecord => ({
    question: `Question number ${nth + 1}`,
    verdict: "ok",
  }));
  await seedQuestions(api, { workspaceId: at.workspaceId, records });
  await signedInAtTheQuestions(page, api, at);
};

test.describe("Questions asked", () => {
  test("a refused closing puts the flag back and says so", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Colne Refusals");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: aFlagAndANewerQuestion(at),
    });
    await signedInAtTheQuestions(page, request, at);
    await page.route(
      (url) => url.pathname.includes("questions.closeFlag"),
      (route) => route.abort(),
    );

    await rowsOf(groupNamed(page, "Flagged")).first().click();
    const record = recordOf(page, FLAGGED_QUESTION);
    const closing = record.getByRole("group", { name: "Close This Flag" });
    await closing.getByRole("button", { name: "No Fault in the Knowledge" }).click();

    await saysARefusal(record.getByRole("alert"));
    await expect(closing.getByRole("button", { name: "Fixed in the Knowledge" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(record).toHaveCount(0);
    await expect(rowsOf(groupNamed(page, "Flagged"))).toHaveText([FLAGGED_QUESTION]);
  });

  test("renders a page of rows within the list budget", async ({ page, request }) => {
    await aPageAndOneMoreOpened(page, request, "Wharfe Pages");

    const started = Date.now();
    await page.goto(QUESTIONS_ASKED);
    await expect(rowsOf(questionsAsked(page))).toHaveCount(50);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "questions asked", description: `${elapsed} ms` });
    expect(elapsed, "a page of 50 questions rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
  });

  test("opens no question by key after focus leaves the list", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Holme Keys");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: aFlagAndANewerQuestion(at),
    });
    await signedInAtTheQuestions(page, request, at);
    const region = questionsAsked(page);
    const saying = region.getByRole("status").filter({ hasText: /\S/ });
    await expect(saying, "the list says nothing at rest").toHaveCount(0);
    await rowsOf(region).first().focus();
    await region.getByRole("heading", { level: 2 }).focus();

    await page.keyboard.press(KEY.open.key);
    await expect(saying, "a keystroke with no question in focus says nothing").toHaveCount(1);
    await expect(recordOf(page, FLAGGED_QUESTION)).toHaveCount(0);
  });

  test("lists, opens and pages the questions by keyboard", async ({ page, request }) => {
    await aPageAndOneMoreOpened(page, request, "Aire Keys");
    await expect(rowsOf(questionsAsked(page))).toHaveCount(50);

    const keystrokes = await keystrokesListed(page, "Questions Asked");
    for (const { key } of Object.values(KEY)) {
      await expect(keyListed(keystrokes, key)).toBeVisible();
    }
    await keystrokesDismissed(page, keystrokes);

    await page.keyboard.press(KEY.more.key);
    await expect(rowsOf(questionsAsked(page))).toHaveCount(51);
    const oldest = rowsOf(questionsAsked(page)).nth(50);
    await expect(oldest, "focus did not land on the first older question").toBeFocused();
    await expect(oldest).toHaveText("Question number 1");

    await page.keyboard.press(KEY.open.key);
    const record = recordOf(page, "Question number 1");
    await expect(record).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(record).toHaveCount(0);
    await expect(oldest).toBeFocused();
  });
});
