import type { APIRequestContext, Page } from "@playwright/test";

import { ASK_TO_JOIN_WORDS } from "@/features/auth/ask-to-join-words.ts";
import {
  CODE_REFUSED,
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
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";
import { PRODUCT_NAME } from "@/shared/words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  claudesAuthorizeUrl,
  clockTheNextKey,
  codeSentTo,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  quoted,
  removeMember,
  signedInWithNoWorkspace,
  signIn,
  signInHeading,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const thePicker = (page: Page) =>
  page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading });

const SEND_PATH = "/email-otp/send-verification-otp";

const codeField = (page: Page) => page.getByLabel(SIGN_IN_WORDS.codeField, { exact: true });

/** Asked for before the act that sends, or the answer can land before anything waits for it. */
const theSendsAnswer = (page: Page) =>
  page.waitForResponse((response) => new URL(response.url()).pathname === SEND_PATH);

/** The per-email ceiling names its wait in one header, Better Auth's per-client one in the other. */
const WAIT_HEADER = { perEmail: "retry-after", perClient: "x-retry-after" } as const;

/** The wait the ceiling named, in whole seconds, from the header that ceiling answers with. */
const waitNamedBy = async (
  answered: ReturnType<typeof theSendsAnswer>,
  ceiling: keyof typeof WAIT_HEADER,
): Promise<number> => {
  const response = await answered;
  expect(response.status(), "the send was not refused by a ceiling").toBe(429);
  const waitSeconds = Number(response.headers()[WAIT_HEADER[ceiling]]);
  expect(Number.isInteger(waitSeconds), "the ceiling's refusal named no wait").toBe(true);
  return waitSeconds;
};

/** From the email step the page shows to the code step, through the product's own screen. */
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
  await page.getByRole("button", { name: SIGN_IN_WORDS.signIn, exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(CODE_REFUSED));
};

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

test("offers one way on to a person with no membership", async ({ page, request }) => {
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
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(flooded);
  const answered = theSendsAnswer(page);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();

  const said = sentenceOf(tooManyCodesAskedFor(await waitNamedBy(answered, "perEmail")));
  await expect(page.getByRole("alert")).toHaveText(said);
});

test("names the wait when one client asks too many codes", async ({ page }) => {
  await page.goto("/sign-in");
  // The page's own client address asks each code for another email, so no per-email ceiling is met.
  for (let asked = 0; asked < 5; asked += 1) {
    await page.request.post(SEND_PATH, { data: { email: anAddress("spread"), type: "sign-in" } });
  }

  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(anAddress("sixth"));
  const answered = theSendsAnswer(page);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();

  const said = sentenceOf(tooManyCodesAskedFor(await waitNamedBy(answered, "perClient")));
  await expect(page.getByRole("alert")).toHaveText(said);
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
  await page.getByRole("button", { name: SIGN_IN_WORDS.signIn, exact: true }).click();

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
  // The screen sent one, so four more reach the per-email ceiling and the next is refused.
  await floodCodesTo(request, email, 4);

  await page.keyboard.press("Tab");
  const listed = await keystrokesListed(page, SIGN_IN_WORDS.keystrokesOn);
  await expect(listed.getByText(SIGN_IN_WORDS.sendAgain)).toBeVisible();
  await expect(listed.getByText(SIGN_IN_WORDS.otherAddress)).toBeVisible();
  await keystrokesDismissed(page, listed);

  await clockTheNextKey(page, { at: "//*[@role='status']", reads: sendingANewCode(email) });
  const answered = theSendsAnswer(page);
  await page.keyboard.press("n");
  await theActLandedWithinItsBudget(page, "send a new code");

  const said = sentenceOf(tooManyCodesAskedFor(await waitNamedBy(answered, "perEmail")));
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
  await expect(said, "the sign-in screen stands no status region").toHaveCount(1);
  await expect(said, "the status region stands with words already in it").toBeEmpty();
  await expect(refused, "the sign-in screen stands no alert region").toHaveCount(1);
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

/** A session begun with no membership names no workspace, so the picker opens the one joined since. */
const joinedAfterSigningIn = async (page: Page, request: APIRequestContext, name: string) => {
  const who = await signedInWithNoWorkspace(page, request, "later");
  const workspace = await provision(request, { name });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  return workspace;
};

test("skips the picker when the membership postdates the session", async ({ page, request }) => {
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

test("sends a non-member from the picker to the refused screen", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "none");

  await page.goto("/choose-workspace");

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("separates an unread workspace list from no membership, offering retry", async ({
  page,
  request,
}) => {
  const email = anAddress("listfails");
  const { first, second } = await memberOfTwoWorkspaces(request, email, {
    first: "First List Failure",
    second: "Second List Failure",
  });

  await page.route("**/organization/list", (route) => route.abort());

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page.getByRole("alert")).toHaveText(WORKSPACES_UNREAD, { timeout: 15_000 });
  await expect(thePicker(page)).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toHaveCount(0);

  await page.unroute("**/organization/list");
  await page.getByRole("button", { name: PICKER_WORDS.tryAgain }).click();

  /* jscpd:ignore-start */
  await expect(page.getByText(PICKER_WORDS.lead)).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();
  await expect(page.getByRole("button", { name: second.name })).toBeVisible();
  /* jscpd:ignore-end */
});

test("makes the screens outside the shell keyboard-operable, landmarked and labelled", async ({
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
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const signOut = page.getByRole("button", { name: "Sign out" });
  await signOut.focus();
  await expect(signOut).toBeFocused();

  const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
