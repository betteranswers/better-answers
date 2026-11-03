import type { APIRequestContext, Page, Route } from "@playwright/test";
import { z } from "zod";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  codeSentTo,
  confirmedWhenAsked,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  provision,
  saysSomethingNew,
  saysTheWait,
  signedInAtHome,
  signIn,
  signInHeading,
  signOutFromTheShell,
  tabUntilFocused,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { scrolledSideways } from "../knowledge.ts";

const SEND_PATH = "/email-otp/send-verification-otp";

const codeField = (page: Page) => page.getByLabel("Verification Code", { exact: true });

const theSendsAnswer = (page: Page) =>
  page.waitForResponse((response) => new URL(response.url()).pathname === SEND_PATH);

const waitNamedBy = async (answered: ReturnType<typeof theSendsAnswer>): Promise<number> => {
  const response = await answered;
  expect(response.status(), "the send was not refused by a ceiling").toBe(429);
  const waitSeconds = Number(response.headers()["retry-after"]);
  expect(Number.isInteger(waitSeconds), "the ceiling's refusal named no wait").toBe(true);
  return waitSeconds;
};

const sendTheFirstCode = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel("Email Address").fill(email);
  await page.getByRole("button", { name: "Send Code" }).click();
  await expect(codeField(page)).toBeVisible();
  await expect(page.getByRole("status"), "the page says nothing of the email").toHaveText(/\S/);
};

const saysANewEmailWent = async (page: Page, earlier: string): Promise<void> => {
  await expect(
    page.getByRole("button", { name: "Send a New Code" }),
    "the new email is still sending",
  ).toHaveAttribute("aria-disabled", "false");
  await saysSomethingNew(page.getByRole("status"), earlier);
};

const asXPath = (words: string): string =>
  `concat(${words
    .split('"')
    .map((part) => `"${part}"`)
    .join(`, '"', `)}, "")`;

const atTheCodeStep = async (page: Page, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await sendTheFirstCode(page, email);
};

const triesLeft = (left: number): RegExp => new RegExp(String.raw`\b${String(left)}\b`);

const aWrongCodeIsRefused = async (page: Page): Promise<void> => {
  await codeField(page).fill("000000");
  await expect(page.getByRole("alert")).toHaveText(triesLeft(2));
};

const pastedIntoTheField = async (page: Page, copied: string): Promise<void> => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), copied);
  await codeField(page).focus();
  await page.keyboard.press("ControlOrMeta+V");
};

/** A frame and a task, so what the page does with an answer it holds is done before a spec reads it. */
const aFramePassed = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => setTimeout(done));
      }),
  );

/** Headless Chromium shows every tab, so a tab's being hidden or shown is set and told by hand. */
const shownAs = (page: Page, state: DocumentVisibilityState): Promise<void> =>
  page.evaluate((now) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => now });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

const stillWaitingOnceReread = async (page: Page, prompt: () => Promise<void>): Promise<void> => {
  const reread = page.waitForRequest((asked) => new URL(asked.url()).pathname === "/get-session");
  await prompt();
  await (await (await reread).response())?.finished();
  await aFramePassed(page);
  await expect(page, "the waiting tab left the code step").toHaveURL(/\/sign-in/);
};

const SESSION_READ = "**/get-session*";

const heldSession = z.object({ session: z.object({ id: z.string() }) });

const sessionHeldBy = async (page: Page): Promise<string> =>
  heldSession.parse(await (await page.request.get("/get-session")).json()).session.id;

const floodCodesTo = async (request: APIRequestContext, email: string, count: number) => {
  for (let asked = 0; asked < count; asked += 1) {
    await request.post(SEND_PATH, { data: { email, type: "sign-in" } });
  }
};

const anEditorOf = async (request: APIRequestContext, name: string): Promise<string> => {
  const email = anAddress("tabs");
  const who = await person(request, email, { displayName: "Tam Editor" });
  const workspace = await provision(request, { name });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  return email;
};

