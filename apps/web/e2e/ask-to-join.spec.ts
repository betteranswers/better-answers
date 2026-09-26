import type { APIRequestContext, Page } from "@playwright/test";

import { REASON_REFUSED } from "@/features/auth/refusal-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { SAID_OF_CLASS, sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  clockTheNextKey,
  person,
  provision,
  signIn,
  theActLandedWithinItsBudget,
} from "./harness.ts";

/** Stated, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const ASK_TO_JOIN_ENDPOINT = "/trpc/person.requestAccess";

const REASON = "I run the estimating desk and need the tender library.";

const ACKNOWLEDGED =
  "If a workspace goes by that slug, its Admins will see that you asked and why. If one approves, an invitation comes to your email address; nothing is sent otherwise.";

const NAMES_AN_ORGANISATION = /organi[sz]ation/i;

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No workspace yet" });

const slugField = (page: Page) => page.getByLabel("Workspace slug");

const reasonField = (page: Page) => page.getByLabel("Why you are asking");

const askButton = (page: Page) => page.getByRole("button", { name: /^Ask/ });

const acknowledgement = (page: Page) => page.getByRole("alert", { name: "Asked" });

/** A person with a display name and no membership lands here from the product's own sign-in. */
const onTheRefusedScreen = async (page: Page, request: APIRequestContext): Promise<void> => {
  const email = anAddress("asker");
  await person(request, email);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(noWorkspaceHeading(page)).toBeVisible();
};

const askToJoin = async (page: Page, slug: string, reason = REASON): Promise<void> => {
  await slugField(page).fill(slug);
  await reasonField(page).fill(reason);
  await askButton(page).click();
};

/** The body as read and as heard, so a word in an accessible name is caught too. */
const theScreenSaysNoOrganisation = async (page: Page, when: string): Promise<void> => {
  const said = `${await page.locator("body").innerText()}\n${await page.locator("body").ariaSnapshot()}`;
  expect(said, `the refused screen names an organisation ${when}`).not.toMatch(
    NAMES_AN_ORGANISATION,
  );
};

test("a person in no workspace asks to join by keyboard", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Acme Joinery" });
  await onTheRefusedScreen(page, request);

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "No workspace yet" [level=1]
      - paragraph
      - region "Ask to join a workspace":
        - heading "Ask to join a workspace" [level=2]
        - paragraph
        - text: Workspace slug
        - textbox "Workspace slug"
        - text: Why you are asking
        - paragraph
        - textbox "Why you are asking"
        - button "Ask to join"
      - button "Sign out"
      - button ${JSON.stringify(KEYSTROKE_WORDS.button)}
  `);
  await passesTheAccessibilityGate();

  await page.keyboard.press("j");
  await expect(slugField(page)).toBeFocused();
  await page.keyboard.type(workspace.slug);
  await page.keyboard.press("Tab");
  await expect(reasonField(page)).toBeFocused();
  await page.keyboard.type(REASON);
  await clockTheNextKey(page, { at: "//main//button[@type='submit']", reads: "Asking" });
  await page.keyboard.press("Enter");
  await theActLandedWithinItsBudget(page, "ask to join");

  await expect(acknowledgement(page)).toBeFocused();
  await expect(page.getByRole("region", { name: "Ask to join a workspace" })).toMatchAriaSnapshot(`
    - region "Ask to join a workspace":
      - heading "Ask to join a workspace" [level=2]
      - paragraph
      - text: Workspace slug
      - textbox "Workspace slug"
      - text: Why you are asking
      - paragraph
      - textbox "Why you are asking"
      - button "Ask to join"
      - alert "Asked":
        - paragraph: Asked
        - paragraph: "${ACKNOWLEDGED}"
  `);
  await expect(slugField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});

test("answers a known, an unknown and a repeated slug alike", async ({ page, request }) => {
  const workspace = await provision(request, { name: "Brightwater Estimating" });
  await onTheRefusedScreen(page, request);

  const said: string[] = [];
  for (const slug of [workspace.slug, `nobody-${Date.now()}`, workspace.slug]) {
    await askToJoin(page, slug);
    // The fields empty only once this ask is acknowledged, so the banner read is this ask's.
    await expect(slugField(page)).toHaveValue("");
    said.push(await acknowledgement(page).innerText());
  }

  const [known, unknown, alreadyAsked] = said;
  expect(known).toContain(ACKNOWLEDGED);
  expect(unknown, "an unknown slug was answered differently").toBe(known);
  expect(alreadyAsked, "a second ask was answered differently").toBe(known);
});

test("refuses a blank reason, saying what to send", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Coldharbour Fabrication" });
  await onTheRefusedScreen(page, request);

  await askToJoin(page, workspace.slug, "   ");

  await expect(page.getByRole("alert")).toHaveText(sentenceOf(REASON_REFUSED));
  await expect(reasonField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(reasonField(page)).toBeFocused();
  await expect(acknowledgement(page)).toHaveCount(0);
  await theScreenSaysNoOrganisation(page, "in a refusal");
  await passesTheAccessibilityGate();
});

test("tells a person past the ceiling when to ask again", async ({ page, request }) => {
  await onTheRefusedScreen(page, request);

  // The window is wall-clock aligned, so a burst straddling a boundary starts its count again:
  // ask until refused, not a fixed number.
  let status = 200;
  for (let attempt = 0; attempt < 30 && status !== 429; attempt += 1) {
    const answered = await page.request.post(ASK_TO_JOIN_ENDPOINT, {
      data: { slug: `nobody-${attempt}`, reason: REASON },
    });
    status = answered.status();
  }
  expect(status, "the flood never met the ceiling").toBe(429);

  await askToJoin(page, "acme-joinery");

  await expect(page.getByRole("alert")).toContainText(
    /^You have asked to join too often\. Ask again in (a minute|\d+ minutes)\.$/,
  );
  await expect(askButton(page)).toBeFocused();
  await expect(acknowledgement(page)).toHaveCount(0);
  await theScreenSaysNoOrganisation(page, "at the ceiling");
});

test("sends a person whose session ended back to sign in", async ({ page, context, request }) => {
  await onTheRefusedScreen(page, request);
  await context.clearCookies();

  await askToJoin(page, "acme-joinery");

  await expect(page.getByRole("alert")).toHaveText(sentenceOf(SAID_OF_CLASS.unauthenticated));
  await theScreenSaysNoOrganisation(page, "once the session ended");
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("never names an organisation, asking or not, nor in keystrokes", async ({ page, request }) => {
  await onTheRefusedScreen(page, request);
  await theScreenSaysNoOrganisation(page, "before an ask");

  await page.keyboard.press("?");
  const keystrokes = page.getByRole("dialog", { name: `${KEYSTROKE_WORDS.button} on this screen` });
  await expect(keystrokes).toContainText("Ask to join a workspace");
  await theScreenSaysNoOrganisation(page, "in its keystrokes");
  await page.keyboard.press("Escape");

  await askToJoin(page, `nobody-${Date.now()}`);
  await expect(acknowledgement(page)).toBeVisible();
  await theScreenSaysNoOrganisation(page, "after an ask");
});
