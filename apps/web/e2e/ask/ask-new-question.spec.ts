import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ASK_KEYSTROKES as KEY } from "@/features/ask/ask-state.ts";
import { ASK, CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  askShowsTheServedAddress,
  clockTheNextKey,
  inTwoWorkspaces,
  keepsItsWordOffThePage,
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  modelCallsIn,
  person,
  provision,
  railOf,
  releaseTheModel,
  saysARefusal,
  saysSomethingNew,
  scriptAsking,
  seedConcepts,
  seedConnectedSources,
  signIn,
  switched,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  type AskingScript,
  requestsSent,
} from "../harness.ts";
import { scrolledSideways, windowRefocused } from "../knowledge.ts";

const ANSWER_BUDGET_MS = 1000;

const NEW_QUESTION = pageNamed(menuGroupIn(ASK, "ask"), "New Question");

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

type Script = Omit<AskingScript, "workspaceId">;

type Asking = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly viewerEmail: string;
};

const aWorkspaceToAsk = async (api: APIRequestContext, script: Script): Promise<Asking> => {
  const adminEmail = anAddress("admin");
  const workspace = await provision(api, { name: "Calder Audits", adminEmail });
  const { workspaceId } = workspace;
  await seedConcepts(api, {
    workspaceId,
    userId: workspace.admin.id,
    concepts: [USERS, SUPPLIER, POLICY, UNFILED],
  });
  await scriptAsking(api, { workspaceId, ...script });
  const viewerEmail = anAddress("viewer");
  const viewer = await person(api, viewerEmail, { displayName: "Vera Viewer" });
  await addMember(api, { workspaceId, userId: viewer.id, role: "Viewer" });
  return { workspaceId, adminId: workspace.admin.id, adminEmail, viewerEmail };
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

const newQuestion = (page: Page) => page.getByRole("region", { name: "New Question" });

const questionBox = (page: Page) => newQuestion(page).getByRole("textbox", { name: "Question" });

const askButton = (page: Page) => newQuestion(page).getByRole("button", { name: "Ask" });

const said = (page: Page) => newQuestion(page).getByRole("status");

const alerted = (page: Page) => newQuestion(page).getByRole("alert");

const answered = (page: Page, verdict: string) =>
  page.getByRole("region", { name: verdict, exact: true });

const collectionIn = (result: Locator, collection: string) =>
  result.getByRole("region", { name: collection, exact: true });

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
  test("shows a fitting Answer word for word, within its budget", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });

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

  test("keeps the related knowledge one disclosure under the fit", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });
    await asked(page);
    const result = answered(page, "Answered");
    const disclosure = result.getByRole("button", { name: "Related Knowledge" });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");

    await disclosure.click();

    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(result.getByRole("button", { name: SUPPLIER.title, exact: true })).toBeVisible();
    await expect(result.getByText(SUPPLIER.body)).toHaveCount(0);
    await expect(result.getByRole("button", { name: POLICY.title, exact: true })).toBeVisible();
  });

  test("says its phase within the action budget, before the verdict", async ({ page, request }) => {
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [USERS.title] },
      holds: "judge",
    });
    await questionBox(page).fill(QUESTION);

    await clockTheNextKey(page, { at: "//section[h2='New Question']//output", reads: "." });
    await questionBox(page).press("Enter");
    await theActionLandedWithinItsBudget(page, "ask");

    await expect(said(page)).toHaveText(/\S/);
    const whileReading = await said(page).innerText();
    await expect.poll(async () => (await modelCallsIn(request, workspaceId)).judge).toBe(1);
    await saysSomethingNew(said(page), whileReading);
    await expect(answered(page, "Answered")).toHaveCount(0);
    const whileJudging = await said(page).innerText();
    await releaseTheModel(request, workspaceId);
    await expect(answered(page, "Answered")).toBeVisible();
    await expect(said(page), "the verdict was never said").not.toHaveText(whileJudging);
  });

  test("says Judged, listing each judged-no Answer to open", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [] } });

    await asked(page);

    const result = answered(page, "Related Knowledge");
    await expect(result.getByText("Judged", { exact: true })).toBeVisible();
    const audits = collectionIn(result, "audits");
    for (const { title, body } of [USERS, SUPPLIER]) {
      await expect(audits.getByRole("button", { name: title, exact: true })).toBeVisible();
      await expect(audits.getByText(body)).toHaveCount(0);
    }
    await expect(answered(page, "Answered")).toHaveCount(0);
  });

  for (const [script, word] of [
    [{}, "Not judged"],
    [{ judging: "fails" }, "Judging failed"],
  ] as const) {
    test(`says ${word}, showing each Answer in full`, async ({ page, request }) => {
      await aViewerAsking(page, request, script);

      await asked(page);

      const result = answered(page, "Related Knowledge");
      await expect(result.getByText(word, { exact: true })).toBeVisible();
      const audits = collectionIn(result, "audits");
      await expect(audits.getByText(USERS.body)).toBeVisible();
      await expect(audits.getByText(SUPPLIER.body)).toBeVisible();
      await expect(answered(page, "Answered")).toHaveCount(0);
    });
  }

  test("shows the first drafted sentence before the stream ends", async ({ page, request }) => {
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [] },
      drafting: DRAFTING,
      holds: "draft",
    });

    await questionBox(page).fill(QUESTION);
    const started = Date.now();
    await questionBox(page).press("Enter");
    const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
    await expect(audits.getByText(DRAFTED)).toBeVisible();
    const elapsed = Date.now() - started;

    test
      .info()
      .annotations.push({ type: "first sentence, streamed", description: `${elapsed} ms` });
    await expect(askButton(page), "the stream had ended").toHaveAttribute("aria-disabled", "true");
    await expect(audits.getByRole("button", { name: `Cites ${POLICY.title}` })).toBeVisible();
    await releaseTheModel(request, workspaceId);
    await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  for (const [how, script, calls] of [
    ["fails", { judging: { fits: [] }, drafting: "fails" }, { judge: 1, draft: 1 }],
    ["pauses", { drafting: DRAFTING, limitGbp: "0.001" }, { judge: 0, draft: 0 }],
  ] as const) {
    test(`keeps the evidence when drafting ${how}, saying so`, async ({ page, request }) => {
      const { workspaceId } = await aViewerAsking(page, request, script);

      await asked(page);

      const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
      await expect(audits.getByRole("button", { name: POLICY.title, exact: true })).toBeVisible();
      await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
      expect(await modelCallsIn(request, workspaceId)).toEqual(calls);
      await expect(audits.getByText(DRAFTED)).toHaveCount(0);
      await expect(audits).toMatchAriaSnapshot(`
        - region "audits":
          - heading "audits" [level=3]
          - paragraph
          - list
      `);
    });
  }

  test("flags one drafted sentence, storing it and its concept", async ({ page, request }) => {
    const { adminEmail } = await aWorkspaceToAsk(request, {
      judging: { fits: [] },
      drafting: DRAFTING,
    });
    await page.goto("/sign-in");
    await signIn(page, request, adminEmail);
    await railOf(page).getByRole("link", { name: "Ask" }).click();
    await asked(page);

    const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
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

  test("flags the answer with a reason, showing it was sent", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });
    await asked(page);
    const result = answered(page, "Answered");

    const flagging = await flagSent(page, result);

    await expect(flagging).toHaveCount(0);
    await expect(result.getByRole("button", { name: "Flagged" })).toBeVisible();
    await expect(result.getByRole("button", { name: "Flag This Answer" })).toHaveCount(0);
    await expect(result.getByRole("status").last()).toHaveText(/\S/);
  });

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

  test("asks for a reason before a flag is sent", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });
    await asked(page);
    const result = answered(page, "Answered");
    const sent = requestsSent(page, (url) => url.pathname.includes("ask.giveFeedback"));

    await result.getByRole("button", { name: "Flag This Answer" }).click();
    const flagging = page.getByRole("dialog", { name: "Flag This Answer" });
    await flagging.getByRole("button", { name: "Send Flag" }).click();

    await saysARefusal(flagging.getByRole("alert"));
    await expect(flagging.getByRole("radiogroup")).toHaveAttribute("aria-invalid", "true");
    await flagging.getByRole("radio", { name: "Wrong" }).check();
    await expect(flagging.getByRole("alert")).toHaveCount(0);
    expect(
      sent.map((each) => each.url()),
      "a flag with no reason was sent",
    ).toEqual([]);
  });

  test("shows an Answer in no collection under that word", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [UNFILED.title] } });

    await asked(page);

    const unfiled = collectionIn(answered(page, "Answered"), "No Collection");
    await expect(unfiled.getByRole("heading", { level: 4, name: UNFILED.title })).toBeVisible();
    await expect(unfiled.getByText(UNFILED.body)).toBeVisible();
  });

  test("leads an Editor from New question to the connect steps", async ({ page, request }) => {
    const email = anAddress("editor");
    const editor = await person(request, email, { displayName: "Ed Editor" });
    const workspace = await provision(request, { name: "Ryedale Editors" });
    await addMember(request, {
      workspaceId: workspace.workspaceId,
      userId: editor.id,
      role: "Editor",
    });
    await page.goto("/sign-in");
    await signIn(page, request, email);
    await landedAtHome(page, "Editor");
    await expect(page).toHaveURL(new RegExp(`${NEW_QUESTION.path}$`));

    await page.getByRole("main").getByRole("link", { name: "connect Claude" }).click();

    await expect(
      page.getByRole("heading", { level: 2, name: "Connect Claude as Your Assistant" }),
    ).toBeVisible();
    await askShowsTheServedAddress(page);
  });

  test("says the one sentence and its unmapped passages, asking once", async ({
    page,
    request,
  }) => {
    const { workspaceId } = await aViewerAsking(page, request, {});
    await seedConnectedSources(request, {
      workspaceId,
      connectedSources: [
        {
          name: "Loading drive",
          sensitivity: "Internal",
          published: true,
          sync: "done",
          documents: [
            {
              title: "Pallet loading notes",
              passages: ["Pallet loads leave the warehouse on Fridays."],
            },
          ],
        },
      ],
    });
    const asks = asksCounted(page);

    await asked(page, "When do pallet loads leave?");

    const result = answered(page, "Not Answered");
    await expect(result.getByRole("button", { name: "Pallet loading notes" })).toBeVisible();
    await expect(said(page)).toHaveText(/\S/);
    await windowRefocused(page);
    expect(asks, "the question was asked again").toEqual(["POST"]);
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

  test("asks nothing again when the window is refocused", async ({ page, request }) => {
    const { workspaceId } = await aViewerAsking(page, request, {
      judging: { fits: [USERS.title] },
    });
    const asks = asksCounted(page);
    await asked(page);
    await expect(answered(page, "Answered")).toBeVisible();

    await windowRefocused(page);

    expect(asks, "the question was asked again").toEqual(["POST"]);
    expect(await modelCallsIn(request, workspaceId)).toEqual({ judge: 1, draft: 0 });
  });

  test("offers only the collections the reader can read", async ({ page, request }) => {
    const asking = await aWorkspaceToAsk(request, {});
    const insider = await person(request, anAddress("insider"), { displayName: "Ines Insider" });
    await addMember(request, {
      workspaceId: asking.workspaceId,
      userId: insider.id,
      role: "Viewer",
    });
    await seedConcepts(request, {
      workspaceId: asking.workspaceId,
      userId: asking.adminId,
      concepts: [
        {
          title: "How do buyers access audit information in the acquisition plans?",
          collection: "secret-plans",
          kind: "Answer",
          body: "Only the insiders read the acquisition plans.",
          audience: "groups",
          groupMemberIds: [insider.id],
        },
      ],
    });
    await signedInAsTheViewer(page, request, asking);

    await asked(page);
    await expect(answered(page, "Related Knowledge")).toBeVisible();

    const collections = newQuestion(page).getByRole("group", { name: "Collections" });
    await expect(collections.getByRole("checkbox")).toHaveCount(1);
    await expect(collections.getByRole("checkbox", { name: "audits" })).toBeVisible();
  });

  test("asks within the collection the reader ticked", async ({ page, request }) => {
    const asking = await aWorkspaceToAsk(request, {});
    await seedConcepts(request, {
      workspaceId: asking.workspaceId,
      userId: asking.adminId,
      concepts: [
        {
          title: "How do buyers access audit information in the LMS?",
          collection: "lms",
          kind: "Policy",
          body: "The LMS exports its audit trail to buyers.",
        },
      ],
    });
    await signedInAsTheViewer(page, request, asking);
    await asked(page);
    const result = answered(page, "Related Knowledge");
    await expect(collectionIn(result, "lms")).toBeVisible();

    await newQuestion(page)
      .getByRole("group", { name: "Collections" })
      .getByRole("checkbox", { name: "audits" })
      .check();
    const sent = page.waitForRequest((each) => each.url().includes("ask.question"));
    await askButton(page).click();

    expect((await sent).postData(), "the ask named no collection").toContain(
      '"collections":["audits"]',
    );
    await expect(collectionIn(result, "audits")).toBeVisible();
    await expect(collectionIn(result, "lms")).toHaveCount(0);
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

  test("lists its keystrokes, each acting on the answer", async ({ page, request }) => {
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });

    const listed = await keystrokesListed(page, "New Question");
    for (const { key } of Object.values(KEY)) {
      await expect(keyListed(listed, key), `the list holds no ${key}`).toBeVisible();
    }
    await keystrokesDismissed(page, listed);

    await page.keyboard.press(KEY.question.key);
    await expect(questionBox(page)).toBeFocused();
    await asked(page);
    const result = answered(page, "Answered");
    await expect(result).toBeVisible();
    await result.getByRole("heading", { level: 2 }).click();

    await page.keyboard.press(KEY.helpful.key);
    await expect(result.getByRole("button", { name: "Marked Helpful" })).toBeVisible();
    await expect(result.getByRole("status").filter({ hasText: /\S/ })).toHaveCount(1);
    await page.keyboard.press(KEY.flag.key);
    await expect(page.getByRole("dialog", { name: "Flag This Answer" })).toBeVisible();
  });

  test("opens related knowledge beside the answer, tabbing back out", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await aViewerAsking(page, request, { judging: { fits: [] }, drafting: DRAFTING });
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

  test("draws the answer at 320 px with nothing sideways", async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] } });

    await asked(page);

    const result = answered(page, "Answered");
    await expect(result.getByText(USERS.body)).toBeVisible();
    expect(await scrolledSideways(page), "the page scrolls sideways at 320 px").toBe(0);
    await expect(page.getByRole("main")).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Ask" [level=1]
        - paragraph:
          - link "connect Claude"
        - region "New Question":
          - heading "New Question" [level=2]
          - textbox "Question"
          - group "Collections":
            - checkbox "audits"
          - button "Ask"
          - status
        - region "Answered":
          - heading "Answered" [level=2]
          - paragraph
          - region "audits":
            - heading "audits" [level=3]
            - article:
              - heading ${JSON.stringify(USERS.title)} [level=4]
              - paragraph
              - button ${JSON.stringify(`Flag “${USERS.title}”`)}
          - button "Mark as Helpful"
          - button "Flag This Answer"
    `);
  });
});
