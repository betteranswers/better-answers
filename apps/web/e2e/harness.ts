import { createHash, randomBytes } from "node:crypto";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

import type { REDACTION_TIERS, SENSITIVITIES } from "@better-answers/schema";

const HARNESS = "/__harness";

const aPerson = z.object({ id: z.string(), email: z.string(), name: z.string() });

const aProvisionedWorkspace = z.object({
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string(),
  admin: aPerson,
});

const memberAdded = z.object({ added: z.boolean() });
const credentialsRevoked = z.object({ revoked: z.boolean() });
const routesSeeded = z.object({ seeded: z.number() });
const codeSent = z.object({ code: z.string() });

const ask = async <T>(
  api: APIRequestContext,
  path: string,
  body: unknown,
  answer: z.ZodType<T>,
): Promise<T> => {
  const answered = await api.post(`${HARNESS}${path}`, { data: body });
  expect(answered.ok(), `${path} answered ${answered.status()}`).toBe(true);
  return answer.parse(await answered.json());
};

export const provision = (api: APIRequestContext, input: { name: string; adminEmail?: string }) =>
  ask(api, "/workspaces", input, aProvisionedWorkspace);

/**
 * A display name left out is the harness's own; an empty one is a person who has given none yet.
 */
export const person = (
  api: APIRequestContext,
  email: string,
  input: { displayName?: string } = {},
) => ask(api, "/people", { email, ...input }, aPerson);

export const addMember = (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; role: "Admin" | "Editor" | "Viewer" },
) => ask(api, "/members", input, memberAdded);

export const removeMember = async (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string },
): Promise<void> => {
  const answered = await api.delete(`${HARNESS}/members`, { data: input });
  expect(answered.ok(), `removing a member answered ${answered.status()}`).toBe(true);
};

export const revokeCredentials = (api: APIRequestContext, userId: string) =>
  ask(api, "/revocations", { userId }, credentialsRevoked);

const operatorMarked = z.object({ marked: z.boolean() });

/** The mark only an ops command sets, granted or cleared as that command does it. */
export const markTheOperator = (
  api: APIRequestContext,
  email: string,
  change: "grant" | "revoke" = "grant",
) => ask(api, "/operators", { email, change }, operatorMarked);
const invitationWritten = z.object({ id: z.string() });

/** A waiting invitation as the invite act leaves it, less the email, which no spec reads. */
export const invite = (
  api: APIRequestContext,
  input: {
    workspaceId: string;
    email: string;
    inviterId: string;
    role: "Admin" | "Editor" | "Viewer";
  },
) => ask(api, "/invitations", input, invitationWritten);

const signInAged = z.object({ aged: z.boolean() });

/** How a spec meets `sign-in-too-old` without waiting the hour out. */
export const ageTheSignIn = (api: APIRequestContext, userId: string) =>
  ask(api, "/sign-ins/aged", { userId }, signInAged);

export const CLAUDES_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const CLAUDE = {
  client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  redirect_uri: CLAUDES_REDIRECT_URI,
} as const;

