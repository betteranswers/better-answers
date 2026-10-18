import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { QUESTIONS_KEYSTROKES as KEY } from "@/features/questions/questions-state.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  A_ROLE,
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextKey,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  notFoundOfferingHome,
  person,
  provision,
  saysARefusal,
  seedConcepts,
  seedQuestions,
  signIn,
  theActionLandedWithinItsBudget,
  type SeedRecord,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const QUESTIONS_ASKED = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Questions Asked").path;

const AUDIT_CONCEPT = "Audit Logs Retention";

const SECRET_CONCEPT = "Acquisition Plans";

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
  const insider = await person(api, anAddress("insider"), { displayName: "Ines Insider" });
  await addMember(api, { workspaceId, userId: insider.id, role: "Viewer" });
  const seeded = await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [
      {
        title: AUDIT_CONCEPT,
        collection: "audits",
        body: "We keep audit logs for seven years, then delete them.",
      },
      {
        title: SECRET_CONCEPT,
        collection: "secret-plans",
        body: "We plan to buy a competitor next year.",
        audience: "groups",
        groupMemberIds: [insider.id],
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
  test("shows a record flagged over MCP first, with its flag", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Holme Valley Audits");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: aFlagAndANewerQuestion(at),
    });

    await signedInAtTheQuestions(page, request, at);

    await expect(rowsOf(questionsAsked(page))).toHaveText([FLAGGED_QUESTION, NEWER_QUESTION]);
    await expect(rowsOf(groupNamed(page, "Flagged"))).toHaveText([FLAGGED_QUESTION]);

    await rowsOf(groupNamed(page, "Flagged")).first().click();
    const record = recordOf(page, FLAGGED_QUESTION);
    await expect(record.getByText(/Wrong/)).toBeVisible();
    await expect(record.getByText(DISPUTED)).toBeVisible();
    await expect(record.getByRole("link", { name: AUDIT_CONCEPT })).toHaveCount(2);
  });

  test("shows no total of questions anywhere", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Calder Counts");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: aFlagAndANewerQuestion(at),
    });

    await signedInAtTheQuestions(page, request, at);

    await expect(rowsOf(questionsAsked(page))).toHaveCount(2);
    await expect(questionsAsked(page).locator("output").first()).toHaveText("");
    await expect(page.getByRole("main")).not.toContainText(/\b[0-9]+ (question|record)s?\b/i);
  });

  test("groups refusals under collections the Admin can read", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Swale Refusals");
    const refused = (question: string, concepts: readonly string[]): SeedRecord => ({
      question,
      verdict: "refuse",
      concepts: concepts.map((title) => ({ iri: iriOf(at, title) })),
    });
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: [
        refused("Matched nothing at all", []),
        refused("Matched the secret plans", [SECRET_CONCEPT]),
        refused("Matched the audit logs", [AUDIT_CONCEPT]),
      ],
    });

    await signedInAtTheQuestions(page, request, at);

    const notAnswered = groupNamed(page, "Not Answered");
    await expect(notAnswered.getByRole("heading", { level: 4 })).toHaveText([
      "audits",
      "No Collection",
    ]);
    await expect(rowsOf(groupNamed(page, "audits"))).toHaveText(["Matched the audit logs"]);
    await expect(rowsOf(groupNamed(page, "No Collection"))).toHaveText([
      "Matched the secret plans",
      "Matched nothing at all",
    ]);
    await expect(page.getByText("secret-plans")).toHaveCount(0);
  });

  test("shows an erased record's verdict, concepts and flag", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Ryedale Erasures");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: [
        {
          question: null,
          verdict: "ok",
          concepts: [{ iri: iriOf(at, AUDIT_CONCEPT) }],
          flags: [{ reason: "out-of-date", disputedConcept: iriOf(at, AUDIT_CONCEPT) }],
        },
      ],
    });

    await signedInAtTheQuestions(page, request, at);

    const row = rowsOf(groupNamed(page, "Flagged"));
    await expect(row).toHaveCount(1);
    await expect(row, "no line stands for the removed question").toHaveText(/\S/);
    await expect(groupNamed(page, "Flagged")).toContainText(/former member/i);
    await row.click();
    const record = page.getByRole("dialog");
    await expect(record).toContainText(/former member/i);
    await expect(record.getByText("Answered", { exact: true })).toBeVisible();
    await expect(record.getByText(/Out of date/)).toBeVisible();
    await expect(record.getByRole("link", { name: AUDIT_CONCEPT })).toHaveCount(2);
  });

  test("closes a flag within its budget, unflagging the record", async ({ page, request }) => {
    const at = await aWorkspaceWithConcepts(request, "Nidd Closings");
    await seedQuestions(request, {
      workspaceId: at.workspaceId,
      records: aFlagAndANewerQuestion(at),
    });
    await signedInAtTheQuestions(page, request, at);

    await rowsOf(groupNamed(page, "Flagged")).first().click();
    const record = recordOf(page, FLAGGED_QUESTION);
    const fixed = record
      .getByRole("group", { name: "Close This Flag" })
      .getByRole("button", { name: "Fixed in the Knowledge" });
    await fixed.focus();
    await clockTheNextKey(page, {
      at: "//main//section[h3='Other Questions']",
      reads: FLAGGED_QUESTION,
    });
    await page.keyboard.press("Enter");
    await theActionLandedWithinItsBudget(page, "close a flag");

    await expect(record.getByText(/Fixed in the knowledge/)).toBeVisible();
    await expect(record.getByRole("group", { name: "Close This Flag" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(groupNamed(page, "Flagged")).toHaveCount(0);

    await page.reload();
    await expect(rowsOf(groupNamed(page, "Other Questions"))).toHaveText([
      NEWER_QUESTION,
      FLAGGED_QUESTION,
    ]);
    await expect(groupNamed(page, "Flagged")).toHaveCount(0);
  });

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

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${A_ROLE[role]} the questions asked as not found`, async ({ page, request }) => {
      await aMemberSignedInAt(page, request, role, QUESTIONS_ASKED);

      await notFoundOfferingHome(page, role);
      await expect(questionsAsked(page)).toHaveCount(0);
    });
  }
});