test("a new code sent from the code step signs in", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("again");
  await provision(request, { name: "Again Ltd", adminEmail: email });
  await atTheCodeStep(page, email);
  await aWrongCodeIsRefused(page);
  const saidOfTheFirst = await page.getByRole("status").innerText();

  await page.getByRole("button", { name: "Send a New Code" }).click();

  await expect(codeField(page), "the new code's field did not take focus").toBeFocused();
  await expect(codeField(page), "the refused digits outlived the new code").toHaveValue("");
  await saysANewEmailWent(page, saidOfTheFirst);
  const refused = page.getByRole("alert", { includeHidden: true });
  await expect(refused, "the wrong code's refusal outlived the new code").toBeEmpty();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Enter Your Code" [level=1]
      - status
      - textbox "Verification Code"
      - button "Sign In"
      - button "Send a New Code"
      - button "Use a Different Email Address"
      - button "Keyboard Shortcuts"
  `);
  const row = page.getByRole("button", { name: "Send a New Code" }).locator("..");
  const treatments = await Promise.all(
    (await row.getByRole("button").all()).map((button) =>
      button.evaluate((element) => {
        const { backgroundColor, borderTopColor, borderTopWidth, color } =
          getComputedStyle(element);
        return { backgroundColor, borderTopColor, borderTopWidth, color };
      }),
    ),
  );
  expect(treatments, "the row draws its three buttons").toHaveLength(3);
  for (const treatment of treatments) {
    expect(treatment, "the row mixes its treatments").toEqual(treatments[0]);
  }
  await passesTheAccessibilityGate();
  await codeField(page).fill(await codeSentTo(request, email));

  await confirmedWhenAsked(page, request, email);
  await landedAtHome(page, "Admin");
});

test("names the wait when a new code meets the ceiling", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  await test.step("keeps the framed sign-in page inside 320 pixels", async () => {
    const narrow = await context.newPage();
    await narrow.setViewportSize({ width: 320, height: 720 });
    await narrow.goto("/sign-in");
    await expect(signInHeading(narrow)).toBeVisible();
    expect(await scrolledSideways(narrow), "the page scrolls sideways at 320px").toBe(0);
    await narrow.close();
  });

  await test.step("makes the pages outside the shell keyboard-operable, landmarked and labelled", async () => {
    const keyboard = anAddress("keyboard");
    await person(request, keyboard);

    await page.goto("/sign-in");
    await expect(signInHeading(page)).toBeVisible();

    await expect(page.getByRole("main")).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Email Address")).toBeFocused();
    await page.keyboard.type(keyboard);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Send Code" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(codeField(page)).toBeVisible();
    const sixDigits = await codeSentTo(request, keyboard);
    await codeField(page).focus();
    await page.keyboard.type(sixDigits);

    await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
    const signOut = page.getByRole("button", { name: "Sign Out" });
    await tabUntilFocused(page, signOut);

    const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(ring).not.toBe("none");
  });

  await context.clearCookies();
  const email = anAddress("ceiling");
  await provision(request, { name: "Ceiling Ltd", adminEmail: email });
  await atTheCodeStep(page, email);
  await floodCodesTo(request, email, 4);

  await page.keyboard.press("Tab");
  const listed = await keystrokesListed(page, "This Page");
  await expect(listed.getByRole("term").filter({ hasText: /^n$/ })).toBeVisible();
  await expect(listed.getByRole("term").filter({ hasText: /^e$/ })).toBeVisible();
  await keystrokesDismissed(page, listed);

  const saidOfTheFirst = await page.getByRole("status").evaluate((status) => status.textContent);
  await clockTheNextKey(page, {
    at: `//main[.//*[@role='status'][string(.)!=${asXPath(saidOfTheFirst)}]]`,
    reads: "Enter Your Code",
  });
  const answered = theSendsAnswer(page);
  await page.keyboard.press("n");
  await theActionLandedWithinItsBudget(page, "send a new code");

  await saysTheWait(page.getByRole("alert"), await waitNamedBy(answered));
  await passesTheAccessibilityGate();

  await page.keyboard.press("e");
  await expect(page.getByLabel("Email Address"), "focus left the way on").toBeFocused();
  await expect(page.getByLabel("Email Address")).toHaveValue(email);
});

