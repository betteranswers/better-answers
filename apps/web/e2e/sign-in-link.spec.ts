import { randomInt } from "node:crypto";

import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { z } from "zod";

import { INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import {
  codeShown,
  codeSpelled,
  LINK_WORDS,
  signingInAs,
  worksUntil,
} from "@/features/auth/link-words.ts";
import { tooManyCodesTried } from "@/features/auth/refusal-words.ts";
import { newCodeSent, SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test as base } from "./browser.ts";
import {
  anAddress,
  clockTheNextKey,
  codeSentTo,
  invite,
  landedAtHome,
  linkSentTo,
  person,
  provision,
  quoted,
  signInHeading,
  theActLandedWithinItsBudget,
} from "./harness.ts";

/** `CLIENT_IP_HEADER`, named not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const CLIENT_IP_HEADER = "cf-connecting-ip";

let browsersOpened = 0;

/** A second device: no cookie of the page's, and a client address apart from both of the fixture's. */
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

/**
 * A workspace's Admin asks for a code on the sign-in screen in `asking`'s browser, which the
 * binding cookie makes the one the link signs in.
 */
const aLinkAskedForIn = async (asking: BrowserContext, api: APIRequestContext, who: string) => {
  const email = anAddress(who.toLowerCase());
  await provision(api, { name: `The ${who} workspace`, adminEmail: email });
  const page = await asking.newPage();
  await page.goto("/sign-in");
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel(SIGN_IN_WORDS.codeField, { exact: true })).toBeVisible();
  return { email, asking: page, token: await linkSentTo(api, email) };
};

/** As a person reading the code off the other device types it. */
const typedWhereItStarted = async (asking: Page, code: string): Promise<void> => {
  await asking.getByLabel(SIGN_IN_WORDS.codeField, { exact: true }).fill(code);
  await landedAtHome(asking, "Admin");
};

const headingOf = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });

const signInButton = (page: Page) =>
  page.getByRole("button", { name: SIGN_IN_WORDS.signIn, exact: true });

/** One refusal from a ceiling, naming its wait; the next ask reaches the api. */
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
    - heading ${quoted(LINK_WORDS.deadTitle)} [level=1]
    - status: ${quoted(LINK_WORDS.dead)}
    - link ${quoted(LINK_WORDS.backToSignIn)}:
      - /url: /sign-in
    - button ${quoted(KEYSTROKE_WORDS.button)}
`;

/** Answers what a screen reader hears, so two dead pages can be told identical. */
const theDeadPage = async (page: Page): Promise<string> => {
  const main = page.getByRole("main");
  await expect(main).toMatchAriaSnapshot(DEAD_PAGE);
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
  await expect(headingOf(scanner, LINK_WORDS.elsewhereTitle)).toBeVisible();

  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(signingInAs(email));
  await expect(page, "the fragment lingers in the address").toHaveURL(/\/sign-in\/link$/);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
});

test("signing in by link in another tab lands the asker", async ({ page, context, request }) => {
  const { asking, token } = await aLinkAskedForIn(context, request, "Follow");

  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");

  await landedAtHome(asking, "Admin");
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
  await expect(headingOf(page, LINK_WORDS.elsewhereTitle)).toBeVisible();
  await expect(page.getByText(codeShown(code))).toBeVisible();
  await expect(signInButton(page)).toHaveCount(0);

  await page.getByRole("button", { name: LINK_WORDS.copy }).click();
  await expect(page.getByRole("status").filter({ hasText: LINK_WORDS.copied })).toBeVisible();
  await page.bringToFront();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied, "the copy is not the six digits alone").toBe(code);

  const later = await context.newPage();
  await later.goto("/");
  await expect(signInHeading(later), "the link signed this browser in").toBeVisible();
  await later.close();

  await typedWhereItStarted(asking, code);
});

/**
 * Spent in a browser of its own: Better Auth counts every load of a `/sign-in` page, three per ten
 * seconds from one address.
 */
test("unknown, spent and superseded links show one dead page", async ({
  page,
  request,
  anotherBrowser,
}) => {
  const asked = await aLinkAskedForIn(anotherBrowser, request, "Dunmore");
  const { asking, token: superseded } = asked;
  await asking.getByRole("button", { name: SIGN_IN_WORDS.sendAgain }).click();
  await expect(asking.getByRole("status")).toHaveText(newCodeSent(asked.email));
  const spent = await linkSentTo(request, asked.email);
  expect(spent, "asking again sent the same link").not.toBe(superseded);

  await asking.goto(linkTo(spent));
  await signInButton(asking).click();
  await landedAtHome(asking, "Admin");

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
  await expect(page.getByRole("link", { name: LINK_WORDS.backToSignIn })).toBeFocused();
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
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(tooManyCodesTried(60)));
  await passesTheAccessibilityGate();
  await page.keyboard.press("r");

  await expect(signInButton(page)).toBeFocused();
  await expect(page.getByRole("status")).toHaveText(signingInAs(email));
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
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(tooManyCodesTried(120)));
  await expect(signInButton(page)).toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
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
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(LINK_WORDS.elsewhereTitle)} [level=1]
      - status: ${quoted(LINK_WORDS.elsewhere)}
      - paragraph: ${quoted(codeSpelled(code))}
      - paragraph: ${quoted(worksUntil(until))}
      - button ${quoted(LINK_WORDS.copy)}
      - paragraph:
        - strong: ${quoted(`${LINK_WORDS.warning} ${LINK_WORDS.neverShare}`)}
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);

  await clockTheNextKey(page, { at: "//main", reads: LINK_WORDS.copied });
  await page.keyboard.press("c");
  await theActLandedWithinItsBudget(page, "copy");
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
  await asking.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  await asking.keyboard.press("Enter");
  await expect(asking.getByLabel(SIGN_IN_WORDS.codeField, { exact: true })).toBeVisible();

  await page.goto(linkTo(await linkSentTo(request, email)));
  await expect(headingOf(page, SIGN_IN_WORDS.emailStep.joining.title)).toBeVisible();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: INVITATION_WORDS.heading("The Linnet workspace") }),
  ).toBeVisible();
});
