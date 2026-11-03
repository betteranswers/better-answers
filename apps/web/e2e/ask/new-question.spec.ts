import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  anAuditWorkspace,
  answered,
  askButton,
  collectionIn,
  DRAFTED,
  DRAFTING,
  newQuestion,
  POLICY,
  QUESTION,
  questionBox,
  SUPPLIER,
  USERS,
} from "../asking.ts";
import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  inTwoWorkspaces,
  keepsItsWordOffThePage,
  landedAtHome,
  modelCallsIn,
  person,
  railOf,
  releaseTheModel,
  saysARefusal,
  scriptAsking,
  signIn,
  switched,
  tabUntilFocused,
  type AskingScript,
} from "../harness.ts";
import { scrolledSideways } from "../knowledge.ts";

const ANSWER_BUDGET_MS = 1000;

type Script = Omit<AskingScript, "workspaceId">;

type Asking = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly viewerEmail: string;
};

const aWorkspaceToAsk = async (api: APIRequestContext, script: Script): Promise<Asking> => {
  const { workspaceId, adminId } = await anAuditWorkspace(api);
  await scriptAsking(api, { workspaceId, ...script });
  const viewerEmail = anAddress("viewer");
  const viewer = await person(api, viewerEmail, { displayName: "Vera Viewer" });
  await addMember(api, { workspaceId, userId: viewer.id, role: "Viewer" });
  return { workspaceId, adminId, viewerEmail };
};

const signedInAsTheViewer = async (page: Page, api: APIRequestContext, asking: Asking) => {
  await page.goto("/sign-in");
  await signIn(page, api, asking.viewerEmail);
  await landedAtHome(page, "Viewer");
};

const aViewerAsking = async (
  page: Page,
  api: APIRequestContext,
  script: Script,
): Promise<Asking> => {
  const asking = await aWorkspaceToAsk(api, script);
  await signedInAsTheViewer(page, api, asking);
  return asking;
};

const said = (page: Page) => newQuestion(page).getByRole("status");

const alerted = (page: Page) => newQuestion(page).getByRole("alert");

const asked = async (page: Page, question = QUESTION): Promise<void> => {
  await questionBox(page).fill(question);
  await questionBox(page).press("Enter");
};

const NOTE = "It leaves out the LMS.";

const flagSent = async (page: Page, result: Locator): Promise<Locator> => {
  await result.getByRole("button", { name: "Flag This Answer" }).click();
  const flagging = page.getByRole("dialog", { name: "Flag This Answer" });
  await flagging.getByRole("radio", { name: "Incomplete" }).check();
  await flagging.getByRole("textbox", { name: "Note" }).fill(NOTE);
  await flagging.getByRole("button", { name: "Send Flag" }).click();
  return flagging;
};

const asksCounted = (page: Page): string[] => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("ask.question")) sent.push(request.method());
  });
  return sent;
};

