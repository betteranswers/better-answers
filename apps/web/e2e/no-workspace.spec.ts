import type { APIRequestContext, Page, Response } from "@playwright/test";

import { ASK_TO_JOIN_WORDS } from "@/features/auth/ask-to-join-words.ts";
import { INVITATION_WORDS } from "@/features/auth/invitation-words.ts";
import { INVITATIONS_UNANSWERED } from "@/features/auth/refusal-words.ts";
import {
  NO_WORKSPACE_ACTS,
  NO_WORKSPACE_HEADING,
  NO_WORKSPACE_WORDS,
} from "@/features/auth/workspace-words.ts";
import { KEYSTROKE_WORDS } from "@/shared/keystroke-words.ts";
import type { Role } from "@/shared/navigation.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

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
  person,
  provision,
  quoted,
  signIn,
  signInHeading,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

/** Stated, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const INVITATIONS_READ = "/trpc/person.invitations";

const INVITATIONS_READ_ROUTE = `**${INVITATIONS_READ}*`;

const landedAt = (page: Page): URL => new URL(page.url());

const noWorkspaceHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING });

const claudeLine = (page: Page) => page.getByText(NO_WORKSPACE_WORDS.claudeAfterJoining);

const invitations = (page: Page) =>
  page.getByRole("region", { name: NO_WORKSPACE_WORDS.invitations });

const invitationTo = (page: Page, workspace: string) =>
  invitations(page).getByRole("link", { name: workspace, exact: true });

const askRegion = (page: Page) => page.getByRole("region", { name: ASK_TO_JOIN_WORDS.heading });

const consentHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Connect Claude" });

/** Asked for before the page loads, so an absence asserted after it is the read's answer. */
const invitationsAnswered = (page: Page): Promise<Response> =>
  page.waitForResponse((response) => response.url().includes(INVITATIONS_READ));

/** A named person and their Admin's waiting invitation to them, before either signs in. */
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
  return {
    workspace,
    address,
    invitedAs: NO_WORKSPACE_WORDS.invitedAs(workspace.admin.name, role),
  };
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

