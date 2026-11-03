import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  provision,
  seedConcepts,
  seedQuestions,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  type SeedRecord,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const QUESTIONS = menuGroupIn(CONTROL_CENTRE, "questions");

const QUESTIONS_ASKED = pageNamed(QUESTIONS, "Questions Asked").path;

const QUESTIONS_PAGES = [
  ["Questions Asked", QUESTIONS_ASKED],
  ["Answer Tests", pageNamed(QUESTIONS, "Answer Tests").path],
] as const;

const AUDIT_CONCEPT = "Audit Logs Retention";

const questionsAsked = (page: Page) => page.getByRole("region", { name: "Questions Asked" });

const rowsOf = (region: Locator) => region.getByRole("listitem").getByRole("button");

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

const signedInAtTheQuestions = async (page: Page, api: APIRequestContext, at: AtTheQuestions) => {
  await page.goto("/sign-in");
  await signIn(page, api, at.adminEmail);
  await page
    .getByRole("navigation", { name: "Control Centre" })
    .getByRole("link", { name: "Questions Asked" })
    .click();
  await expect(page).toHaveURL(new RegExp(`${QUESTIONS_ASKED}$`));
};

const leadingLineOf = async (page: Page, name: string, path: string) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Questions" })).toBeVisible();
  const lead = page.getByRole("main").locator("h1 + p");
  await expect(lead, `${name}'s heading leads no line`).toHaveText(/\S/);
  return lead.innerText();
};

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
  test("renders a page of rows within the list budget", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await aPageAndOneMoreOpened(page, request, "Wharfe Pages");

    await test.step("leads the Questions group's pages with one line, auditing each", async () => {
      const lines = new Set<string>();
      for (const [name, path] of QUESTIONS_PAGES) {
        lines.add(await leadingLineOf(page, name, path));
        expect(lines.size, `${name} leads with a line of its own`).toBe(1);
        await passesTheAccessibilityGate();
      }
    });

    await test.step("renders a page of 50 rows within the list budget", async () => {
      const started = Date.now();
      await page.goto(QUESTIONS_ASKED);
      await expect(rowsOf(questionsAsked(page))).toHaveCount(50);
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "questions asked", description: `${elapsed} ms` });
      expect(elapsed, "a page of 50 questions rendered past its budget").toBeLessThan(
        LIST_BUDGET_MS,
      );
    });

    await test.step("reaches the first question by Tab from the skip link", async () => {
      await skipLinkReachesThePage(page);
      await tabUntilFocused(page, rowsOf(questionsAsked(page)).first());
    });
  });
});
