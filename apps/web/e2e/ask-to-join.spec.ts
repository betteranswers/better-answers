import type { Page } from "@playwright/test";

import { ASK_TO_JOIN_WORDS, SHORT_NAME_EXAMPLE } from "@/features/auth/ask-to-join-words.ts";
import { askedTooOften, REASON_REFUSED } from "@/features/auth/refusal-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { SAID_OF_CLASS, sentenceOf, SIGN_IN_AGAIN } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  clockTheNextKey,
  keystrokesDismissed,
  keystrokesListed,
  provision,
  signedInWithNoWorkspace,
  theActionLandedWithinItsBudget,
} from "./harness.ts";

/** Stated, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const ASK_TO_JOIN_ENDPOINT = "/trpc/person.requestAccess";

const REASON = "I run the estimating desk and need the tender library.";

const A_SHORT_NAME = "acme-joinery";

/** The short name's old word, spelled in halves so this file keeps none of it. */
const OLD_WORD = ["sl", "ug"].join("");

/** A reader has no use for the short name's old word, and a workspace is never an organisation. */
const UNSAID = [
  { word: "an organisation", pattern: /organi[sz]ation/i },
  { word: `a ${OLD_WORD}`, pattern: new RegExp(String.raw`\b${OLD_WORD}\b`, "i") },
] as const;

const askRegion = (page: Page) => page.getByRole("region", { name: ASK_TO_JOIN_WORDS.heading });

const shortNameField = (page: Page) => page.getByLabel(ASK_TO_JOIN_WORDS.shortName);

const reasonField = (page: Page) => page.getByLabel(ASK_TO_JOIN_WORDS.reason);

const askButton = (page: Page) =>
  askRegion(page).getByRole("button", {
    name: new RegExp(`^(${ASK_TO_JOIN_WORDS.ask}|${ASK_TO_JOIN_WORDS.asking})$`),
  });

const requestSent = (page: Page) => page.getByRole("alert", { name: ASK_TO_JOIN_WORDS.sent });

const askToJoin = async (page: Page, shortName: string, reason = REASON): Promise<void> => {
  await shortNameField(page).fill(shortName);
  await reasonField(page).fill(reason);
  await askButton(page).click();
};

/** The body as read and as heard, so a word in an accessible name is caught too. */
const thePageSaysNeither = async (page: Page, when: string): Promise<void> => {
  const said = `${await page.locator("body").innerText()}\n${await page.locator("body").ariaSnapshot()}`;
  for (const { word, pattern } of UNSAID) {
    expect(said, `the no-workspace page names ${word} ${when}`).not.toMatch(pattern);
  }
};

