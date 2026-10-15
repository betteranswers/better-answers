import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { ASK_KEYSTROKES as KEY } from "@/features/ask/ask-state.ts";
import { ASK, CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
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
  scriptAsking,
  seedConcepts,
  seedConnectedSources,
  signIn,
  switched,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
  type AskingScript,
} from "./harness.ts";
import { scrolledSideways, windowRefocused } from "./knowledge.ts";

/** The answer's first content is a read, so it takes the read's second. */
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

/** Directly under the knowledge folder, so in no collection. */
const UNFILED = {
  title: "How do buyers access audit information they exported?",
  kind: "Answer",
  body: "Exported audit information stays in the buyer's own storage.",
} as const;

const DRAFTED = "Buyers use the console's audit page.";

/** The policy is the one concept no judge is asked about, so the drafter cites it. */
const DRAFTING = { writes: [{ citing: POLICY.title, sentence: DRAFTED }] } as const;

type Script = Omit<AskingScript, "workspaceId">;

type Asking = {
  readonly workspaceId: string;
  readonly adminId: string;
  readonly adminEmail: string;
  readonly viewerEmail: string;
};

/** A workspace holding the audit concepts, its models scripted, and a Viewer of it. */
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

/** A Viewer's home is New question. */
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

/** The result is a region named by its verdict. */
const answered = (page: Page, verdict: string) =>
  page.getByRole("region", { name: verdict, exact: true });

const collectionIn = (result: Locator, collection: string) =>
  result.getByRole("region", { name: collection, exact: true });

const asked = async (page: Page, question = QUESTION): Promise<void> => {
  await questionBox(page).fill(question);
  await questionBox(page).press("Enter");
};

/** Counts each ask the page sends from here on. */
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
    await expect.poll(async () => (await modelCallsIn(request, workspaceId)).judge).toBe(1);
    await expect(answered(page, "Answered")).toHaveCount(0);
    const whileJudging = await said(page).innerText();
    await releaseTheModel(request, workspaceId);
    await expect(answered(page, "Answered")).toBeVisible();
    await expect(said(page), "the verdict was never said").not.toHaveText(whileJudging);
  });

  for (const [judging, word] of [
    [undefined, "Not judged"],
    [{ fits: [] }, "Judged"],
    ["fails", "Judging failed"],
  ] as const) {
    test(`says ${word}, showing each Answer as related knowledge`, async ({ page, request }) => {
      await aViewerAsking(page, request, judging === undefined ? {} : { judging });

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

    test.info().annotations.push({ type: "first sentence", description: `${elapsed} ms` });
    await expect(askButton(page), "the stream had ended").toHaveAttribute("aria-disabled", "true");
    await expect(audits.getByRole("button", { name: `Cites ${POLICY.title}` })).toBeVisible();
    await releaseTheModel(request, workspaceId);
    await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  for (const [how, script] of [
    ["fails", { judging: { fits: [] }, drafting: "fails" }],
    ["pauses", { drafting: DRAFTING, limitGbp: "0.001" }],
  ] as const) {
    test(`keeps the evidence when drafting ${how}, saying so`, async ({ page, request }) => {
      await aViewerAsking(page, request, script);

      await asked(page);

      const audits = collectionIn(answered(page, "Related Knowledge"), "audits");
      await expect(audits.getByRole("button", { name: POLICY.title, exact: true })).toBeVisible();
      await expect(askButton(page)).not.toHaveAttribute("aria-disabled", "true");
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
    await flagging.getByRole("button", { name: "Send Flag" }).click();
    await expect(audits.getByRole("button", { name: "Flagged" })).toBeVisible();

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

    await result.getByRole("button", { name: "Flag This Answer" }).click();
    const flagging = page.getByRole("dialog", { name: "Flag This Answer" });
    await flagging.getByRole("radio", { name: "Incomplete" }).check();
    await flagging.getByRole("textbox", { name: "Note" }).fill("It leaves out the LMS.");
    await flagging.getByRole("button", { name: "Send Flag" }).click();

    await expect(flagging).toHaveCount(0);
    await expect(result.getByRole("button", { name: "Flagged" })).toBeVisible();
    await expect(result.getByRole("button", { name: "Flag This Answer" })).toHaveCount(0);
    await expect(result.getByRole("status").last()).toHaveText(/\S/);
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
    await aViewerAsking(page, request, { judging: { fits: [USERS.title] }, limitGbp: "0.001" });

    await asked(page);

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
    // Off the question box, where a single key is typed, not pressed.
    await result.getByRole("heading", { level: 2 }).click();

    await page.keyboard.press(KEY.helpful.key);
    await expect(result.getByRole("button", { name: "Marked Helpful" })).toBeVisible();
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
