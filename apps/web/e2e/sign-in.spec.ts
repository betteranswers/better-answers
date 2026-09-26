import type { APIRequestContext, Page } from "@playwright/test";

import { ASK_TO_JOIN_WORDS } from "@/features/auth/ask-to-join-words.ts";
import {
  noLongerAMember,
  PICK_REFUSED,
  SOLE_PICK_REFUSED,
  WORKSPACES_UNREAD,
} from "@/features/auth/refusal-words.ts";
import { NO_WORKSPACE_HEADING, PICKER_WORDS } from "@/features/auth/workspace-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  codeSentTo,
  landedAtHome,
  person,
  provision,
  removeMember,
  signedInWithNoWorkspace,
  signIn,
} from "./harness.ts";

const thePicker = (page: Page) =>
  page.getByRole("heading", { level: 1, name: PICKER_WORDS.heading });

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
  await expect(bar.getByText(workspace.admin.name, { exact: false })).toBeVisible();
  await expect(bar.getByText("Admin", { exact: false })).toBeVisible();
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
  await expect(bar.getByText("Viewer", { exact: false })).toBeVisible();
  await expect(bar.getByText(first.name)).toHaveCount(0);
});

test("offers one way on to a person with no membership", async ({ page, request }) => {
  await signedInWithNoWorkspace(page, request, "nobody");

  await expect(page.getByRole("region", { name: ASK_TO_JOIN_WORDS.heading })).toBeVisible();

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("says a code is sent, wrong, or asked too often", async ({ page, request }) => {
  const email = anAddress("words");
  await provision(request, { name: "Words", adminEmail: email });

  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();

  const said = page.getByRole("status");
  await expect(said).toContainText(`We have sent a six-digit code to ${email}`);
  await expect(said).toContainText("five minutes");

  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("That code did not work");

  // `request` has a client address of its own, so the ceiling this trips is the per-email one.
  const flooded = anAddress("flood");
  for (let asked = 0; asked < 6; asked += 1) {
    await request.post("/email-otp/send-verification-otp", {
      data: { email: flooded, type: "sign-in" },
    });
  }

  await page.getByRole("button", { name: "Use a different email address" }).click();
  await page.getByLabel("Email address").fill(flooded);
  await page.getByRole("button", { name: "Send code" }).click();

  await expect(page.getByRole("alert")).toContainText("Too many codes have been asked for");
});

test("announces a sent code in the standing region, keeping focus", async ({ page, request }) => {
  const email = anAddress("stood");
  await person(request, email);

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  const said = page.getByRole("status", { includeHidden: true });
  const refused = page.getByRole("alert", { includeHidden: true });
  await expect(said, "the sign-in screen stands no status region").toHaveCount(1);
  await expect(said, "the status region stands with words already in it").toBeEmpty();
  await expect(refused, "the sign-in screen stands no alert region").toHaveCount(1);
  await expect(refused, "the alert region stands with words already in it").toBeEmpty();
  const stood = await said.elementHandle();

  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Email address").press("Enter");

  await expect(said).toContainText(email);
  const sameRegion = await said.evaluate((now, then) => now === then, stood);
  expect(sameRegion, "the code step said the code went in a status region of its own").toBe(true);
  await expect(refused, "the code step stood an alert region of its own").toHaveCount(1);
  await expect(refused, "the code step's alert region holds words").toBeEmpty();
  await expect(page.getByLabel("Code"), "sending the code took focus from the field").toBeFocused();
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
  const bar = page.getByRole("banner");
  await expect(bar.getByText(workspace.name)).toBeVisible();
  await expect(bar.getByText("Editor", { exact: false })).toBeVisible();
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
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  await expect(page.getByRole("main")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send code" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByLabel("Code")).toBeVisible();
  const sixDigits = await codeSentTo(request, email);
  await page.getByLabel("Code").focus();
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
