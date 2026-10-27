import assert from "node:assert/strict";

import type { APIRequestContext, Page, Response } from "@playwright/test";

import type { Role } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  anAddress,
  catchClaudesRedirect,
  CLAUDES_REDIRECT_URI,
  claudesAuthorizeUrl,
  invite,
  keystrokesDismissed,
  keystrokesListed,
  landedAtHome,
  markTheOperator,
  person,
  provision,
  saysARefusal,
  signIn,
  signInHeading,
  withAnAuthenticator,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const INVITATIONS_READ = "/trpc/person.invitations";

const INVITATIONS_READ_ROUTE = `**${INVITATIONS_READ}*`;

const landedAt = (page: Page): URL => new URL(page.url());

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "No Workspace Yet" });

const claudeLine = (page: Page) => page.getByRole("main").getByText(/\bClaude\b/);

const invitations = (page: Page) => page.getByRole("region", { name: "Your Invitations" });

const invitationTo = (page: Page, workspace: string) =>
  invitations(page).getByRole("link", { name: workspace, exact: true });

const askRegion = (page: Page) => page.getByRole("region", { name: "Ask to Join a Workspace" });

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

const invitationsAnswered = (page: Page): Promise<Response> =>
  page.waitForResponse((response) => response.url().includes(INVITATIONS_READ));

const anInvitation = async (request: APIRequestContext, workspaceName: string, role: Role) => {
  const address = anAddress("priya");
  await person(request, address, { displayName: "Priya Shah" });
  const workspace = await provision(request, { name: workspaceName });
  await invite(request, {
    workspaceId: workspace.workspaceId,
    email: address,
    inviterId: workspace.admin.id,
    role,
  });
  return { workspace, address };
};

/**
 * The page reads only `exp`; the api refuses this query in the one check that also refuses a
 * lapsed one.
 */
const lapsed = (search: string): string => {
  const query = new URLSearchParams(search);
  query.set("exp", "1");
  return `?${query.toString()}`;
};

const landedConnecting = async (
  page: Page,
  request: APIRequestContext,
  origin: string,
  email: string,
) => {
  await page.goto(claudesAuthorizeUrl(origin));
  await expect(signInHeading(page, "connecting")).toBeVisible();
  await signIn(page, request, email);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/no-workspace");
  expect(
    landedAt(page).searchParams.get("sig"),
    "the picker dropped Claude's query",
  ).not.toBeNull();
};

test("tells a person from Claude it connects once they join", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("connecting");
  await person(request, email);
  const answered = invitationsAnswered(page);

  await landedConnecting(page, request, baseURL, email);
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "No Workspace Yet" [level=1]
      - paragraph
      - region "Ask to Join a Workspace"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await expect(claudeLine(page)).toBeVisible();
  await answered;
  await expect(invitations(page), "a person with none was shown invitations").toHaveCount(0);
});

test("keeps an operator connecting Claude on the no-workspace page", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("operator");
  await person(request, email);
  await markTheOperator(request, email);
  await withAnAuthenticator(request, email);

  await landedConnecting(page, request, baseURL, email);
  await expect(claudeLine(page)).toBeVisible();
});

test("says nothing of Claude or invitations to an ordinary arrival", async ({ page, request }) => {
  const email = anAddress("ordinary");
  await person(request, email);
  const answered = invitationsAnswered(page);

  await page.goto("/sign-in");
  await signIn(page, request, email);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  await answered;
  await expect(claudeLine(page), "Claude was named to a person not connecting it").toHaveCount(0);
  await expect(invitations(page), "a person with none was shown invitations").toHaveCount(0);
  await expect(askRegion(page)).toBeVisible();
});

test("lists a waiting invitation within a second, then joins it", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace, address } = await anInvitation(request, "Calder Joinery", "Editor");
  const elsewhere = await provision(request, { name: "Elsewhere Ltd" });
  await invite(request, {
    workspaceId: elsewhere.workspaceId,
    email: anAddress("someone-else"),
    inviterId: elsewhere.admin.id,
    role: "Viewer",
  });
  await page.goto("/sign-in");
  await signIn(page, request, address);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  const started = Date.now();
  await page.goto("/no-workspace");
  await expect(invitationTo(page, workspace.name)).toBeVisible();
  const elapsedMs = Date.now() - started;
  test.info().annotations.push({ type: "invitations read", description: `${elapsedMs} ms` });
  expect(elapsedMs, "the invitations were not read within their second").toBeLessThan(
    LIST_BUDGET_MS,
  );

  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "No Workspace Yet" [level=1]
      - region "Your Invitations":
        - heading "Your Invitations" [level=2]
        - list:
          - listitem:
            - link ${JSON.stringify(workspace.name)}
            - paragraph
      - region "Ask to Join a Workspace"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await expect(
    invitations(page).getByRole("listitem"),
    "another's invitation was shown",
  ).toHaveCount(1);
  const invitation = invitationTo(page, workspace.name);
  await expect(invitation, "the link does not say who invited").toHaveAccessibleDescription(
    new RegExp(workspace.admin.name),
  );
  await expect(invitation, "the link does not say the role").toHaveAccessibleDescription(
    /\bEditor\b/,
  );
  await expect(claudeLine(page)).toHaveCount(0);
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "This Page");
  await expect(keystrokes.getByRole("term").filter({ hasText: /^i$/ })).toBeVisible();
  await keystrokesDismissed(page, keystrokes);
  await page.keyboard.press("i");
  await expect(invitationTo(page, workspace.name)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: `Your Invitation to ${workspace.name}` }),
  ).toBeVisible();
  await page.keyboard.press("j");
  await landedAtHome(page, "Editor");
});

