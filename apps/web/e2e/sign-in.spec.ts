import type { APIRequestContext, Page } from "@playwright/test";
import { z } from "zod";

import { ACCOUNT_HEADING } from "@/features/auth/account-words.ts";
import { ASK_TO_JOIN_WORDS } from "@/features/auth/ask-to-join-words.ts";
import {
  codeWrong,
  noLongerAMember,
  PICK_REFUSED,
  SOLE_PICK_REFUSED,
  tooManyCodesAskedFor,
  WORKSPACES_UNREAD,
} from "@/features/auth/refusal-words.ts";
import {
  codeSent,
  newCodeSent,
  sendingANewCode,
  SIGN_IN_WORDS,
  type CarriedOn,
} from "@/features/auth/sign-in-words.ts";
import {
  NO_WORKSPACE_HEADING,
  PICKER_ACTIONS,
  PICKER_WORDS,
} from "@/features/auth/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  ageTheCode,
  anAddress,
  claudesAuthorizeUrl,
  clockTheNextKey,
  codeSentTo,
  confirmedWhenAsked,
  invite,
  keystrokesButton,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  quoted,
  removeMember,
  signedInAtHome,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
  theActionLandedWithinItsBudget,
  tokenColour,
  drawnMarks,
} from "./harness.ts";

const thePicker = (page: Page) =>
  page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading });

const SEND_PATH = "/email-otp/send-verification-otp";

const codeField = (page: Page) => page.getByLabel(SIGN_IN_WORDS.codeField, { exact: true });

/** Asked for before the action that sends, or the answer can land before anything waits for it. */
const theSendsAnswer = (page: Page) =>
  page.waitForResponse((response) => new URL(response.url()).pathname === SEND_PATH);

/** The wait the ceiling named, in whole seconds. */
const waitNamedBy = async (answered: ReturnType<typeof theSendsAnswer>): Promise<number> => {
  const response = await answered;
  expect(response.status(), "the send was not refused by a ceiling").toBe(429);
  const waitSeconds = Number(response.headers()["retry-after"]);
  expect(Number.isInteger(waitSeconds), "the ceiling's refusal named no wait").toBe(true);
  return waitSeconds;
};

/** A code asked for at the email step meets a ceiling, and the page says the wait it named. */
const theSendIsRefusedNamingItsWait = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  const answered = theSendsAnswer(page);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();

  const said = sentenceOf(tooManyCodesAskedFor(await waitNamedBy(answered)));
  await expect(page.getByRole("alert")).toHaveText(said);
};

/** From the email step the page shows to the code step, through the product's own page. */
const sendTheFirstCode = async (page: Page, email: string): Promise<void> => {
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();
  await expect(page.getByRole("status")).toHaveText(codeSent(email));
};

const atTheCodeStep = async (page: Page, email: string): Promise<void> => {
  await page.goto("/sign-in");
  await sendTheFirstCode(page, email);
};

/** Wrong unless the code sent was six zeros, one chance in a million. */
const aWrongCodeIsRefused = async (page: Page): Promise<void> => {
  await codeField(page).fill("000000");
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(codeWrong(2)));
};

/** Never the code sent: six digits `step` past it, wrapping at a million. */
const notTheCode = (code: string, step: number): string =>
  String((Number(code) + step) % 1_000_000).padStart(6, "0");

const SIGN_IN_PATH = "/sign-in/email-otp";

/** Every code the page sends the api from now on, so a resend shows as a second entry. */
const codesSentFrom = (page: Page): readonly string[] => {
  const sent: string[] = [];
  page.on("request", (asked) => {
    if (new URL(asked.url()).pathname === SIGN_IN_PATH) sent.push(asked.url());
  });
  return sent;
};

/** Through the clipboard and the keyboard, as a person pastes a code copied from the email. */
const pastedIntoTheField = async (page: Page, copied: string): Promise<void> => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), copied);
  await codeField(page).focus();
  await page.keyboard.press("ControlOrMeta+V");
};

/** Headless Chromium shows every tab, so a tab's being hidden or shown is set and told by hand. */
const shownAs = (page: Page, state: DocumentVisibilityState): Promise<void> =>
  page.evaluate((now) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => now });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

