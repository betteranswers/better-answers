import type { APIRequestContext } from "@playwright/test";

import { expect, test } from "./browser.ts";

import { addMember, anAddress, person, provision, removeMember, signIn } from "./harness.ts";

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

test("a member of one workspace lands in the shell, which names the workspace, the person and the role", async ({
  page,
  request,
}) => {
  const email = anAddress("sole");
  const workspace = await provision(request, { name: "Acme Joinery", adminEmail: email });

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByText(workspace.name)).toBeVisible();
  await expect(you.getByText(workspace.admin.name, { exact: false })).toBeVisible();
  await expect(you.getByText("Admin", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a workspace" })).toHaveCount(0);

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
});

test("a member of two workspaces picks one, and everything after is scoped to the pick", async ({
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

  await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);
  await page.getByRole("button", { name: second.name }).click();

  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByText(second.name)).toBeVisible();
  await expect(you.getByText("Viewer", { exact: false })).toBeVisible();
  await expect(you.getByText(first.name)).toHaveCount(0);
});

test("a signed-in person with no membership is refused, can sign out, and is offered no workspace to create", async ({
  page,
  request,
}) => {
  const email = anAddress("nobody");
  await person(request, email);

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
  await expect(page.getByText("An Admin adds people to a workspace")).toBeVisible();

  await expect(page.getByRole("button", { name: /create/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the sign-in screen says when a code was sent, when it did not work, and when too many were asked for", async ({
  page,
  request,
}) => {
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

test("a member of one workspace whose session predates the membership is still never asked to pick", async ({
  page,
  request,
}) => {
  /* jscpd:ignore-start */
  const email = anAddress("later");
  const who = await person(request, email);
  await page.goto("/sign-in");
  await signIn(page, request, email);
  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
  /* jscpd:ignore-end */

  const workspace = await provision(request, { name: "Arrived Late" });
  await addMember(request, { workspaceId: workspace.workspaceId, userId: who.id, role: "Editor" });
  await page.goto("/choose-workspace");

  await expect(page).toHaveURL(/\/system\/routes-and-spend$/);
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByText(workspace.name)).toBeVisible();
  await expect(you.getByText("Editor", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toHaveCount(0);
});

test("a pick of a workspace the person no longer belongs to is refused in words", async ({
  page,
  request,
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

  await expect(page.getByRole("alert")).toContainText("That workspace could not be opened");

  await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
});

test("the picker sends a person who is a member of nothing to the refused screen", async ({
  page,
  request,
}) => {
  const email = anAddress("none");
  await person(request, email);
  await page.goto("/sign-in");
  await signIn(page, request, email);

  await page.goto("/choose-workspace");

  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("the picker says when the workspace list could not be read, distinct from no membership, and a retry carries the person on (T-062)", async ({
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

  await expect(page.getByRole("alert")).toContainText("Your workspaces could not be read", {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: "Workspaces" })).toBeVisible();

  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toHaveCount(0);

  await page.unroute("**/organization/list");
  await page.getByRole("button", { name: "Try again" }).click();

  /* jscpd:ignore-start */
  await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();
  await expect(page.getByRole("button", { name: second.name })).toBeVisible();
  /* jscpd:ignore-end */
});

test("the three screens outside the shell are keyboard-operable, landmarked and labelled", async ({
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
  const code = await request.get(`/__harness/codes?email=${encodeURIComponent(email)}`);
  const { code: sixDigits } = (await code.json()) as { code: string };
  await page.getByLabel("Code").focus();
  await page.keyboard.type(sixDigits);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const signOut = page.getByRole("button", { name: "Sign out" });
  await signOut.focus();
  await expect(signOut).toBeFocused();

  const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