test("a person in no workspace asks to join by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Acme Joinery" });
  await signedInWithNoWorkspace(page, request, "asker");

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${JSON.stringify(NO_WORKSPACE_HEADING)} [level=1]
      - region ${JSON.stringify(ASK_TO_JOIN_WORDS.heading)}:
        - heading ${JSON.stringify(ASK_TO_JOIN_WORDS.heading)} [level=2]
        - text: ${JSON.stringify(ASK_TO_JOIN_WORDS.shortName)}
        - paragraph
        - textbox ${JSON.stringify(ASK_TO_JOIN_WORDS.shortName)}
        - text: ${JSON.stringify(ASK_TO_JOIN_WORDS.reason)}
        - paragraph
        - textbox ${JSON.stringify(ASK_TO_JOIN_WORDS.reason)}
        - button ${JSON.stringify(ASK_TO_JOIN_WORDS.ask)}
      - button "Sign out"
      - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
  `);
  await expect(shortNameField(page)).toHaveAccessibleDescription(
    `${ASK_TO_JOIN_WORDS.forExample} ${SHORT_NAME_EXAMPLE}`,
  );
  await expect(reasonField(page)).toHaveAccessibleDescription(ASK_TO_JOIN_WORDS.reasonHint);
  await passesTheAccessibilityGate();

  await page.keyboard.press("j");
  await expect(shortNameField(page)).toBeFocused();
  await page.keyboard.type(workspace.shortName);
  await page.keyboard.press("Tab");
  await expect(reasonField(page)).toBeFocused();
  await page.keyboard.type(REASON);
  await clockTheNextKey(page, {
    at: "//main//button[@type='submit']",
    reads: ASK_TO_JOIN_WORDS.asking,
  });
  await page.keyboard.press("Enter");
  await theActionLandedWithinItsBudget(page, "ask to join");

  await expect(requestSent(page)).toBeFocused();
  await expect(requestSent(page)).toMatchAriaSnapshot(`
    - alert ${JSON.stringify(ASK_TO_JOIN_WORDS.sent)}:
      - paragraph: ${JSON.stringify(ASK_TO_JOIN_WORDS.sent)}
      - paragraph: ${JSON.stringify(ASK_TO_JOIN_WORDS.whatHappensNext)}
  `);
  await expect(shortNameField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});

test("answers known, unknown and repeated short names alike", async ({ page, request }) => {
  const workspace = await provision(request, { name: "Brightwater Estimating" });
  await signedInWithNoWorkspace(page, request, "asker");

  const said: string[] = [];
  for (const shortName of [workspace.shortName, `nobody-${Date.now()}`, workspace.shortName]) {
    await askToJoin(page, shortName);
    // The fields empty only once this ask is acknowledged, so the banner read is this ask's.
    await expect(shortNameField(page)).toHaveValue("");
    said.push(await requestSent(page).innerText());
  }

  const [known, unknown, alreadyAsked] = said;
  expect(known).toContain(ASK_TO_JOIN_WORDS.whatHappensNext);
  expect(unknown, "an unknown short name was answered differently").toBe(known);
  expect(alreadyAsked, "a second ask was answered differently").toBe(known);
});

test("refuses a blank reason, saying what to send", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Coldharbour Fabrication" });
  await signedInWithNoWorkspace(page, request, "asker");

  const refusal = askRegion(page).getByRole("alert", { includeHidden: true });
  await expect(refusal, "the refusal region does not stand before an ask").toHaveCount(1);
  await expect(refusal, "the refusal region stands with words already in it").toBeEmpty();
  const stood = await refusal.elementHandle();

  await askToJoin(page, workspace.shortName, "   ");

  await expect(refusal).toHaveText(sentenceOf(REASON_REFUSED));
  const sameRegion = await refusal.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the refusal came in an alert region of its own").toBe(true);
  await expect(reasonField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(reasonField(page)).toBeFocused();
  await expect(requestSent(page)).toHaveCount(0);
  await thePageSaysNeither(page, "in a refusal");
  await passesTheAccessibilityGate();
});

test("tells a person past the ceiling when to ask again", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "asker");

  // The window is wall-clock aligned, so a burst straddling a boundary starts its count again:
  // ask until refused, not a fixed number.
  let status = 200;
  for (let attempt = 0; attempt < 30 && status !== 429; attempt += 1) {
    const answered = await page.request.post(ASK_TO_JOIN_ENDPOINT, {
      data: { shortName: `nobody-${attempt}`, reason: REASON },
    });
    status = answered.status();
  }
  expect(status, "the flood never met the ceiling").toBe(429);

  const refused = page.waitForResponse((response) => response.url().includes(ASK_TO_JOIN_ENDPOINT));
  await askToJoin(page, A_SHORT_NAME);
  const liftsInSeconds = Number((await refused).headers()["retry-after"]);

  expect(liftsInSeconds, "the ceiling's answer named no wait").toBeGreaterThan(0);
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(askedTooOften(liftsInSeconds)));
  await expect(askButton(page)).toBeFocused();
  await expect(requestSent(page)).toHaveCount(0);
  await thePageSaysNeither(page, "at the ceiling");
});

test("sends a person whose session ended back to sign in", async ({ page, context, request }) => {
  await signedInWithNoWorkspace(page, request, "asker");
  await context.clearCookies();

  await askToJoin(page, A_SHORT_NAME);

  await expect(page.getByRole("alert")).toHaveText(SAID_OF_CLASS.unauthenticated.why);
  await thePageSaysNeither(page, "once the session ended");
  await page.getByRole("button", { name: SIGN_IN_AGAIN }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("names no organisation or old word, nor in keystrokes", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "asker");
  await thePageSaysNeither(page, "before an ask");

  const keystrokes = await keystrokesListed(page, "this page");
  await expect(keystrokes).toContainText(ASK_TO_JOIN_WORDS.heading);
  await thePageSaysNeither(page, "in its keystrokes");
  await keystrokesDismissed(page, keystrokes);

  await askToJoin(page, `nobody-${Date.now()}`);
  await expect(requestSent(page)).toBeVisible();
  await thePageSaysNeither(page, "after an ask");
});