/** A frame and a task, so what the page does with an answer it holds is done before a spec reads it. */
const aFramePassed = (page: Page): Promise<void> =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => setTimeout(done));
      }),
  );

/** Runs what makes the page re-read its session, then holds that the page still waits at /sign-in. */
const stillWaitingOnceReread = async (page: Page, prompt: () => Promise<void>): Promise<void> => {
  const reread = page.waitForRequest((asked) => new URL(asked.url()).pathname === "/get-session");
  await prompt();
  await (await (await reread).response())?.finished();
  await aFramePassed(page);
  await expect(page, "the waiting tab left the code step").toHaveURL(/\/sign-in/);
};

const SESSION_READ = "**/get-session*";

const heldSession = z.object({ session: z.object({ id: z.string() }) });

/** As the api reads this browser's cookie, so a session begun since names a new id. */
const sessionHeldBy = async (page: Page): Promise<string> =>
  heldSession.parse(await (await page.request.get("/get-session")).json()).session.id;

const floodCodesTo = async (request: APIRequestContext, email: string, count: number) => {
  for (let asked = 0; asked < count; asked += 1) {
    await request.post(SEND_PATH, { data: { email, type: "sign-in" } });
  }
};

const NO_WE = /\bwe\b/i;

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

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
const theWorkspacesRead = (url: URL): boolean => url.pathname.includes("person.workspaces");

const rowsOf = (page: Page) => page.getByRole("main").getByRole("listitem");

test("shows a member of two workspaces their role in each", async ({ page, request }) => {
  const email = anAddress("roles");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "Acme Fabrication",
    second: "Beta Fabrication",
  });
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page.getByRole("main").getByRole("list")).toMatchAriaSnapshot(`
    - list:
      - listitem:
        - button ${quoted(first.name)}
        - text: Admin
      - listitem:
        - button ${quoted(second.name)}
        - text: Viewer
  `);
  const acme = page.getByRole("button", { name: first.name, exact: true });
  await expect(acme, "a screen reader hears no role with the button").toHaveAccessibleDescription(
    "Admin",
  );

  await acme.click();
  await landedAtHome(page, "Admin");
  await expect(page.getByRole("banner").getByText(first.name)).toBeVisible();
});

test("lists a member's workspaces within a second", async ({ page, request }) => {
  const email = anAddress("listed");
  await memberOfTwoWorkspaces(request, email, { first: "Timed Forgings", second: "Timed Fabrics" });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(rowsOf(page)).toHaveCount(2);

  // A fresh document, so no list is already in the page's cache.
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
  await expect(page.getByRole("button", { name: "Choose a workspace" })).toHaveCount(0);

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
  await expect(page.getByText(PICKER_WORDS.lead)).toBeVisible();
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
      - heading ${quoted(PICKER_WORDS.heading)} [level=1]
      - paragraph: ${quoted(PICKER_WORDS.lead)}
      - list
      - link ${quoted(ACCOUNT_HEADING)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await workspaces.first().focus();
  await page.keyboard.press("Tab");
  await expect(workspaces.last(), "a role tag took a stop between the workspaces").toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: ACCOUNT_HEADING })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(keystrokesButton(page)).toBeFocused();

  const listed = await keystrokesListed(page, PICKER_WORDS.heading);
  await expect(listed).toContainText(PICKER_ACTIONS.toWorkspaces);
  await keystrokesDismissed(page, listed);
  await page.keyboard.press("w");
  await expect(workspaces.first()).toBeFocused();
});

test("offers one way on to a person in no workspace", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "nobody");

  await expect(page.getByRole("region", { name: ASK_TO_JOIN_WORDS.heading })).toBeVisible();

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(signInHeading(page)).toBeVisible();
});

