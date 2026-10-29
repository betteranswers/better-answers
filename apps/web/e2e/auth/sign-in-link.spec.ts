import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { z } from "zod";

import { codeShown, codeSpelled } from "@/features/auth/sign-in/link-words.ts";

import { expect, test as base } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  codeSentTo,
  landedAtHome,
  linkSentTo,
  person,
  provision,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";

const CLIENT_IP_HEADER = "cf-connecting-ip";

let browsersOpened = 0;

const test = base.extend<{ readonly anotherBrowser: BrowserContext }>({
  anotherBrowser: async ({ browser }, use, testInfo) => {
    browsersOpened += 1;
    const context = await browser.newContext({
      extraHTTPHeaders: {
        [CLIENT_IP_HEADER]: `198.19.${testInfo.workerIndex % 250}.${browsersOpened % 250}`,
      },
    });
    await use(context);
    await context.close();
  },
});

const DESCRIBE_PATH = "/sign-in-link/describe";

const elsewhere = z.object({ until: z.string() });

const linkTo = (token: string): string => `/sign-in/link#${token}`;

const aLinkAskedForIn = async (asking: BrowserContext, api: APIRequestContext, who: string) => {
  const email = anAddress(who.toLowerCase());
  const editor = await person(api, email, { displayName: `${who} Editor` });
  const workspace = await provision(api, { name: `The ${who} workspace` });
  await addMember(api, { workspaceId: workspace.workspaceId, userId: editor.id, role: "Editor" });
  const page = await asking.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email Address").fill(email);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Verification Code", { exact: true })).toBeVisible();
  return { email, asking: page, token: await linkSentTo(api, email) };
};

const typedWhereItStarted = async (asking: Page, code: string): Promise<void> => {
  await asking.getByLabel("Verification Code", { exact: true }).fill(code);
  await landedAtHome(asking, "Editor");
};

const headingOf = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

const signInButton = (page: Page) => page.getByRole("button", { name: "Sign In", exact: true });

test("a scanner's read spends nothing; the asking browser signs in", async ({
  page,
  context,
  request,
  anotherBrowser,
  passesTheAccessibilityGate,
}) => {
  const { email, token } = await aLinkAskedForIn(context, request, "Linden");

  const scanner = await anotherBrowser.newPage();
  await scanner.goto(linkTo(token));
  await expect(headingOf(scanner, "Enter This Code Where You Started")).toBeVisible();

  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();
  await expect(page.getByRole("status"), "the page does not say who signs in").toContainText(email);
  await expect(page, "the fragment lingers in the address").toHaveURL(/\/sign-in\/link$/);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Editor");
});

test("signing in by link in another tab lands the asker", async ({ page, context, request }) => {
  const { asking, token } = await aLinkAskedForIn(context, request, "Follow");

  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Editor");

  await landedAtHome(asking, "Editor");
});

test("another device shows the code and stays signed out", async ({
  page,
  context,
  request,
  anotherBrowser,
}) => {
  const { email, asking, token } = await aLinkAskedForIn(anotherBrowser, request, "Ashby");
  const code = await codeSentTo(request, email);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(linkTo(token));
  await expect(headingOf(page, "Enter This Code Where You Started")).toBeVisible();
  await expect(page.getByText(codeShown(code))).toBeVisible();
  await expect(signInButton(page)).toHaveCount(0);

  const saidOfTheCopy = page.getByRole("status").last();
  await expect(saidOfTheCopy, "the copy's status holds words before a copy").toBeEmpty();
  await page.getByRole("button", { name: "Copy Code" }).click();
  await expect(saidOfTheCopy, "the page says nothing of the copy").toHaveText(/\S/);
  await page.bringToFront();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied, "the copy is not the six digits alone").toBe(code);

  const later = await context.newPage();
  await later.goto("/");
  await expect(signInHeading(later), "the link signed this browser in").toBeVisible();
  await later.close();

  await typedWhereItStarted(asking, code);
});

test("the code reads as six digits, and c copies it", async ({
  page,
  context,
  request,
  anotherBrowser,
}) => {
  const { email, token } = await aLinkAskedForIn(anotherBrowser, request, "Digits");
  const code = await codeSentTo(request, email);

  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const described = page.waitForResponse(
    (answered) => new URL(answered.url()).pathname === DESCRIBE_PATH,
  );
  await page.goto(linkTo(token));
  const { until } = elsewhere.parse(await (await described).json());
  const untilTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(until),
  );
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Enter This Code Where You Started" [level=1]
      - status
      - paragraph: ${JSON.stringify(codeSpelled(code))}
      - paragraph: /${untilTime}/
      - button "Copy Code"
      - paragraph:
        - strong
      - button "Keyboard Shortcuts"
  `);
  await expect(page.getByRole("status").first(), "the page says nothing of the code").toHaveText(
    /\S/,
  );

  await clockTheNextKey(page, {
    at: "//main[(.//*[@role='status'])[last()][normalize-space(.)]]",
    reads: "Enter This Code Where You Started",
  });
  await page.keyboard.press("c");
  await theActionLandedWithinItsBudget(page, "copy");
});