test.describe("Ask › New question", () => {
  test("reopens a refused flag with its draft and the refusal", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });
    await asked(page);
    const result = answered(page, "Answered");
    await page.route(
      (url) => url.pathname.includes("ask.giveFeedback"),
      (route) => route.abort(),
    );

    const flagging = await flagSent(page, result);

    await saysARefusal(result.getByRole("alert"));
    await expect(result.getByRole("button", { name: "Flagged" })).toHaveCount(0);
    await expect(flagging.getByRole("radio", { name: "Incomplete" })).toBeChecked();
    await expect(flagging.getByRole("textbox", { name: "Note" })).toHaveValue(NOTE);
  });

  test("says the spending limit in the refusal's sentence", async ({ page, request }) => {
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [USERS.title] },
      limitGbp: "0.001",
    });
    // Streamed, so the refusal is a line of the body; the browser keeps no streamed body to read.
    const refused = Promise.withResolvers<string>();
    await page.route(
      (url) => url.pathname.includes("ask.question"),
      async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        refused.resolve(body);
        await route.fulfill({ response, body });
      },
    );

    await asked(page);

    expect(await refused.promise, "the api did not refuse at the spending limit").toContain(
      "spending-limit-met",
    );
    expect(await modelCallsIn(request, workspaceId)).toEqual({ judge: 0, draft: 0 });
    await saysARefusal(alerted(page));
    await expect(answered(page, "Answered")).toHaveCount(0);
    await expect(answered(page, "Related Knowledge")).toHaveCount(0);
    await keepsItsWordOffThePage(page, "spending-limit-met");
  });

  test("starts no second question while an answer streams", async ({ page, request }) => {
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [USERS.title] },
      holds: "judge",
    });
    const asks = asksCounted(page);

    await asked(page);
    await expect.poll(async () => (await modelCallsIn(request, workspaceId)).judge).toBe(1);
    await questionBox(page).press("Enter");
    // Held disabled to the pointer as to the keyboard, so the press is the page's to ignore.
    await askButton(page).click({ force: true });
    await releaseTheModel(request, workspaceId);

    await expect(answered(page, "Answered")).toBeVisible();
    await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
    expect(asks, "a second question was sent").toEqual(["POST"]);
    expect(await modelCallsIn(request, workspaceId)).toEqual({ judge: 1, draft: 0 });
  });

  test("asks nothing for a blank question, saying so", async ({ page, request }) => {
    await aViewerAsking(page, request, {});
    const asks = asksCounted(page);

    await questionBox(page).press("Enter");

    await saysARefusal(alerted(page));
    await expect(questionBox(page)).toHaveAttribute("aria-invalid", "true");
    await questionBox(page).fill("How do buyers");
    await questionBox(page).press("Shift+Enter");
    await expect(questionBox(page)).toHaveValue("How do buyers\n");
    expect(asks, "a question was asked").toEqual([]);
  });

  test("clears the question and its result on a workspace switch", async ({ page, request }) => {
    const { first, second } = await inTwoWorkspaces(
      page,
      request,
      { first: "Aire Audits", second: "Nidd Audits" },
      "Viewer",
    );
    await railOf(page).getByRole("link", { name: "Ask" }).click();
    await asked(page);
    await expect(answered(page, "Not Answered")).toBeVisible();

    await switched(page, first.name, second.name);
    await landedAtHome(page, "Viewer");

    await expect(questionBox(page)).toHaveValue("");
    await expect(answered(page, "Not Answered")).toHaveCount(0);
  });

  test("opens related knowledge beside the answer, tabbing back out", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [USERS.title] },
    });

    await test.step("shows a fitting Answer word for word, within its budget", async () => {
      await questionBox(page).fill(QUESTION);
      const started = Date.now();
      await questionBox(page).press("Enter");
      const result = answered(page, "Answered");
      const audits = collectionIn(result, "audits");
      await expect(audits.getByRole("heading", { level: 4, name: USERS.title })).toBeVisible();
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "first content", description: `${elapsed} ms` });
      expect(elapsed, "the verdict landed past the answer's budget").toBeLessThan(ANSWER_BUDGET_MS);
      await expect(audits.getByText(USERS.body)).toBeVisible();
      await expect(audits.getByText("Verified automatically")).toBeVisible();
      await expect(result.getByText("Judged", { exact: true })).toBeVisible();
      await expect(result.getByText(SUPPLIER.body)).toHaveCount(0);
      await expect(said(page)).toHaveText(/\S/);
      await expect(questionBox(page), "focus left the question").toBeFocused();
    });

    await scriptAsking(request, { workspaceId, judging: { fits: [] }, drafting: DRAFTING });
    await asked(page);
    const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
    await expect(audits.getByText(DRAFTED)).toBeVisible();

    const opener = audits.getByRole("button", { name: POLICY.title, exact: true });
    await opener.click();
    const panel = page.getByRole("dialog", { name: POLICY.title });
    await expect(panel.getByText(POLICY.body)).toBeVisible();
    await passesTheAccessibilityGate();

    await tabUntilFocused(page, opener, 4);
    await expect(panel).toBeVisible();
  });

  test("opens a cited concept beneath its sentence at 320 px", async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await aViewerAsking(page, request, { judging: { fits: [] }, drafting: DRAFTING });
    await asked(page);
    const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
    const footnote = audits.getByRole("button", { name: `Cites ${POLICY.title}` });

    await footnote.click();

    const inline = audits.getByRole("region", { name: POLICY.title });
    await expect(inline.getByText(POLICY.body)).toBeVisible();
    await expect(inline.getByRole("heading", { name: POLICY.title })).toBeFocused();
    expect(await scrolledSideways(page), "the page scrolls sideways at 320 px").toBe(0);
    await page.keyboard.press("Escape");
    await expect(inline).toHaveCount(0);
    await expect(footnote).toBeFocused();
  });
});