test("names the product in tab and banner, beside its logo", async ({ page }) => {
  await page.goto("/sign-in");

  await expect(page).toHaveTitle(PRODUCT_NAME);
  const icon = (await page.locator('head link[rel="icon"]').getAttribute("href")) ?? "";
  const inline = /^data:image\/svg\+xml,(?<drawn>.*)$/.exec(icon)?.groups?.["drawn"];
  expect(inline, "the tab icon is not an inline SVG").toBeDefined();
  const drawn = decodeURIComponent(inline ?? "");
  expect(drawn, "the tab icon is not the logo").toContain(`<title>${PRODUCT_NAME}</title>`);
  expect(drawn, "the logo no longer takes the icon's colour").toContain('fill="currentColor"');
  expect(drawn, "a dark tab strip would hide the icon").toMatch(
    /@media \(prefers-color-scheme:dark\)\{svg\{color:#[\da-f]{6}\}\}/,
  );

  const banner = page.getByRole("banner");
  await expect(banner).toHaveText(PRODUCT_NAME, { useInnerText: true });
  await expect(banner.getByRole("img", { name: PRODUCT_NAME, includeHidden: true })).toBeVisible();
  await expect(banner.getByRole("img"), "the name would be heard twice").toHaveCount(0);
});

test("draws the outline edge hairline and the send ink blue", async ({ page }) => {
  await page.goto("/sign-in");
  const passkey = page.getByRole("button", { name: SIGN_IN_WORDS.passkey });
  const send = page.getByRole("button", { name: SIGN_IN_WORDS.send });

  await expect(passkey, "the outline button's edge is not the control edge").toHaveCSS(
    "border-top-color",
    await tokenColour(page, "--border-default"),
  );
  await expect(send, "the primary button is not the accent fill").toHaveCSS(
    "background-color",
    await tokenColour(page, "--accent-600"),
  );
  await expect(send, "the primary button's words are not white").toHaveCSS(
    "color",
    await tokenColour(page, "--text-on-accent"),
  );
});

test("says a code is sent, wrong, or asked too often", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const email = anAddress("words");
  await provision(request, { name: "Words", adminEmail: email });

  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByText(SIGN_IN_WORDS.emailStep.nothing.hint)).toBeVisible();
  await expect(page.locator("body"), "the email step says we").not.toContainText(NO_WE);

  await sendTheFirstCode(page, email);
  await expect(page.locator("body"), "the code step says we").not.toContainText(NO_WE);

  await aWrongCodeIsRefused(page);
  await passesTheAccessibilityGate();

  // `request` has a client address of its own, so the ceiling this trips is the per-email one.
  const flooded = anAddress("flood");
  await floodCodesTo(request, flooded, 6);

  await page.getByRole("button", { name: SIGN_IN_WORDS.otherAddress }).click();
  await theSendIsRefusedNamingItsWait(page, flooded);
  // Red words alone: the system never draws a coloured rule beside them.
  await expect(page.getByRole("alert")).toHaveCSS("border-left-width", "0px");
});

test("frames the sign-in form in one marked card", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();

  expect(await drawnMarks(page), "the card stands for its primary button").toEqual(["card"]);
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.send })).toHaveAttribute(
    "data-marks",
  );
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

test("draws a row of secondary actions in one treatment", async ({ page, request }) => {
  const email = anAddress("row");
  await provision(request, { name: "Row", adminEmail: email });
  await page.goto("/sign-in");
  await sendTheFirstCode(page, email);

  const row = page.getByRole("button", { name: SIGN_IN_WORDS.sendAgain }).locator("..");
  const treatments = await row
    .getByRole("button")
    .evaluateAll((buttons) => [...new Set(buttons.map((button) => button.dataset["variant"]))]);
  expect(treatments, "the row mixes its treatments").toEqual(["outline"]);
});

test("names the wait when one client asks too many codes", async ({ page }) => {
  await page.goto("/sign-in");
  // The page's own client address asks each code for another email, so no per-email ceiling is met.
  for (let asked = 0; asked < 5; asked += 1) {
    await page.request.post(SEND_PATH, { data: { email: anAddress("spread"), type: "sign-in" } });
  }

  await theSendIsRefusedNamingItsWait(page, anAddress("sixth"));
});

const invitedTo = async (request: APIRequestContext, name: string): Promise<string> => {
  const workspace = await provision(request, { name });
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email: anAddress("invited"),
    inviterId: workspace.admin.id,
    role: "Editor",
  });
  return `/invitations/${invited.id}`;
};

const namesWhereItCarries = async (page: Page, carriedOn: CarriedOn): Promise<void> => {
  await expect(page).toHaveURL(/\/sign-in\?/);
  await expect(signInHeading(page, carriedOn)).toBeVisible();
  await expect(page.getByText(SIGN_IN_WORDS.emailStep[carriedOn].hint)).toBeVisible();
};

