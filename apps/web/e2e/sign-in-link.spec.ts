import { randomInt } from "node:crypto";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { z } from "zod";

import { codeShown, codeSpelled } from "@/features/auth/link-words.ts";

import { expect, test as base } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  codeSentTo,
  invite,
  landedAtHome,
  linkSentTo,
  person,
  provision,
  saysSomethingNew,
  saysTheWait,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "./harness.ts";

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

const SIGN_IN_PATH = "/sign-in-link/sign-in";

const elsewhere = z.object({ until: z.string() });

const TOKEN_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const aTokenNeverIssued = (): string =>
  Array.from({ length: 43 }, () => TOKEN_LETTERS.charAt(randomInt(TOKEN_LETTERS.length))).join("");

/** Through a blank page, so a link differing only in its fragment loads a fresh document. */
const freshlyOpened = async (page: Page, path: string): Promise<void> => {
  await page.goto("about:blank");
  await page.goto(path);
};

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

const refusedOnceAt = (page: Page, path: string, waitSeconds: number) =>
  page.route(
    `**${path}`,
    (route) =>
      route.fulfill({
        status: 429,
        headers: { "retry-after": String(waitSeconds) },
        json: { error: "too-many-requests" },
      }),
    { times: 1 },
  );

const DEAD_PAGE = `
  - main:
    - heading "This Sign-In Link No Longer Works" [level=1]
    - status
    - link "Back to Sign-In":
      - /url: /sign-in
    - button "Keyboard Shortcuts"
`;

const theDeadPage = async (page: Page): Promise<string> => {
  const main = page.getByRole("main");
  await expect(main).toMatchAriaSnapshot(DEAD_PAGE);
  await expect(main.getByRole("status"), "the dead page says nothing").toHaveText(/\S/);
  await expect(page, "the fragment lingers in the address").toHaveURL(/\/sign-in\/link$/);
  return main.ariaSnapshot();
};

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

test("unknown, spent and superseded links show one dead page", async ({
  page,
  request,
  anotherBrowser,
}) => {
  const asked = await aLinkAskedForIn(anotherBrowser, request, "Dunmore");
  const { asking, token: superseded } = asked;
  const saidOfTheFirst = await asking.getByRole("status").innerText();
  await asking.getByRole("button", { name: "Send a New Code" }).click();
  await expect(asking.getByLabel("Verification Code", { exact: true })).toBeFocused();
  await expect(
    asking.getByRole("button", { name: "Send a New Code" }),
    "the second email is still sending",
  ).toHaveAttribute("aria-disabled", "false");
  await saysSomethingNew(asking.getByRole("status"), saidOfTheFirst);
  const spent = await linkSentTo(request, asked.email);
  expect(spent, "asking again sent the same link").not.toBe(superseded);

  await asking.goto(linkTo(spent));
  await signInButton(asking).click();
  await landedAtHome(asking, "Editor");

  const heard: string[] = [];
  for (const token of [aTokenNeverIssued(), spent, superseded]) {
    await freshlyOpened(page, linkTo(token));
    heard.push(await theDeadPage(page));
  }
  expect(new Set(heard).size, "the dead pages differ").toBe(1);
});

test("a missing or malformed fragment shows the dead page unasked", async ({ page }) => {
  const described: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === DESCRIBE_PATH) described.push(sent.url());
  });

  await freshlyOpened(page, "/sign-in/link");
  await theDeadPage(page);
  await freshlyOpened(page, "/sign-in/link#not-a-token");
  await theDeadPage(page);
  expect(described, "a dead fragment still asked the api").toEqual([]);
});

test("a link spent after its read shows the dead page", async ({ page, context, request }) => {
  const { email, asking, token } = await aLinkAskedForIn(context, request, "Rook");
  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();

  await typedWhereItStarted(asking, await codeSentTo(request, email));
  await page.keyboard.press("Enter");

  await theDeadPage(page);
  await expect(page.getByRole("link", { name: "Back to Sign-In" })).toBeFocused();
});

test("a refused read offers to check the link again", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const { email, token } = await aLinkAskedForIn(context, request, "Reread");
  await refusedOnceAt(page, DESCRIBE_PATH, 60);

  await page.goto(linkTo(token));
  await saysTheWait(page.getByRole("alert"), 60);
  await passesTheAccessibilityGate();
  await page.keyboard.press("r");

  await expect(signInButton(page)).toBeFocused();
  await expect(page.getByRole("status"), "the page does not say who signs in").toContainText(email);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a ceiling's refusal names its wait, keeping Sign in focused", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const { token } = await aLinkAskedForIn(context, request, "Ceiling");
  await refusedOnceAt(page, SIGN_IN_PATH, 120);
  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();

  await page.keyboard.press("Enter");
  await saysTheWait(page.getByRole("alert"), 120);
  await expect(signInButton(page)).toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Editor");
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

test("an invitee signing in by link lands on the invitation", async ({
  page,
  context,
  request,
}) => {
  const workspace = await provision(request, { name: "The Linnet workspace" });
  const inviter = await person(request, anAddress("linnet-inviter"), {
    displayName: "Morgan Reid",
  });
  const email = anAddress("linnet-invitee");
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email,
    inviterId: inviter.id,
    role: "Editor",
  });
  const asking = await context.newPage();
  await asking.goto(`/invitations/${invited.id}`);
  await expect(signInHeading(asking, "joining")).toBeVisible();
  await asking.getByLabel("Email Address").fill(email);
  await asking.keyboard.press("Enter");
  await expect(asking.getByLabel("Verification Code", { exact: true })).toBeVisible();

  await page.goto(linkTo(await linkSentTo(request, email)));
  await expect(headingOf(page, "Sign In to Join a Workspace")).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: "Your Invitation to The Linnet workspace" }),
  ).toBeVisible();
});
