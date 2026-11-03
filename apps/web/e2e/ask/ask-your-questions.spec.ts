import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ASK, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  person,
  provision,
  seedConcepts,
  seedQuestions,
  signIn,
  type SeedConcept,
  type SeedRecord,
} from "../harness.ts";

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
});