test("names joining a workspace when sign-in carries an invitation", async ({ page, request }) => {
  await page.goto(await invitedTo(request, "Joining Ltd"));

  await namesWhereItCarries(page, "joining");
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(SIGN_IN_WORDS.emailStep.joining.title)} [level=1]
      - paragraph: ${quoted(SIGN_IN_WORDS.emailStep.joining.hint)}
      - text: ${quoted(SIGN_IN_WORDS.emailField)}
      - textbox ${quoted(SIGN_IN_WORDS.emailField)}
      - button ${quoted(SIGN_IN_WORDS.send)}
  `);
});

test("names connecting Claude when sign-in carries Claude's request", async ({ page, baseURL }) => {
  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent" }));

  await namesWhereItCarries(page, "connecting");
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

  await page.getByRole("button", { name: SIGN_IN_WORDS.sendAgain }).click();

  await expect(page.getByRole("status")).toHaveText(newCodeSent(email));
  const refused = page.getByRole("alert", { includeHidden: true });
  await expect(refused, "the wrong code's refusal outlived the new code").toBeEmpty();
  await expect(codeField(page), "the new code's field did not take focus").toBeFocused();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(SIGN_IN_WORDS.codeTitle)} [level=1]
      - status: ${quoted(newCodeSent(email))}
      - text: ${quoted(SIGN_IN_WORDS.codeField)}
      - textbox ${quoted(SIGN_IN_WORDS.codeField)}
      - button ${quoted(SIGN_IN_WORDS.signIn)}
      - button ${quoted(SIGN_IN_WORDS.sendAgain)}
      - button ${quoted(SIGN_IN_WORDS.otherAddress)}
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
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
  // The page sent one, so four more reach the per-email ceiling and the next is refused.
  await floodCodesTo(request, email, 4);

  await page.keyboard.press("Tab");
  const listed = await keystrokesListed(page, KEYSTROKE_WORDS.thisPage);
  await expect(listed.getByText(SIGN_IN_WORDS.sendAgain)).toBeVisible();
  await expect(listed.getByText(SIGN_IN_WORDS.otherAddress)).toBeVisible();
  await keystrokesDismissed(page, listed);

  await clockTheNextKey(page, { at: "//*[@role='status']", reads: sendingANewCode(email) });
  const answered = theSendsAnswer(page);
  await page.keyboard.press("n");
  await theActionLandedWithinItsBudget(page, "send a new code");

  const said = sentenceOf(tooManyCodesAskedFor(await waitNamedBy(answered)));
  await expect(page.getByRole("alert")).toHaveText(said);
  await passesTheAccessibilityGate();

  await page.keyboard.press("e");
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField), "focus left the way on").toBeFocused();
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toHaveValue(email);
});

test("announces a sent code in the standing region, keeping focus", async ({ page, request }) => {
  const email = anAddress("stood");
  await person(request, email);

  await page.goto("/sign-in");
  await expect(signInHeading(page)).toBeVisible();

  const said = page.getByRole("status", { includeHidden: true });
  const refused = page.getByRole("alert", { includeHidden: true });
  await expect(said, "the sign-in page stands no status region").toHaveCount(1);
  await expect(said, "the status region stands with words already in it").toBeEmpty();
  await expect(refused, "the sign-in page stands no alert region").toHaveCount(1);
  await expect(refused, "the alert region stands with words already in it").toBeEmpty();
  const stood = await said.elementHandle();

  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  await page.getByLabel(SIGN_IN_WORDS.emailField).press("Enter");

  await expect(said).toContainText(email);
  const sameRegion = await said.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the code step said the code went in a status region of its own").toBe(true);
  await expect(refused, "the code step stood an alert region of its own").toHaveCount(1);
  await expect(refused, "the code step's alert region holds words").toBeEmpty();
  await expect(codeField(page), "sending the code took focus from the field").toBeFocused();
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

test("drops letters, and five digits never sign in", async ({ page, request }) => {
  const email = anAddress("five");
  await person(request, email);
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);
  const sent = codesSentFrom(page);

  await pastedIntoTheField(page, `${code.slice(0, 2)}ab${code.slice(2, 5)}`);
  await expect(codeField(page)).toHaveValue(code.slice(0, 5));
  await page.keyboard.press("Enter");
  await page.keyboard.type(code.slice(5));

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  expect(sent, "five digits were sent").toHaveLength(1);
});

test("sends a wrong code once, selected, naming two tries left", async ({ page, request }) => {
  const email = anAddress("wrong");
  await person(request, email);
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);
  const sent = codesSentFrom(page);

  await codeField(page).fill(notTheCode(code, 1));
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(codeWrong(2)));
  await expect(codeField(page)).toBeFocused();
  await expect(codeField(page)).toHaveAttribute("aria-invalid", "true");
  const selected = await codeField(page).evaluate((field: HTMLInputElement) => [
    field.selectionStart,
    field.selectionEnd,
  ]);
  expect(selected, "the refused digits are not selected").toEqual([0, 6]);

  await page.keyboard.press("Enter");
  await page.keyboard.type(notTheCode(code, 2));
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(codeWrong(1)));
  expect(sent, "the refused code was sent again").toHaveLength(2);
});

/** A spent code leaves focus on sending another, so Enter alone asks for the code that signs in. */
const anotherCodeSignsIn = async (page: Page, request: APIRequestContext, email: string) => {
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.sendAgain })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText(newCodeSent(email));
  await expect(codeField(page)).toBeFocused();
  await page.keyboard.type(await codeSentTo(request, email));
  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
};

test("a third wrong code hands focus to sending another", async ({ page, request }) => {
  const email = anAddress("spent");
  await person(request, email);
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);

  for (const left of [2, 1, 0]) {
    await codeField(page).fill(notTheCode(code, 3 - left));
    await expect(page.getByRole("alert")).toHaveText(sentenceOf(codeWrong(left)));
  }

  await anotherCodeSignsIn(page, request, email);
});

test("an expired code reads as spent, handing focus to another", async ({ page, request }) => {
  const email = anAddress("expired");
  await person(request, email);
  await atTheCodeStep(page, email);
  const code = await codeSentTo(request, email);
  await ageTheCode(request, email);

  await codeField(page).fill(code);
  await expect(page.getByRole("alert"), "the expired code was not refused as spent").toHaveText(
    sentenceOf(codeWrong(0)),
  );

  await anotherCodeSignsIn(page, request, email);
});

/**
 * A following tab reads where to go before the other tab confirms, so an Editor, needing no second
 * factor, shows the following alone.
 */
const anEditorOf = async (request: APIRequestContext, name: string): Promise<string> => {
  const email = anAddress("tabs");
  const who = await person(request, email, { displayName: "Tam Editor" });
  const workspace = await provision(request, { name });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  return email;
};

test("a code typed in another tab lands the waiting one", async ({ page, context, request }) => {
  const email = await anEditorOf(request, "Two Tabs Ltd");
  await atTheCodeStep(page, email);

  const other = await context.newPage();
  await other.goto("/sign-in");
  await signIn(other, request, email);
  await landedAtHome(other, "Editor");

  await landedAtHome(page, "Editor");
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

/** The query client asks a failed read three times before it gives up. */
const READ_ATTEMPTS = 3;

test("a tab whose first read failed still follows a sign-in", async ({
  page,
  context,
  request,
}) => {
  const email = await anEditorOf(request, "Unread Ltd");
  await page.goto("/sign-in");
  const unread = Promise.withResolvers<void>();
  let refused = 0;
  await page.route(SESSION_READ, async (route) => {
    await route.fulfill({ status: 503 });
    refused += 1;
    if (refused === READ_ATTEMPTS) unread.resolve();
  });
  await sendTheFirstCode(page, email);
  await unread.promise;
  await page.unroute(SESSION_READ);

  await shownAs(page, "hidden");
  await stillWaitingOnceReread(page, () => shownAs(page, "visible"));
  const other = await context.newPage();
  await other.goto("/sign-in");
  await signIn(other, request, email);

  await landedAtHome(page, "Editor");
});

test("a tab hidden through a sign-in lands once shown", async ({ page, context, request }) => {
  // This tab never hears the announcement, so only its being shown again can land it.
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "BroadcastChannel");
  });
  const email = anAddress("hidden");
  await provision(request, { name: "Hidden Tab Ltd", adminEmail: email });
  await atTheCodeStep(page, email);
  await shownAs(page, "hidden");

  const other = await context.newPage();
  await other.goto("/sign-in");
  await signIn(other, request, email);
  await landedAtHome(other, "Admin");
  await expect(codeField(page), "the hidden tab moved before it was shown").toBeVisible();

  await shownAs(page, "visible");
  await landedAtHome(page, "Admin");
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

/** A session begun before the person joined names no workspace, so the picker opens the one joined since. */
const joinedAfterSigningIn = async (page: Page, request: APIRequestContext, name: string) => {
  const who = await signedInWithNoWorkspace(page, request, "later");
  const workspace = await provision(request, { name });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  return workspace;
};

test("skips the picker for a workspace joined after sign-in", async ({ page, request }) => {
  const workspace = await joinedAfterSigningIn(page, request, "Arrived Late");
  await page.goto("/choose-workspace");

  await landedAtHome(page, "Editor");
  await expect(page.getByRole("banner").getByText(workspace.name)).toBeVisible();
  await expect(await personMenuOpened(page, "Test person")).toContainText("Editor");
  await expect(thePicker(page)).toHaveCount(0);
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
  await page.getByRole("button", { name: second.name }).click();

  await expect(page.getByRole("alert")).toHaveText(noLongerAMember(second.name));
  await expect(thePicker(page)).toBeVisible();
  await expect(page.getByRole("button", { name: second.name })).toHaveCount(0);
  const stillMine = page.getByRole("button", { name: first.name });
  await expect(stillMine, "focus was not left on what the reader can do next").toBeFocused();
  await passesTheAccessibilityGate();

  await page.keyboard.press("Enter");
  await landedAtHome(page, "Admin");
});

test("stops at one refused pick of a sole workspace", async ({ page, request }) => {
  await joinedAfterSigningIn(page, request, "Out Of Reach");
  let picks = 0;
  await page.route("**/organization/set-active", async (route) => {
    picks += 1;
    await route.abort();
  });
  await page.goto("/choose-workspace");

  await expect(page.getByRole("alert")).toHaveText(sentenceOf(SOLE_PICK_REFUSED));
  await expect(thePicker(page)).toBeVisible();
  expect(picks, "a refused pick was asked again").toBe(1);
});

test("keeps the list, saying so, when a pick is refused", async ({ page, request }) => {
  const email = anAddress("pickfails");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "Kept Listed",
    second: "Did Not Open",
  });
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await page.route("**/organization/set-active", (route) => route.abort());

  const picked = page.getByRole("button", { name: second.name });
  await picked.click();

  await expect(page.getByRole("alert")).toHaveText(sentenceOf(PICK_REFUSED));
  await expect(picked).toBeFocused();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();
});

test("sends a non-member from the picker to the refused page", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "none");

  await page.goto("/choose-workspace");

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("separates an unread workspace list from no workspace, offering retry", async ({
  page,
  request,
}) => {
  const email = anAddress("listfails");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "First List Failure",
    second: "Second List Failure",
  });

  await page.route(theWorkspacesRead, (route) => route.abort());

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page.getByRole("alert")).toHaveText(WORKSPACES_UNREAD, { timeout: 15_000 });
  await expect(thePicker(page)).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toHaveCount(0);

  await page.unroute(theWorkspacesRead);
  await page.getByRole("button", { name: PICKER_WORDS.tryAgain }).click();

  /* jscpd:ignore-start */
  await expect(page.getByText(PICKER_WORDS.lead)).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();
  await expect(page.getByRole("button", { name: second.name })).toBeVisible();
  /* jscpd:ignore-end */
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
  await expect(page.getByLabel(SIGN_IN_WORDS.emailField)).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: SIGN_IN_WORDS.send })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(codeField(page)).toBeVisible();
  const sixDigits = await codeSentTo(request, email);
  await codeField(page).focus();
  await page.keyboard.type(sixDigits);

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const signOut = page.getByRole("button", { name: "Sign out" });
  await signOut.focus();
  await expect(signOut).toBeFocused();

  const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