test("tells a person from Claude it connects once they join", async ({
  page,
  request,
  baseURL,
}) => {
  const email = anAddress("connecting");
  await person(request, email);
  const answered = invitationsAnswered(page);

  await page.goto(claudesAuthorizeUrl(baseURL ?? ""));
  await expect(signInHeading(page, "connecting")).toBeVisible();
  await signIn(page, request, email);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  expect(landedAt(page).pathname).toBe("/no-workspace");
  expect(
    landedAt(page).searchParams.get("sig"),
    "the picker dropped Claude's query",
  ).not.toBeNull();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(NO_WORKSPACE_HEADING)} [level=1]
      - paragraph: ${quoted(NO_WORKSPACE_WORDS.claudeAfterJoining)}
      - region ${quoted(ASK_TO_JOIN_WORDS.heading)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await answered;
  await expect(invitations(page), "a person with none was shown invitations").toHaveCount(0);
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
  const { workspace, address, invitedAs } = await anInvitation(request, "Calder Joinery", "Editor");
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
      - heading ${quoted(NO_WORKSPACE_HEADING)} [level=1]
      - region ${quoted(NO_WORKSPACE_WORDS.invitations)}:
        - heading ${quoted(NO_WORKSPACE_WORDS.invitations)} [level=2]
        - list:
          - listitem:
            - link ${quoted(workspace.name)}
            - paragraph: ${quoted(invitedAs)}
      - region ${quoted(ASK_TO_JOIN_WORDS.heading)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await expect(
    invitations(page).getByRole("listitem"),
    "another's invitation was shown",
  ).toHaveCount(1);
  await expect(invitationTo(page, workspace.name)).toHaveAccessibleDescription(invitedAs);
  await expect(claudeLine(page)).toHaveCount(0);
  await passesTheAccessibilityGate();

  const keystrokes = await keystrokesListed(page, "this page");
  await expect(keystrokes).toContainText(NO_WORKSPACE_ACTS.toInvitations);
  await keystrokesDismissed(page, keystrokes);
  await page.keyboard.press("i");
  await expect(invitationTo(page, workspace.name)).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("heading", { level: 1, name: INVITATION_WORDS.heading(workspace.name) }),
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
  await expect(page.getByRole("alert")).toHaveText(sentenceOf(INVITATIONS_UNANSWERED), {
    timeout: 15_000,
  });
  await expect(invitations(page)).toHaveCount(0);
  await expect(askRegion(page)).toBeVisible();
  await passesTheAccessibilityGate();

  await page.unroute(INVITATIONS_READ_ROUTE);
  const keystrokes = await keystrokesListed(page, "this page");
  await expect(keystrokes).toContainText(NO_WORKSPACE_ACTS.readAgain);
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
  const { workspace, address, invitedAs } = await anInvitation(
    request,
    "Ryedale Metalwork",
    "Viewer",
  );
  await catchClaudesRedirect(page);

  await page.goto(claudesAuthorizeUrl(baseURL ?? "", { prompt: "consent", state: "joined-first" }));
  await signIn(page, request, address);

  await expect(noWorkspaceHeading(page)).toBeVisible();
  await expect(page.getByRole("main")).toMatchAriaSnapshot(`
    - main:
      - heading ${quoted(NO_WORKSPACE_HEADING)} [level=1]
      - paragraph: ${quoted(NO_WORKSPACE_WORDS.claudeAfterJoining)}
      - region ${quoted(NO_WORKSPACE_WORDS.invitations)}:
        - heading ${quoted(NO_WORKSPACE_WORDS.invitations)} [level=2]
        - list:
          - listitem:
            - link ${quoted(workspace.name)}
            - paragraph: ${quoted(invitedAs)}
      - region ${quoted(ASK_TO_JOIN_WORDS.heading)}
      - button "Sign out"
      - button ${quoted(KEYSTROKE_WORDS.button)}
  `);
  await passesTheAccessibilityGate();

  await invitationTo(page, workspace.name).click();
  await expect(
    page.getByRole("heading", { level: 1, name: INVITATION_WORDS.heading(workspace.name) }),
  ).toBeVisible();
  expect(landedAt(page).searchParams.get("sig"), "the link dropped Claude's query").not.toBeNull();
  await page.getByRole("button", { name: INVITATION_WORDS.join(workspace.name) }).click();

  await expect(consentHeading(page)).toBeVisible();
  await expect(page.getByText(`Claude will act as you, at ${workspace.name}.`)).toBeVisible();
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
  const { workspace, address } = await anInvitation(request, "Harrow Glazing", "Viewer");
  await page.goto(claudesAuthorizeUrl(baseURL ?? ""));
  await signIn(page, request, address);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  await page.goto(`/no-workspace${lapsed(landedAt(page).search)}`);
  await expect(claudeLine(page)).toBeVisible();
  await invitationTo(page, workspace.name).click();
  await page.getByRole("button", { name: INVITATION_WORDS.join(workspace.name) }).click();

  await landedAtHome(page, "Viewer");
  await expect(consentHeading(page)).toHaveCount(0);
});

test("signs out for good once Claude's request has lapsed", async ({ page, request, baseURL }) => {
  const email = anAddress("leaving");
  await person(request, email);
  await page.goto(claudesAuthorizeUrl(baseURL ?? ""));
  await signIn(page, request, email);
  await expect(noWorkspaceHeading(page)).toBeVisible();

  await page.goto(`/no-workspace${lapsed(landedAt(page).search)}`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(signInHeading(page)).toBeVisible();

  await page.goto("/choose-workspace");
  await expect(signInHeading(page), "the session outlived its sign-out").toBeVisible();
  await expect(noWorkspaceHeading(page)).toHaveCount(0);
});