test("signs in from a code pasted with a space", async ({ page, request }) => {
  const email = anAddress("pasted");
  await provision(request, { name: "Pasted Ltd", adminEmail: email });
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);

  await pastedIntoTheField(page, `${code.slice(0, 3)} ${code.slice(3)}`);

  await confirmedWhenAsked(page, request, email);
  await landedAtHome(page, "Admin");
});

test("a tab waiting on one address ignores another's sign-in", async ({
  page,
  context,
  request,
}) => {
  const email = anAddress("asked");
  await provision(request, { name: "Asked Ltd", adminEmail: email });
  const elsewhere = anAddress("elsewhere");
  await provision(request, { name: "Elsewhere Ltd", adminEmail: elsewhere });
  await atTheCodeStep(page, email);

  const other = await context.newPage();
  await other.goto("/sign-in");
  await stillWaitingOnceReread(page, async () => {
    await signIn(other, request, elsewhere);
  });

  await codeField(page).pressSequentially(await codeSentTo(request, email));
  await confirmedWhenAsked(page, request, email);
  await landedAtHome(page, "Admin");
});

const READ_ATTEMPTS = 3;

const failingEveryRead = (times: number) => {
  const failed = Promise.withResolvers<void>();
  let refused = 0;
  return {
    failed: failed.promise,
    route: async (route: Route) => {
      await route.fulfill({ status: 503 });
      refused += 1;
      if (refused === times) failed.resolve();
    },
  };
};

test("a tab whose first read failed still follows a sign-in", async ({
  page,
  context,
  request,
}) => {
  const email = await anEditorOf(request, "Unread Ltd");
  await page.goto("/sign-in");
  const unread = failingEveryRead(READ_ATTEMPTS);
  await page.route(SESSION_READ, unread.route);
  await sendTheFirstCode(page, email);
  await unread.failed;
  await page.unroute(SESSION_READ);

  await shownAs(page, "hidden");
  await stillWaitingOnceReread(page, () => shownAs(page, "visible"));
  const other = await context.newPage();
  await other.goto("/sign-in");
  await signIn(other, request, email);

  await landedAtHome(page, "Editor");
});

test("a shown tab waits for a sign-in of its own", async ({ page, request }) => {
  const email = anAddress("standing");
  await provision(request, { name: "Standing Ltd", adminEmail: email });
  await signedInAtHome(page, request, email);
  const standing = await sessionHeldBy(page);
  await atTheCodeStep(page, email);

  await shownAs(page, "hidden");
  await stillWaitingOnceReread(page, () => shownAs(page, "visible"));
  await codeField(page).pressSequentially(await codeSentTo(request, email));
  await confirmedWhenAsked(page, request, email);
  await landedAtHome(page, "Admin");

  expect(await sessionHeldBy(page), "the tab landed on the session that stood").not.toBe(standing);
});

const signInSaysWhy = async (page: Page): Promise<string> => {
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByRole("status"), "the sign-in page says nothing of the arrival").toHaveText(
    /\S/,
  );
  return page.getByRole("status").innerText();
};

test("brings an ended session through sign-in back to its page", async ({
  page,
  context,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("returning");
  const workspace = await provision(request, { name: "Returning", adminEmail: email });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  const elsewhere = pageNamed(menuGroupIn(CONTROL_CENTRE, "system"), "Audit Log");
  await page.getByRole("link", { name: "Audit Log" }).click();
  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));

  await context.clearCookies();
  await page.reload();

  const ended = await signInSaysWhy(page);
  await passesTheAccessibilityGate();
  await signIn(page, request, email);

  await expect(page).toHaveURL(new RegExp(`${elsewhere.path}$`));
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();

  await signOutFromTheShell(page, workspace.admin.name);
  expect(await signInSaysWhy(page), "a sign-out read as an ended session").not.toBe(ended);
});
