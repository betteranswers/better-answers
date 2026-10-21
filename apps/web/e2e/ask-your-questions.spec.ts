import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ASK, detailAt, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  aMemberSignedInAt,
  anAddress,
  notFoundOfferingHome,
  person,
  provision,
  removeMember,
  seedConcepts,
  seedQuestions,
  signIn,
  signOutFromTheShell,
  type SeedConcept,
  type SeedRecord,
} from "./harness.ts";
import { refusalAnswering } from "./refused-read.ts";

const LIST_BUDGET_MS = 1000;

const PAGE = pageNamed(menuGroupIn(ASK, "ask"), "Your Questions");

const YOUR_QUESTIONS = PAGE.path;

const RETENTION = "Audit Logs Retention";

const MINUTES = "Board Minutes Policy";

const yourQuestions = (page: Page) => page.getByRole("region", { name: "Your Questions" });

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
    kind: "Policy",
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

const iriOf = (at: AWorkspace, title: string): string => {
  const iri = at.concepts.get(title);
  if (iri === undefined) throw new Error(`no concept titled ${title} was seeded`);
  return iri;
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

const recordOpened = async (page: Page, question: string) => {
  await rowsOf(yourQuestions(page)).filter({ hasText: question }).click();
  await expect(page.getByRole("heading", { level: 2, name: question })).toBeVisible();
};

test.describe("Your questions", () => {
  test("two members of one workspace each see only their own", async ({ page, request }) => {
    const at = await aWorkspace(request, "Holme Askers");
    await seeded(request, at, [
      { askedBy: at.editor.id, question: "What does the editor ask?", verdict: "refuse" },
      { askedBy: at.viewer.id, question: "What does the viewer ask?", verdict: "refuse" },
      { askedBy: at.admin.id, question: "What does the admin ask?", verdict: "refuse" },
    ]);

    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);
    await expect(rowsOf(yourQuestions(page))).toHaveText(["What does the editor ask?"]);
    await signOutFromTheShell(page, at.editor.name);
    await expect(page).toHaveURL(/\/sign-in/);

    await signedInAt(page, request, at.viewer, YOUR_QUESTIONS);
    await expect(rowsOf(yourQuestions(page))).toHaveText(["What does the viewer ask?"]);
  });

  test("shows a question without the Answer the reader cannot read", async ({ page, request }) => {
    const at = await aWorkspace(request, "Calder Narrowing");
    await seeded(request, at, [
      {
        askedBy: at.editor.id,
        question: "How long are audit logs kept?",
        verdict: "ok",
        judgeState: "judged",
        concepts: [
          { iri: iriOf(at, MINUTES), judged: "yes" },
          { iri: iriOf(at, RETENTION), judged: "yes" },
        ],
      },
    ]);

    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);
    await recordOpened(page, "How long are audit logs kept?");

    const main = page.getByRole("main");
    await expect(main.getByRole("article")).toHaveCount(1);
    await expect(main.getByRole("heading", { name: RETENTION })).toBeVisible();
    await expect(main).not.toContainText(MINUTES);
  });

  test("a reader who asked nothing is offered New Question", async ({ page, request }) => {
    await aMemberSignedInAt(page, request, "Viewer", YOUR_QUESTIONS);

    const region = yourQuestions(page);
    await expect(rowsOf(region)).toHaveCount(0);
    await expect(region.getByRole("link", { name: "New Question" })).toHaveAttribute(
      "href",
      "/ask/new-question",
    );
  });

  test("drops a sentence citing what the asker cannot read", async ({ page, request }) => {
    const at = await aWorkspace(request, "Swale Drafts");
    const before = "Audit logs are kept for seven years.";
    const hidden = "The board keeps its own minutes.";
    const after = "Each audit is filed with the log.";
    await seeded(request, at, [
      {
        askedBy: at.editor.id,
        question: "Where are the audit logs kept?",
        verdict: "related",
        concepts: [{ iri: iriOf(at, RETENTION) }, { iri: iriOf(at, MINUTES) }],
        drafted: [
          { sentence: before, concepts: [iriOf(at, RETENTION)] },
          { sentence: hidden, concepts: [iriOf(at, MINUTES)] },
          { sentence: after, concepts: [iriOf(at, RETENTION)] },
        ],
      },
    ]);

    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);
    await recordOpened(page, "Where are the audit logs kept?");

    const main = page.getByRole("main");
    await expect(main.getByText(before)).toBeVisible();
    await expect(main.getByText(after)).toBeVisible();
    await expect(main.getByText(hidden)).toHaveCount(0);
  });

  test("opens another person's record as the not-found page", async ({ page, request }) => {
    const at = await aWorkspace(request, "Ryedale Records");
    const [theirs] = await seeded(request, at, [
      { askedBy: at.admin.id, question: "What did the admin ask?", verdict: "refuse" },
    ]);
    await signedInAt(page, request, at.viewer, YOUR_QUESTIONS);

    const refused = refusalAnswering(page, "ask.yourRecord");
    await page.goto(detailAt(PAGE, theirs ?? ""));

    expect(await refused).toMatchObject({ status: 404, word: "not-found" });
    await notFoundOfferingHome(page, "Viewer");
    await expect(page.getByRole("main")).not.toContainText("What did the admin ask?");
  });

  test("renders a page of rows within the list budget", async ({ page, request }) => {
    const at = await aWorkspace(request, "Wharfe Pages");
    await seeded(
      request,
      at,
      Array.from({ length: 51 }, (_, nth): SeedRecord => ({
        askedBy: at.editor.id,
        question: `Question number ${nth + 1}`,
        verdict: "refuse",
      })),
    );
    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);

    const started = Date.now();
    await page.goto(YOUR_QUESTIONS);
    await expect(rowsOf(yourQuestions(page))).toHaveCount(50);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "your questions", description: `${elapsed} ms` });
    expect(elapsed, "a page of 50 questions rendered past its budget").toBeLessThan(LIST_BUDGET_MS);
    await expect(rowsOf(yourQuestions(page)).first()).toHaveText("Question number 51");
  });

  test("a reader whose role changed still sees their questions", async ({ page, request }) => {
    const at = await aWorkspace(request, "Nidd Roles");
    await seeded(request, at, [
      { askedBy: at.viewer.id, question: "What did I ask as a Viewer?", verdict: "refuse" },
    ]);
    await removeMember(request, { workspaceId: at.workspaceId, userId: at.viewer.id });
    await addMember(request, { workspaceId: at.workspaceId, userId: at.viewer.id, role: "Editor" });

    await signedInAt(page, request, at.viewer, YOUR_QUESTIONS);

    await expect(rowsOf(yourQuestions(page))).toHaveText(["What did I ask as a Viewer?"]);
  });

  test("words a cited concept's trust as it is now", async ({ page, request }) => {
    const at = await aWorkspace(request, "Colne Trust");
    await seeded(request, at, [
      {
        askedBy: at.editor.id,
        question: "How often are suppliers audited?",
        verdict: "related",
        concepts: [{ iri: iriOf(at, "Supplier Audits") }],
      },
    ]);

    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);
    await recordOpened(page, "How often are suppliers audited?");

    const main = page.getByRole("main");
    await expect(main.getByText(/^Verified automatically/)).toBeVisible();
    await expect(main.getByText("Unverified", { exact: true })).toHaveCount(0);
  });

  test("shows a given flag read-only, with no feedback control", async ({ page, request }) => {
    const at = await aWorkspace(request, "Aire Flags");
    const note = "The period changed in May.";
    await seeded(request, at, [
      {
        askedBy: at.editor.id,
        question: "How long are logs kept?",
        verdict: "ok",
        judgeState: "judged",
        concepts: [{ iri: iriOf(at, RETENTION), judged: "yes" }],
        flags: [{ reason: "wrong", note }],
      },
    ]);

    await signedInAt(page, request, at.editor, YOUR_QUESTIONS);
    await recordOpened(page, "How long are logs kept?");

    const given = page.getByRole("region", { name: "Your Feedback" });
    await expect(given.getByText(/Wrong/)).toBeVisible();
    await expect(given.getByText(note)).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: /flag|helpful/i })).toHaveCount(
      0,
    );
  });
});
