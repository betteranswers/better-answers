import assert from "node:assert/strict";

import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { YOUR_QUESTIONS_WORDS } from "@/features/ask/ask-words.ts";
import { ASK, menuGroupIn, pageById } from "@/shared/navigation.ts";
import { LIST_WORDS } from "@/shared/words.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  crumbOf,
  person,
  provision,
  seedConcepts,
  seedQuestions,
  signIn,
  skipLinkReachesThePage,
  tabUntilFocused,
  type SeedConcept,
  type SeedRecord,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const RECORD_BUDGET_MS = 1000;

const PAGE = pageById(menuGroupIn(ASK, "ask"), "your-questions");

const YOUR_QUESTIONS = PAGE.path;

const RETENTION = "Audit Logs Retention";

const MINUTES = "Board Minutes Policy";

const ANSWERED = "What is the audit log retention period?";

const FLAG_NOTE = "The retention period changed in March.";

const yourQuestions = (page: Page) =>
  page.getByRole("region", { name: pageById(menuGroupIn(ASK, "ask"), "your-questions").name });

const rowsOf = (region: Locator) => region.getByRole("listitem").getByRole("link");

type Member = { readonly id: string; readonly email: string; readonly name: string };

type AWorkspace = {
  readonly workspaceId: string;
  readonly admin: { readonly id: string };
  readonly editor: Member;
  readonly viewer: Member;
  readonly concepts: ReadonlyMap<string, string>;
};

const aMember = async (
  api: APIRequestContext,
  workspaceId: string,
  role: "Editor" | "Viewer",
): Promise<Member> => {
  const email = anAddress(role.toLowerCase());
  const name = `A ${role}`;
  const member = await person(api, email, { displayName: name });
  await addMember(api, { workspaceId, userId: member.id, role });
  return { id: member.id, email, name };
};

const CONCEPTS: readonly SeedConcept[] = [
  { title: RETENTION, collection: "audits", body: "We keep audit logs for seven years." },
  {
    title: MINUTES,
    collection: "board",
    body: "The board's minutes are kept by the company secretary.",
    audience: "groups",
    groupMemberIds: [],
  },
  {
    title: "Supplier Audits",
    collection: "audits",
    conceptType: "Policy",
    body: "Each supplier is audited once a year.",
    trust: "machine-confirmed",
  },
];

const aWorkspace = async (api: APIRequestContext, name: string): Promise<AWorkspace> => {
  const { workspaceId, admin } = await provision(api, { name });
  const { concepts } = await seedConcepts(api, {
    workspaceId,
    userId: admin.id,
    concepts: CONCEPTS,
  });
  return {
    workspaceId,
    admin: { id: admin.id },
    editor: await aMember(api, workspaceId, "Editor"),
    viewer: await aMember(api, workspaceId, "Viewer"),
    concepts: new Map(concepts.map((concept) => [concept.title, concept.iri])),
  };
};

const seeded = async (api: APIRequestContext, at: AWorkspace, records: readonly SeedRecord[]) =>
  (await seedQuestions(api, { workspaceId: at.workspaceId, records })).records.map(
    ({ recordId }) => recordId,
  );

const signedInAt = async (page: Page, api: APIRequestContext, member: Member, path: string) => {
  await page.goto(path);
  await signIn(page, api, member.email);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
};

test.describe("Your questions", () => {
  test("lists 50 questions within one second", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    const at = await aWorkspace(request, "Wharfe Pages");
    const retention = at.concepts.get(RETENTION);
    assert.ok(retention, "the harness did not seed the retention concept");
    const answered: SeedRecord = {
      askedBy: at.editor.id,
      question: ANSWERED,
      verdict: "ok",
      judgeState: "judged",
      concepts: [{ iri: retention, judged: "yes" }],
      drafted: [{ sentence: "We keep audit logs for seven years.", concepts: [retention] }],
      flags: [{ reason: "out-of-date", note: FLAG_NOTE }],
    };
    const refused = Array.from({ length: 50 }, (_, nth): SeedRecord => ({
      askedBy: at.editor.id,
      question: `Question number ${nth + 2}`,
      verdict: "refuse",
    }));
    await seeded(request, at, [answered, ...refused]);
    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);

    const started = Date.now();
    await page.goto(YOUR_QUESTIONS);
    await expect(rowsOf(yourQuestions(page))).toHaveCount(50);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "your questions", description: `${elapsed} ms` });
    expect(elapsed, "50 questions took longer than one second to render").toBeLessThan(
      LIST_BUDGET_MS,
    );
    await expect(rowsOf(yourQuestions(page)).first()).toHaveText("Question number 51");

    await test.step("reaches every row and Load More by keyboard alone", async () => {
      await skipLinkReachesThePage(page);
      await page.keyboard.press("Tab");
      await expect(rowsOf(yourQuestions(page)).first()).toBeFocused();
      const more = page
        .getByRole("navigation", { name: YOUR_QUESTIONS_WORDS.more })
        .getByRole("button", { name: LIST_WORDS.loadMore });
      await tabUntilFocused(page, more, 60);
      await passesTheAccessibilityGate();

      await page.keyboard.press("Enter");
      await expect(rowsOf(yourQuestions(page))).toHaveCount(51);
      await expect(rowsOf(yourQuestions(page)).last()).toBeFocused();
    });

    await test.step("opens a question within one second and goes back by keyboard", async () => {
      const opened = Date.now();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { level: 1, name: ANSWERED, exact: true }),
      ).toBeVisible();
      const drawn = Date.now() - opened;

      test.info().annotations.push({ type: "your record", description: `${drawn} ms` });
      expect(drawn, "the question took longer than one second to render").toBeLessThan(
        RECORD_BUDGET_MS,
      );
      await expect(page.getByText(FLAG_NOTE)).toBeVisible();

      const crumb = crumbOf(page, pageById(menuGroupIn(ASK, "ask"), "your-questions").name);
      await tabUntilFocused(page, crumb);
      await passesTheAccessibilityGate();

      await page.keyboard.press("Enter");
      await expect(page).toHaveURL((url) => url.pathname === YOUR_QUESTIONS);
      await expect(rowsOf(yourQuestions(page)).first()).toBeVisible();
    });
  });
});