test("offers to read the invitations again when no answer came", async ({
  page,
  request,
  passesTheAccessibilityGate,
}) => {
  const { workspace, address } = await anInvitation(request, "Selby Roofing", "Viewer");
  await page.goto("/sign-in");
  await signIn(page, request, address);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  await page.route(INVITATIONS_READ_ROUTE, (route) => route.abort());
  await page.goto("/no-workspace");

  // The query client asks twice more before it gives up, a second apart and then two.
  await saysARefusal(page.getByRole("alert"), { timeout: 15_000 });
  await expect(invitations(page)).toHaveCount(0);
  await expect(askRegion(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.unroute(INVITATIONS_READ_ROUTE);
  const keystrokes = await keystrokesListed(page, "This Page");
  await expect(keystrokes.getByRole("term").filter({ hasText: /^r$/ })).toBeVisible();
  await keystrokesDismissed(page, keystrokes);
  await page.keyboard.press("r");

  await expect(invitationTo(page, workspace.name)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("carries Claude's request through a join to consent", async ({
  page,
  request,
  baseURL,
  passesTheAccessibilityGate,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const { workspace, address } = await anInvitation(request, "Ryedale Metalwork", "Viewer");
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL, { prompt: "consent", state: "joined-first" }));
  await signIn(page, request, address);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading "No Workspace Yet" [level=1]
      - paragraph
      - region "Your Invitations":
        - heading "Your Invitations" [level=2]
        - list:
          - listitem:
            - link ${JSON.stringify(workspace.name)}
            - paragraph
      - region "Ask to Join a Workspace"
      - button "Sign Out"
      - button "Keyboard Shortcuts"
  `);
  await passesTheAccessibilityGate();

  await invitationTo(page, workspace.name).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Your Invitation to ${workspace.name}` }),
  ).toBeVisible();
  expect(landedAt(page).searchParams.get("sig"), "the link dropped Claude's query").not.toBeNull();
  await page.getByRole("button", { name: "Join Workspace" }).click();

  await expect(consentHeading(page)).toBeVisible();
  await expect(
    page
      .getByRole("main")
      .getByRole("paragraph")
      .getByRole("strong")
      .filter({ hasText: workspace.name }),
    "consent names another workspace",
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect" }).click();
  const callback = landedAt(page);
  expect(`${callback.origin}${callback.pathname}`).toBe(CLAUDES_REDIRECT_URI);
  expect(callback.searchParams.get("code")).not.toBeNull();
  expect(callback.searchParams.get("state")).toBe("joined-first");
});

test("lands a join at home once Claude's request has lapsed", async ({
  page,
  request,
  baseURL,
}) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const { workspace, address } = await anInvitation(request, "Harrow Glazing", "Viewer");
  await page.goto(claudesAuthorizeUrl(baseURL));
  await signIn(page, request, address);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  await page.goto(`/no-workspace${lapsed(landedAt(page).search)}`);
  await expect(claudeLine(page)).toBeVisible();
  await invitationTo(page, workspace.name).click();
  await page.getByRole("button", { name: "Join Workspace" }).click();

  await landedAtHome(page, "Viewer");
  await expect(consentHeading(page)).toHaveCount(0);
});

test("signs out for good once Claude's request has lapsed", async ({ page, request, baseURL }) => {
  assert.ok(baseURL !== undefined, "playwright.config.ts gives the suite a baseURL");
  const email = anAddress("leaving");
  await person(request, email);
  await page.goto(claudesAuthorizeUrl(baseURL));
  await signIn(page, request, email);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  await page.goto(`/no-workspace${lapsed(landedAt(page).search)}`);
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(signInHeading(page)).toBeVisible();

  await page.goto("/choose-workspace");
  await expect(signInHeading(page), "the session outlived its sign-out").toBeVisible();
  await expect(noWorkspaceHeading(page)).toHaveCount(0);
});
