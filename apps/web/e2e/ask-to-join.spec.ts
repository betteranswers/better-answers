import type { APIRequestContext, Page } from "@playwright/test";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  clockTheAct,
  person,
  provision,
  signIn,
  theActReadWithinItsBudget,
} from "./harness.ts";

// Stated, not imported: `apps/web` takes nothing from `apps/api` at runtime.
const ASK_TO_JOIN_ENDPOINT = "/trpc/person.requestAccess";

const REASON = "I run the estimating desk and need the tender library.";

const ACKNOWLEDGED =
  "If a workspace goes by that slug, its Admins will see that you asked and why. If one approves, an invitation comes to your email address; nothing is sent otherwise.";

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No workspace yet" });

const slugField = (page: Page) => page.getByLabel("Workspace slug");

const reasonField = (page: Page) => page.getByLabel("Why you are asking");

const askButton = (page: Page) => page.getByRole("button", { name: "Ask to join" });

const acknowledgement = (page: Page) => page.getByRole("alert", { name: "Asked" });

// A person with a display name and no membership lands here from the product's own sign-in.
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

const theScreenSays = async (page: Page): Promise<string> =>
  `${await page.locator("body").innerText()}\n${await page.locator("body").ariaSnapshot()}`;

test("a person in no workspace asks to join by slug and reason, keyboard alone, and focus lands on the acknowledgement", async ({
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
      - button "Keystrokes"
  `);
  await passesTheAccessibilityGate();

  await page.keyboard.press("j");
  await expect(slugField(page)).toBeFocused();
  await page.keyboard.type(workspace.slug);
  await page.keyboard.press("Tab");
  await expect(reasonField(page)).toBeFocused();
  await page.keyboard.type(REASON);
  await clockTheAct(page, "Asking");
  await page.keyboard.press("Enter");
  await theActReadWithinItsBudget(page, "ask to join");

  await expect(acknowledgement(page)).toBeFocused();
  await expect(acknowledgement(page)).toContainText(ACKNOWLEDGED);
  await expect(slugField(page)).toHaveValue("");
  await expect(reasonField(page)).toHaveValue("");
});

test("the acknowledgement reads the same for a known slug, an unknown one and one already asked", async ({
  page,
  request,
}) => {
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

test("a reason of spaces is refused in its word, with what to do next", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const workspace = await provision(request, { name: "Coldharbour Fabrication" });
  await onTheRefusedScreen(page, request);

  await askToJoin(page, workspace.slug, "   ");

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("malformed");
  await expect(refusal).toContainText(
    "The reason needs a character other than a space. Say why you are asking and send it again.",
  );
  await expect(reasonField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(acknowledgement(page)).toHaveCount(0);
  await passesTheAccessibilityGate();
});

test("a person past the ceiling on asks is told to wait, not refused a word", async ({
  page,
  request,
}) => {
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
    "You have asked to join too often. Wait an hour and ask again.",
  );
  await expect(acknowledgement(page)).toHaveCount(0);
});

test("an ask made after the session ended says so, and offers the way back to sign in", async ({
  page,
  context,
  request,
}) => {
  await onTheRefusedScreen(page, request);
  await context.clearCookies();

  await askToJoin(page, "acme-joinery");

  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("no-session");
  await expect(refusal).toContainText("Your session has ended. Sign in again.");
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the refused screen names no organisation, before or after an ask, nor in its keystrokes", async ({
  page,
  request,
}) => {
  await onTheRefusedScreen(page, request);
  const said = [await theScreenSays(page)];

  await page.keyboard.press("?");
  const keystrokes = page.getByRole("dialog", { name: "Keystrokes on this screen" });
  await expect(keystrokes).toContainText("Ask to join a workspace");
  said.push(await theScreenSays(page));
  await page.keyboard.press("Escape");

  await askToJoin(page, `nobody-${Date.now()}`);
  await expect(acknowledgement(page)).toBeVisible();
  said.push(await theScreenSays(page));

  for (const words of said) expect(words).not.toMatch(/organi[sz]ation/i);
});
