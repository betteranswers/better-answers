import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  anAddress,
  provision,
  railOf,
  releaseTheModel,
  scriptAsking,
  seedConcepts,
  signIn,
} from "../harness.ts";

const QUESTIONS_ASKED = pageNamed(menuGroupIn(CONTROL_CENTRE, "questions"), "Questions Asked");

const QUESTION = "How do buyers access audit information?";

const USERS = {
  title: "How do buyers access audit information about their users' actions?",
  collection: "audits",
  kind: "Answer",
  body: "Buyers download their users' audit log from the console.",
  trust: "machine-confirmed",
} as const;

const SUPPLIER = {
  title: "How do buyers access audit information about the supplier's actions?",
  collection: "audits",
  kind: "Answer",
  body: "The supplier sends its own audit report on request.",
} as const;

const POLICY = {
  title: "Audit information access for buyers",
  collection: "audits",
  kind: "Policy",
  body: "Buyers access audit information through the console's audit page.",
} as const;

const UNFILED = {
  title: "How do buyers access audit information they exported?",
  kind: "Answer",
  body: "Exported audit information stays in the buyer's own storage.",
} as const;

const DRAFTED = "Buyers use the console's audit page.";

const DRAFTING = { writes: [{ citing: POLICY.title, sentence: DRAFTED }] } as const;

const aWorkspaceToAsk = async (api: APIRequestContext) => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: "Calder Audits", adminEmail });
  const { workspaceId } = workspace;
  await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [USERS, SUPPLIER, POLICY, UNFILED],
  });
  await scriptAsking(api, {
    workspaceId,
    judging: { fits: [] },
    drafting: DRAFTING,
    holds: "draft",
  });
  return { workspaceId, adminEmail };
};

const newQuestion = (page: Page) => page.getByRole("region", { name: "New Question" });

const questionBox = (page: Page) => newQuestion(page).getByRole("textbox", { name: "Question" });

const askButton = (page: Page) => newQuestion(page).getByRole("button", { name: "Ask" });

const answered = (page: Page, verdict: string) =>
  page.getByRole("region", { name: verdict, exact: true });

const collectionIn = (result: Locator, collection: string) =>
  result.getByRole("region", { name: collection, exact: true });

test("a drafted sentence streams in, then its flag is stored", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspaceId, adminEmail } = await aWorkspaceToAsk(request);
  await page.goto("/sign-in");
  await signIn(page, request, adminEmail);
  await railOf(page).getByRole("link", { name: "Ask" }).click();
  const audits = collectionIn(answered(page, "Related Knowledge"), "audits");

  await test.step("shows the first drafted sentence before the stream ends", async () => {
    await questionBox(page).fill(QUESTION);
    const started = Date.now();
    await questionBox(page).press("Enter");
    await expect(audits.getByText(DRAFTED)).toBeVisible();
    const elapsed = Date.now() - started;

    test
      .info()
      .annotations.push({ type: "first sentence, streamed", description: `${elapsed} ms` });
    await expect(askButton(page), "the stream had ended").toHaveAttribute("aria-disabled", "true");
    await expect(audits.getByRole("button", { name: `Cites ${POLICY.title}` })).toBeVisible();
    await releaseTheModel(request, workspaceId);
    await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
    await passesTheAccessibilityGate();
  });

  await test.step("flags one drafted sentence, storing it and its concept", async () => {
    await audits.getByRole("button", { name: `Flag “${DRAFTED}”` }).click();
    const flagging = page.getByRole("dialog", { name: `Flag “${DRAFTED}”` });
    await flagging.getByRole("radio", { name: "Wrong" }).check();
    const sending = page.waitForResponse((response) => response.url().includes("ask.giveFeedback"));
    await flagging.getByRole("button", { name: "Send Flag" }).click();
    await expect(audits.getByRole("button", { name: "Flagged" })).toBeVisible();
    expect((await sending).ok(), "the flag was not stored").toBe(true);

    await page.goto(QUESTIONS_ASKED.path);
    await page
      .getByRole("region", { name: "Flagged" })
      .getByRole("button", { name: QUESTION })
      .click();
    const record = page.getByRole("dialog", { name: QUESTION });
    await expect(record.getByText(/Wrong/)).toBeVisible();
    await expect(record.getByRole("blockquote")).toHaveText(DRAFTED);
    await expect(record.getByRole("link", { name: POLICY.title })).not.toHaveCount(0);
  });
});
