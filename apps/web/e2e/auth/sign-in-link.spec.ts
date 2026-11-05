import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { z } from "zod";

import { codeSpelled } from "@/features/auth/sign-in/link-words.ts";

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

const openedAfresh = async (page: Page, address: string): Promise<void> => {
  await page.goto("about:blank");
  await page.goto(address);
};

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

const signInButton = (page: Page) => page.getByRole("button", { name: "Sign In", exact: true });

test("a sign-in link opened in another tab signs in both", async ({ page, context, request }) => {
  const { asking, token } = await aLinkAskedForIn(context, request, "Follow");

  await page.goto(linkTo(token));
  await expect(signInButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await landedAtHome(page, "Editor");

  await landedAtHome(asking, "Editor");
});

test("another browser shows the link's code, and c copies it", async ({
  page,
  context,
  request,
  anotherBrowser,
  passesTheAccessibilityGate,
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
  await expect(
    page.getByRole("status").first(),
    "the page shows no status message about the code",
  ).toHaveText(/\S/);

  await clockTheNextKey(page, {
    at: "//main[(.//*[@role='status'])[last()][normalize-space(.)]]",
    reads: "Enter This Code Where You Started",
  });
  await page.keyboard.press("c");
  await theActionLandedWithinItsBudget(page, "copy");

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Copy Code" }),
    "Tab did not reach Copy Code",
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Keyboard Shortcuts" })).toBeFocused();
  await passesTheAccessibilityGate();

  await test.step("the earlier visit does not use up the link, so the first browser signs in", async () => {
    await context.addCookies(await anotherBrowser.cookies());
    await openedAfresh(page, linkTo(token));
    await expect(signInButton(page)).toBeFocused();
    await expect(
      page.getByRole("status"),
      "the status does not name the email that signs in",
    ).toContainText(email);
    await expect(page, "the link token is still in the URL").toHaveURL(/\/sign-in\/link$/);
    await passesTheAccessibilityGate();

    await page.keyboard.press("Enter");
    await landedAtHome(page, "Editor");
  });
});