/** A verifier and its challenge, as Claude mints a pair for each connection. */
export const aPkcePair = () => {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Claude's authorize request for the MCP surface at `origin`. */
export const claudesAuthorizeUrl = (
  origin: string,
  options: {
    readonly challenge?: string;
    readonly prompt?: "consent" | undefined;
    readonly state?: string;
  } = {},
): string => {
  const query = new URLSearchParams({
    ...CLAUDE,
    response_type: "code",
    code_challenge: options.challenge ?? aPkcePair().challenge,
    code_challenge_method: "S256",
    resource: `${origin}/mcp`,
    scope: "knowledge:read feedback:write offline_access",
    state: options.state ?? "state-from-the-host",
  });
  if (options.prompt !== undefined) query.set("prompt", options.prompt);
  return `/oauth2/authorize?${query.toString()}`;
};

/** claude.ai is out of the suite's reach, so a stand-in page answers its redirect. */
export const catchClaudesRedirect = (page: Page) =>
  page.route(`${CLAUDES_REDIRECT_URI}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Claude</title><p>The client received the redirect.</p>",
    }),
  );

/** The code exchanged as Claude does, which is when the grant's refresh token is minted. */
export const claudeExchanges = async (
  api: APIRequestContext,
  asked: { readonly origin: string; readonly code: string; readonly verifier: string },
): Promise<void> => {
  const exchanged = await api.post("/oauth2/token", {
    form: {
      ...CLAUDE,
      resource: `${asked.origin}/mcp`,
      grant_type: "authorization_code",
      code: asked.code,
      code_verifier: asked.verifier,
    },
  });
  expect(exchanged.ok(), `the code's exchange answered ${exchanged.status()}`).toBe(true);
};

export type SeedRoute = {
  readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
  readonly provider: string;
  readonly model: string;
};

/** A purpose `routes` leaves out has no route. */
export const seedRoutes = (
  api: APIRequestContext,
  input: { workspaceId: string; routes: readonly SeedRoute[] },
) => ask(api, "/routes", input, routesSeeded);

type Sensitivity = (typeof SENSITIVITIES)[number];

type SeedFinding = {
  readonly category: string;
  readonly ruleId: string;
  readonly tier: (typeof REDACTION_TIERS)[number];
  readonly spans: number;
  readonly kept?: boolean;
  readonly overriddenByErasure?: boolean;
  readonly dismissed?: number;
};

type SeedDocument = {
  readonly title: string;
  readonly sensitivity?: Sensitivity;
  readonly quarantineError?: string;
  readonly chunks?: readonly string[];
  readonly findings?: readonly SeedFinding[];
  readonly cited?: boolean;
};

export type SeedBinding = {
  readonly name: string;
  readonly sensitivity?: Sensitivity;
  readonly audience?: "everyone" | "groups";
  readonly run?: "none" | "queued" | "claimed" | "done";
  readonly published?: boolean;
  readonly documents?: readonly SeedDocument[];
};

const seededBindings = z.object({
  bindings: z.array(
    z.object({
      bindingId: z.string(),
      name: z.string(),
      documents: z.array(
        z.object({
          documentId: z.string(),
          title: z.string(),
          citedBy: z.object({ iri: z.string(), compositionId: z.string() }).nullable(),
        }),
      ),
    }),
  ),
});

export const seedBindings = (
  api: APIRequestContext,
  input: { workspaceId: string; bindings: readonly SeedBinding[] },
) => ask(api, "/bindings", input, seededBindings);

const indexRunMoved = z.object({ jobId: z.string() });

/**
 * The suite runs no worker, so a spec watching a state word move asks the harness for its steps.
 */
export const moveTheIndexRun = (
  api: APIRequestContext,
  input: { workspaceId: string; to: "claimed" | "done" },
) => ask(api, "/index-runs", input, indexRunMoved);

const groupsMade = z.object({ made: z.number() });

/**
 * Groups made by the member `userId` names, through the slice's own acts, each holding every one
 * of `memberIds`.
 */
export const makeGroups = (
  api: APIRequestContext,
  input: {
    workspaceId: string;
    userId: string;
    names: readonly string[];
    memberIds?: readonly string[];
  },
) => ask(api, "/groups", input, groupsMade);

const accessAsked = z.object({ asked: z.literal(true) });

/**
 * A person's ask to join a workspace by its slug, as the ask-to-join form leaves it, without the
 * sign-in the form needs.
 */
export const askToJoin = (
  api: APIRequestContext,
  input: { slug: string; requesterId: string; reason: string },
) => ask(api, "/access-requests", input, accessAsked);

const nameFlagged = z.object({ flagged: z.literal(true) });

/**
 * A workspace's Admin flags a member's display name, as the member sheet does, without the email to
 * the operator.
 */
export const flagTheName = (
  api: APIRequestContext,
  input: { workspaceId: string; adminId: string; personId: string },
) => ask(api, "/name-flags", input, nameFlagged);

/** The code the api captured for this address, in place of the email nobody receives. */
export const codeSentTo = async (api: APIRequestContext, email: string): Promise<string> => {
  const sent = await api.get(`${HARNESS}/codes?email=${encodeURIComponent(email)}`);
  expect(sent.ok(), "no code was captured for this address").toBe(true);
  return codeSent.parse(await sent.json()).code;
};

/** Timestamped and randomised, so a code read back for it is this test's alone. */
export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/** Sign-out is one disclosure in from the top bar, so a spec that leaves opens the menu first. */
export const signOutFromTheShell = async (page: Page, who: string): Promise<void> => {
  await page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(who) })
    .click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
};

