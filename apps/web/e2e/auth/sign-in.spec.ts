import type { APIRequestContext, Locator, Page } from "@playwright/test";

import { expect, test } from "../browser.ts";
import {
  addMember,
  ageTheCode,
  anAddress,
  clockTheNextKey,
  codeSentTo,
  confirmedWhenAsked,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  removeMember,
  saysSomethingNew,
  saysARefusal,
  saysTheWait,
  signIn,
  signInHeading,
  theActionLandedWithinItsBudget,
} from "../harness.ts";
import { scrolledSideways } from "../knowledge.ts";
import { authAnswering } from "../refused-read.ts";

const thePicker = (page: Page) => page.getByRole("heading", { level: 1, name: "Your Workspaces" });

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

const theSendIsRefusedNamingItsWait = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel("Email Address").fill(email);
  const answered = theSendsAnswer(page);
  await page.getByRole("button", { name: "Send Code" }).click();

  await saysTheWait(page.getByRole("alert"), await waitNamedBy(answered));
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

const SIGN_IN_PATH = "/sign-in/email-otp";

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

const stillWaitingOnceReread = async (page: Page, prompt: () => Promise<void>): Promise<void> => {
  const reread = page.waitForRequest((asked) => new URL(asked.url()).pathname === "/get-session");
  await prompt();
  await (await (await reread).response())?.finished();
  await aFramePassed(page);
  await expect(page, "the waiting tab left the code step").toHaveURL(/\/sign-in/);
};

const floodCodesTo = async (request: APIRequestContext, email: string, count: number) => {
  for (let asked = 0; asked < count; asked += 1) {
    await request.post(SEND_PATH, { data: { email, type: "sign-in" } });
  }
};

const memberOfTwoWorkspaces = async (
  request: APIRequestContext,
  email: string,
  names: { readonly first: string; readonly second: string },
) => {
  const first = await provision(request, { name: names.first, adminEmail: email });
  const second = await provision(request, { name: names.second });
  await addMember(request, {
    workspaceId: second.workspaceId,
    userId: first.admin.id,
    role: "Viewer",
  });
  return { first, second };
};

const LIST_BUDGET_MS = 1000;

const rowsOf = (page: Page) => page.getByRole("main").getByRole("listitem");

const linesOf = (button: Locator): Promise<number> =>
  button.evaluate((drawn) => {
    const text = document.createRange();
    text.selectNodeContents(drawn);
    return new Set([...text.getClientRects()].map((line) => Math.round(line.top))).size;
  });

