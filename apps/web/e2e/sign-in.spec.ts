import { expect, test } from "./browser.ts";

import { addMember, anAddress, person, provision, signIn } from "./harness.ts";

/**
 * T-037's acceptance seam: a person opens `app.`, signs in with a six-digit code, and
 * lands where their memberships say — in the shell, at the picker, or at the refused
 * screen. Every fact here is read from a real browser against the real server over a real
 * Postgres, and every workspace and code comes from the api's own harness.
 */

test("a member of one workspace lands in the shell, which names the workspace, the person and the role", async ({
  page,
  request,
}) => {
  const email = anAddress("sole");
  const workspace = await provision(request, { name: "Acme Joinery", adminEmail: email });

  await page.goto("/sign-in");
  await signIn(page, request, email);

  // Straight in: no picker, because a person with one workspace has no question to answer.
  await expect(page).toHaveURL(/\/system$/);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  const you = page.getByRole("region", { name: "You" });
  await expect(you.getByText(workspace.name)).toBeVisible();
  await expect(you.getByText(workspace.admin.name, { exact: false })).toBeVisible();
  await expect(you.getByText("Admin", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose a workspace" })).toHaveCount(0);
});

test("a member of two workspaces picks one, and everything after is scoped to the pick", async ({
  page,
  request,
}) => {
  const email = anAddress("both");
  const first = await provision(request, { name: "Northern Tooling", adminEmail: email });
  const second = await provision(request, { name: "Southern Castings" });
  await addMember(request, {
    workspaceId: second.workspaceId,
    userId: first.admin.id,
    role: "Viewer",
  });

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(page.getByRole("heading", { level: 1, name: "Choose a workspace" })).toBeVisible();
  await expect(page.getByRole("button", { name: first.name })).toBeVisible();
  await page.getByRole("button", { name: second.name }).click();

  // The shell names the workspace that was picked, at the role that workspace holds —
  // Viewer here, where the other one would have said Admin.
  await expect(page).toHaveURL(/\/system$/);
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
  // No way forward, and nowhere in the product is there one: workspaces are
  // platform-provisioned (T-004 judgement call 1).
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

  // Sent: said in words, and in a region a screen reader is told about.
  const said = page.getByRole("status");
  await expect(said).toContainText(`We have sent a six-digit code to ${email}`);
  await expect(said).toContainText("five minutes");

  // Did not work: said as a refusal, and the person is told what to do next.
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("That code did not work");

  // Too many: the platform's own per-email throttle, which is five codes in ten minutes
  // (`EMAIL_CODE_EMAIL_RULE`) whatever address they are asked from. The asking is done
  // outside the browser so that the screen is what is under test here and not the loop;
  // which counter refuses, and that it refuses across addresses, is proved at the endpoint
  // seam (`apps/api/tests/oauth-flow.test.ts`).
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

test("the three screens outside the shell are keyboard-operable, landmarked and labelled", async ({
  page,
  request,
}) => {
  const email = anAddress("keyboard");
  await person(request, email);

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

  // One main landmark, one first-level heading, and a labelled control reached by the
  // keyboard alone — the whole sign-in walked without a pointer (`[A11Y1]`).
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

  // The refused screen, reached without a pointer, and its one act reachable the same way.
  await expect(page.getByRole("heading", { level: 1, name: "No workspace yet" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveCount(1);
  const signOut = page.getByRole("button", { name: "Sign out" });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  // A visible focus ring, drawn by the design system on every focusable element.
  const ring = await signOut.evaluate((element) => getComputedStyle(element).boxShadow);
  expect(ring).not.toBe("none");
});