/** Needs a page with nothing focused yet, so the first Tab lands on the skip link. */
export const skipLinkReachesTheScreen = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
};

export const tabUntilFocused = async (page: Page, target: Locator, most = 40): Promise<void> => {
  for (let pressed = 0; pressed < most; pressed += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "Tab never reached it").toBeFocused();
};

/**
 * A fresh document, so the first Tab starts from the top. Each arrow lands before the next, or
 * the tab's navigation swallows the second.
 */
export const tabOpenedByKeyboard = async (page: Page, path: string, name: string) => {
  await page.goto(path);
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();
  await skipLinkReachesTheScreen(page);
  await tabUntilFocused(page, page.getByRole("tab", { selected: true }));

  const names = await tabs.allInnerTexts();
  const from = names.indexOf(await page.getByRole("tab", { selected: true }).innerText());
  for (let at = from + 1; at <= names.indexOf(name); at += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(at)).toBeFocused();
  }
  await expect(page.getByRole("tab", { name }), `no tab ${name}`).toHaveAttribute(
    "aria-selected",
    "true",
  );
};

/** A role select in focus reading Viewer, opened, one step up to Editor and picked. */
export const editorPickedByKeyboard = async (page: Page, select: Locator): Promise<void> => {
  await expect(select).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Viewer" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "Editor" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(select).toBeFocused();
};

/** Starts on the sign-in screen the page already shows; it does not navigate there. */
export const signIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();

  const code = page.getByLabel("Code");
  await expect(code).toBeVisible();
  await code.fill(await codeSentTo(api, email));
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the screen to be left, not just the click: navigating away cancels the request
  // in flight and no session is set.
  await expect(code).toHaveCount(0);
};

/** Asked for before signing in, so the sign-in screen carries the member back to it. */
export const aMemberSignedInAt = async (
  page: Page,
  api: APIRequestContext,
  role: "Editor" | "Viewer",
  path: string,
) => {
  const email = anAddress(role.toLowerCase());
  const member = await person(api, email, { displayName: `A ${role}` });
  const workspace = await provision(api, { name: `A workspace of ${role}s` });
  await addMember(api, { role, userId: member.id, workspaceId: workspace.workspaceId });

  await page.goto(path);
  await signIn(page, api, email);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return workspace;
};

/** `?` opens a screen's keystrokes from anywhere on it outside a field. */
export const keystrokesListed = async (page: Page, screen: string): Promise<Locator> => {
  await page.keyboard.press("?");
  const listed = page.getByRole("dialog", { name: `Keystrokes on ${screen}` });
  await expect(listed).toBeVisible();
  return listed;
};

/** Focus returns to the button a task after the list is gone, taking it from a sooner key's. */
export const keystrokesDismissed = async (page: Page, listed: Locator): Promise<void> => {
  await page.keyboard.press("Escape");
  await expect(listed).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Keystrokes", exact: true })).toBeFocused();
};

/** From the sign-in screen to Control Centre's home, as a member of one workspace arrives. */
export const signedInAtHome = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
};

const ACT_BUDGET_MS = 100;

/**
 * Timed in the page, from the next key to the node at the XPath `at` reading `reads`: a matcher's
 * polling is coarser than the budget.
 */
export const clockTheNextKey = (
  page: Page,
  landed: { readonly at: string; readonly reads: string },
) =>
  page.evaluate((asked) => {
    const reads = () =>
      document
        .evaluate(asked.at, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE)
        .singleNodeValue?.textContent?.includes(asked.reads) === true;
    const clocked = new Promise<number>((resolve) => {
      document.addEventListener(
        "keydown",
        () => {
          const pressedAt = performance.now();
          const observer = new MutationObserver(() => {
            if (!reads()) return;
            observer.disconnect();
            resolve(performance.now() - pressedAt);
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        },
        { capture: true, once: true },
      );
    });
    Reflect.set(window, "actClocked", clocked);
  }, landed);

/** Reads the clock `clockTheNextKey` started, so that call comes before the key it times. */
export const theActLandedWithinItsBudget = async (page: Page, act: string): Promise<void> => {
  const elapsed = await page.evaluate(() => Reflect.get(window, "actClocked"));
  test.info().annotations.push({ type: `${act} act`, description: `${elapsed} ms` });
  expect(elapsed, `the ${act} did not read as landed within its budget`).toBeLessThan(
    ACT_BUDGET_MS,
  );
};