test("keeps a long workspace name and role at 320 pixels", async ({ page, request }) => {
  const email = anAddress("narrow");
  const { first } = await memberOfTwoWorkspaces(request, email, {
    first: "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch Community Joinery",
    second: "Short Joinery",
  });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(thePicker(page)).toBeVisible();

  const named = page.getByRole("button", { name: first.name, exact: true });
  await expect(named).toHaveAccessibleDescription("Admin");
  expect(await linesOf(named), "the long name stays on one line").toBeGreaterThan(1);
  await expect(
    rowsOf(page).filter({ has: named }).getByText("Admin", { exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(await scrolledSideways(page), "the picker scrolls sideways at 320 pixels").toBe(0);
});

test("lists a member's workspaces within a second", async ({ page, request }) => {
  const email = anAddress("listed");
  await memberOfTwoWorkspaces(request, email, { first: "Timed Forgings", second: "Timed Fabrics" });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(rowsOf(page)).toHaveCount(2);

  const started = Date.now();
  await page.goto("/choose-workspace");
  await expect(rowsOf(page)).toHaveCount(2);
  const elapsed = Date.now() - started;
  test.info().annotations.push({ type: "workspace list", description: `${elapsed} ms` });
  expect(elapsed, "the list of two workspaces rendered past its budget").toBeLessThan(
    LIST_BUDGET_MS,
  );
});

test("lands a sole member in the shell: workspace, person, role", async ({ page, request }) => {
  const email = anAddress("sole");
  const workspace = await provision(request, { name: "Acme Joinery", adminEmail: email });

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await landedAtHome(page, "Admin");
  const bar = page.getByRole("banner");
  await expect(bar.getByText(workspace.name)).toBeVisible();
  const you = await personMenuOpened(page, workspace.admin.name);
  await expect(you.getByText(workspace.admin.name, { exact: true })).toBeVisible();
  await expect(you.getByText("Admin", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
});

test("scopes everything to the workspace a two-workspace member picks", async ({
  page,
  request,
}) => {
  const email = anAddress("both");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "Northern Tooling",
    second: "Southern Castings",
  });

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(thePicker(page)).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
  await page.getByRole("button", { name: second.name }).click();

  await landedAtHome(page, "Viewer");
  const bar = page.getByRole("banner");
  await expect(bar.getByText(second.name)).toBeVisible();
  await expect(bar.getByText(first.name)).toHaveCount(0);
  await expect(await personMenuOpened(page, first.admin.name)).toContainText("Viewer");
});

test("ends the chooser with Account, Sign out and Keyboard shortcuts", async ({
  page,
  request,
}) => {
  const email = anAddress("foot");
  await memberOfTwoWorkspaces(request, email, { first: "Foot Forgings", second: "Foot Fabrics" });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  const workspaces = page.getByRole("main").getByRole("listitem").getByRole("button");
  await expect(workspaces).toHaveCount(2);

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "Your Workspaces" [level=1]
      - paragraph
      - list
      - link "Account"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await workspaces.first().focus();
  await page.keyboard.press("Tab");
  await expect(workspaces.last(), "a role tag took a stop between the workspaces").toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Account" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign Out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keystrokesButton(page)).toBeFocused();

  const listed = await keystrokesListed(page, "Your Workspaces");
  await expect(listed.getByRole("term").filter({ hasText: /^w$/ })).toBeVisible();
  await keystrokesDismissed(page, listed);
  await page.keyboard.press("w");
  await expect(workspaces.first()).toBeFocused();
});

test("keeps the framed sign-in page inside 320 pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();

  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways, "the page scrolls sideways at 320px").toBe(0);
});

test("names the wait when one client asks too many codes", async ({ page }) => {
  await page.goto("/sign-in");
  for (let asked = 0; asked < 5; asked += 1) {
    await page.request.post(SEND_PATH, { data: { email: anAddress("spread"), type: "sign-in" } });
  }

  await theSendIsRefusedNamingItsWait(page, anAddress("sixth"));
});

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
  request,
  passesTheAccessibilityGate,
}) => {
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

for (const [named, between] of [
  ["a space", " "],
  ["a dash", "-"],
] as const) {
  test(`signs in from a code pasted with ${named}`, async ({ page, request }) => {
    const email = anAddress("pasted");
    await provision(request, { name: "Pasted Ltd", adminEmail: email });
    await atTheCodeStep(page, email);
    const code = await codeSentTo(request, email);

    await pastedIntoTheField(page, `${code.slice(0, 3)}${between}${code.slice(3)}`);

    await confirmedWhenAsked(page, request, email);
    await landedAtHome(page, "Admin");
  });
}

const anotherCodeSignsIn = async (page: Page, request: APIRequestContext, email: string) => {
  await expect(page.getByRole("button", { name: "Send a New Code" })).toBeFocused();
  const saidOfTheFirst = await page.getByRole("status").innerText();

  await page.keyboard.press("Enter");
  await expect(codeField(page)).toBeFocused();
  await expect(codeField(page), "the spent digits outlived the new code").toHaveValue("");
  await saysANewEmailWent(page, saidOfTheFirst);
  await page.keyboard.type(await codeSentTo(request, email));
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
};

test("an expired code reads as spent, handing focus to another", async ({ page, request }) => {
  const email = anAddress("expired");
  await person(request, email);
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);
  await ageTheCode(request, email);

  const refused = authAnswering(page, SIGN_IN_PATH);
  await codeField(page).fill(code);
  expect(await refused, "the expired code was not refused as spent").toMatchObject({
    code: "OTP_EXPIRED",
  });
  await saysARefusal(page.getByRole("alert"));

  await anotherCodeSignsIn(page, request, email);
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

test("drops and names a workspace the person was removed from", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("removed");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "Still Mine",
    second: "Taken Away",
  });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("button", { name: second.name })).toBeVisible();

  await removeMember(request, { workspaceId: second.workspaceId, userId: first.admin.id });
  const refused = authAnswering(page, "/organization/set-active");
  await page.getByRole("button", { name: second.name }).click();

  expect(await refused).toMatchObject({
    status: 403,
    code: "USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION",
  });
  await expect(page.getByRole("alert")).toContainText(second.name);
  await expect(thePicker(page)).toBeVisible();
  await expect(page.getByRole("button", { name: second.name })).toHaveCount(0);
  const stillMine = page.getByRole("button", { name: first.name });
  await expect(stillMine, "focus was not left on what the reader can do next").toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
});

test("makes the pages outside the shell keyboard-operable, landmarked and labelled", async ({
  page,
  request,
}) => {
  const email = anAddress("keyboard");
  await person(request, email);

  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();

  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email Address")).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send Code" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(codeField(page)).toBeVisible();
  const sixDigits = await codeSentTo(request, email);
  await codeField(page).focus();
  await page.keyboard.type(sixDigits);

  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const signOut = page.getByRole("button", { name: "Sign Out" });
  await signOut.focus();
  await expect(signOut).toBeFocused();

  const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
