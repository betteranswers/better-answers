import type { APIRequestContext, Page } from "@playwright/test";

import { INVITATION_ACTS, INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import { SAID_OF_ACCEPTING } from "@/features/auth/refusal-words.ts";
import { DISPLAY_NAME_REFUSED, DISPLAY_NAME_WORDS } from "@/shared/display-name-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import type { Role } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  clockTheNextKey,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  person,
  personMenuOpened,
  provision,
  quoted,
  saysItsSentenceNotItsWord,
  signIn,
  signInHeading,
  theActLandedWithinItsBudget,
} from "./harness.ts";

const READ_BUDGET_MS = 1000;

const INVITER = "Morgan Reid";

const SESSION_READ = "**/get-session*";

const invitationHeading = (page: Page, workspace: string) =>
  page.getByRole("heading", { level: 1, name: INVITATION_WORDS.heading(workspace) });

const joinButton = (page: Page, workspace: string) =>
  page.getByRole("button", { name: INVITATION_WORDS.join(workspace) });

const nameField = (page: Page) => page.getByLabel(DISPLAY_NAME_WORDS.label);

/** A workspace, a named inviter and a waiting invitation to a fresh address, not yet signed in. */
const anInvitation = async (request: APIRequestContext, workspaceName: string, role: Role) => {
  const workspace = await provision(request, { name: workspaceName });
  const inviter = await person(request, anAddress("morgan"), { displayName: INVITER });
  const address = anAddress("priya");
  const invited = await invite(request, {
    workspaceId: workspace.workspaceId,
    email: address,
    inviterId: inviter.id,
    role,
  });
  return { workspace, address, link: `/invitations/${invited.id}` };
};

test("an invited newcomer names themselves on the invitation, then joins", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Calder Joinery", "Editor");

  await page.goto(link);
  await expect(signInHeading(page, "joining")).toBeVisible();
  await signIn(page, request, address);

  await expect(invitationHeading(page, "Calder Joinery")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(INVITATION_WORDS.heading("Calder Joinery"))} [level=1]
      - paragraph: ${quoted(INVITATION_WORDS.body(INVITER, "Editor"))}
      - text: ${quoted(DISPLAY_NAME_WORDS.label)}
      - paragraph: ${quoted(DISPLAY_NAME_WORDS.hint)}
      - textbox ${quoted(DISPLAY_NAME_WORDS.label)}
      - button ${quoted(INVITATION_WORDS.join("Calder Joinery"))}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "this screen");
  await expect(keystrokes).toContainText(INVITATION_ACTS.join);
  await keystrokesDismissed(page, keystrokes);

  await nameField(page).fill("Priya Shah");
  await page.keyboard.press("Tab");
  await expect(joinButton(page, "Calder Joinery")).toBeFocused();
  await clockTheNextKey(page, {
    at: "//main//button[@type='submit']",
    reads: INVITATION_WORDS.joining,
  });
  await page.keyboard.press("j");
  await theActLandedWithinItsBudget(page, "name and accept");

  const bar = page.getByRole("banner");
  await expect(bar.getByText("Calder Joinery")).toBeVisible();
  await expect(await personMenuOpened(page, "Priya Shah")).toContainText("Editor");
});

test("a named invitee reads it within a second, joins keyboard-only", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Ryedale Metalwork", "Viewer");
  await person(request, address, { displayName: "Sam Okoro" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(invitationHeading(page, "Ryedale Metalwork")).toBeVisible();

  const started = Date.now();
  await page.goto(link);
  await expect(joinButton(page, "Ryedale Metalwork")).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "invitation read", description: `${elapsedMs} ms` });
  expect(elapsedMs, "the invitation was not read within its second").toBeLessThan(READ_BUDGET_MS);
  await expect(page.getByText(INVITATION_WORDS.body(INVITER, "Viewer"))).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);
  await passesTheAccessibilityGate();

  await page.keyboard.press("Tab");
  await expect(joinButton(page, "Ryedale Metalwork")).toBeFocused();
  const ring = await joinButton(page, "Ryedale Metalwork").evaluate(
    (element) => getComputedStyle(element).boxShadow,
  );
  expect(ring, "the focused act shows no focus ring").not.toBe("none");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("banner").getByText("Ryedale Metalwork")).toBeVisible();
});

test("refuses a bad name, joining nothing until it is fixed", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Harrow Glazing", "Viewer");
  await page.goto(link);
  await signIn(page, request, address);

  await nameField(page).fill("Priya <priya@acme.invalid>");
  await joinButton(page, "Harrow Glazing").click();

  const refusal = page.getByRole("alert");
  await saysItsSentenceNotItsWord(refusal, {
    table: DISPLAY_NAME_REFUSED,
    word: "display-name-angle-bracket",
  });
  await expect(refusal).toHaveCount(1);
  await expect(nameField(page)).toHaveAttribute("aria-invalid", "true");
  await expect(nameField(page)).toHaveAccessibleDescription(
    `${DISPLAY_NAME_WORDS.hint} ${sentenceOf(DISPLAY_NAME_REFUSED["display-name-angle-bracket"])}`,
  );
  await expect(invitationHeading(page, "Harrow Glazing")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${link}$`));
  await passesTheAccessibilityGate();

  await nameField(page).fill("Priya Shah");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("banner").getByText("Harrow Glazing")).toBeVisible();
});

test("keeps a given name when the join is then refused", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace, address, link } = await anInvitation(request, "Ashby Survey", "Editor");
  const invitee = await person(request, address, { displayName: "" });
  await page.goto(link);
  await signIn(page, request, address);
  await expect(nameField(page)).toBeVisible();
  await addMember(request, {
    workspaceId: workspace.workspaceId,
    userId: invitee.id,
    role: "Viewer",
  });

  await nameField(page).fill("Ines Moreau");
  await joinButton(page, "Ashby Survey").click();

  await saysItsSentenceNotItsWord(page.getByRole("alert"), {
    table: SAID_OF_ACCEPTING,
    word: "already-a-member",
  });
  await passesTheAccessibilityGate();

  await page.getByRole("button", { name: INVITATION_ACTS.yourWorkspaces }).click();
  await landedAtHome(page, "Viewer");
  await expect(page.getByRole("banner").getByRole("button", { name: /Ines Moreau/ })).toBeVisible();
});

test("asks for a name when the join finds none given", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Selby Roofing", "Viewer");
  await page.goto(link);
  await signIn(page, request, address);
  await expect(nameField(page)).toBeVisible();

  // The page's read of the session names someone the api does not, as a stale read would.
  await page.route(SESSION_READ, async (route) => {
    const answered = await route.fetch();
    const held: { readonly user: object } = await answered.json();
    await route.fulfill({
      response: answered,
      json: { ...held, user: { ...held.user, name: "Selina Held" } },
    });
  });
  await page.goto(link);
  await expect(joinButton(page, "Selby Roofing")).toBeVisible();
  await expect(nameField(page)).toHaveCount(0);

  await joinButton(page, "Selby Roofing").click();
  await saysItsSentenceNotItsWord(page.getByRole("alert"), {
    table: SAID_OF_ACCEPTING,
    word: "no-display-name",
  });
  await expect(nameField(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.unroute(SESSION_READ);
  await nameField(page).fill("Selina Hart");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("banner").getByRole("button", { name: /Selina Hart/ })).toBeVisible();
});

test("refuses a person at another address, offering the invited one", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { address, link } = await anInvitation(request, "Brightwater Estimating", "Editor");
  await person(request, address, { displayName: "Priya Shah" });
  const other = anAddress("theo");
  await person(request, other, { displayName: "Theo Other" });

  await page.goto(link);
  await signIn(page, request, other);

  const refused = sentenceOf(SAID_OF_ACCEPTING["invitation-for-another-address"]);
  await expect(page.getByRole("alert")).toHaveText(refused);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(INVITATION_WORDS.untitled)} [level=1]
      - alert: ${quoted(refused)}
      - button ${quoted(INVITATION_ACTS.anotherAddress)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await expect(page.getByRole("main")).not.toContainText("Brightwater Estimating");
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "this screen");
  await expect(keystrokes).toContainText(INVITATION_ACTS.anotherAddress);
  await page.keyboard.press("Escape");
  await expect(keystrokes).toBeHidden();
  await page.keyboard.press("s");
  await expect(signInHeading(page, "joining")).toBeVisible();
  await signIn(page, request, address);

  await expect(invitationHeading(page, "Brightwater Estimating")).toBeVisible();
});

test("tells a named person a stray link names no invitation", async ({ page, request }) => {
  const address = anAddress("stray");
  await person(request, address, { displayName: "Una Price" });

  await page.goto("/invitations/01J0000000000000000000000Z");
  await signIn(page, request, address);

  await saysItsSentenceNotItsWord(page.getByRole("alert"), {
    table: SAID_OF_ACCEPTING,
    word: "no-such-invitation",
  });
  await expect(page.getByRole("button", { name: /^Join/ })).toHaveCount(0);
});
