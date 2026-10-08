import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import type { REDACTION_TIERS, SENSITIVITIES } from "@better-answers/schema";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { CONFIRM_WORDS, SETUP_WORDS } from "@/features/auth/second-factor-words.ts";
import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace-words.ts";

import { landedAtHome } from "./locators.ts";

export * from "./locators.ts";

const HARNESS = "/__harness";

const aPerson = z.object({ id: z.string(), email: z.string(), name: z.string() });

const aProvisionedWorkspace = z.object({
  workspaceId: z.string(),
  name: z.string(),
  shortName: z.string(),
  admin: aPerson,
});

const memberAdded = z.object({ added: z.boolean() });
const credentialsRevoked = z.object({ revoked: z.boolean() });
const modelChoicesSeeded = z.object({ seeded: z.number() });
const codeSent = z.object({ code: z.string() });
const linkSent = z.object({ token: z.string() });

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

export const endEverySignInAndToken = (api: APIRequestContext, userId: string) =>
  ask(api, "/revocations", { userId }, credentialsRevoked);

const operatorMarked = z.object({ marked: z.boolean() });

/** The mark only an ops command sets, granted or cleared as that command does it. */
export const markTheOperator = (
  api: APIRequestContext,
  email: string,
  change: "grant" | "revoke" = "grant",
) => ask(api, "/operators", { email, change }, operatorMarked);
const invitationWritten = z.object({ id: z.string() });

/** The store keeps Better Auth's spelling; a spec says the glossary's. */
const STORED_STATUS = { accepted: "accepted", cancelled: "canceled" } as const;

/** As the invite action leaves it, less the email no spec reads; or accepted, cancelled, or past expiry. */
export const invite = (
  api: APIRequestContext,
  input: {
    workspaceId: string;
    email: string;
    inviterId: string;
    role: "Admin" | "Editor" | "Viewer";
    status?: keyof typeof STORED_STATUS;
    expiresAt?: Date;
  },
) => {
  const { status, expiresAt, ...invited } = input;
  return ask(
    api,
    "/invitations",
    {
      ...invited,
      status: status === undefined ? undefined : STORED_STATUS[status],
      expiresAt: expiresAt?.toISOString(),
    },
    invitationWritten,
  );
};

const signInAged = z.object({ aged: z.boolean() });

/** How a spec meets `sign-in-too-old` without waiting the hour out. */
export const ageTheSignIn = (api: APIRequestContext, userId: string) =>
  ask(api, "/sign-ins/aged", { userId }, signInAged);

/** How a spec meets a pending session's end without waiting out its hour. */
export const ageThePendingHour = (api: APIRequestContext, userId: string) =>
  ask(api, "/pending-sessions/aged", { userId }, signInAged);

/** How a spec meets an expired code without waiting out its lifetime. */
export const ageTheCode = (api: APIRequestContext, email: string) =>
  ask(api, "/codes/aged", { email }, signInAged);

const enrolled = z.object({ key: z.string(), recoveryCodes: z.array(z.string()) });

/** Spends no emailed code; ten codes come saved, as a first setup leaves an Admin, unless `none`. */
export const enrolledWith = (
  api: APIRequestContext,
  email: string,
  codes: "saved" | "none" = "saved",
) => ask(api, "/authenticators", { email, codes }, enrolled);

export const withAnAuthenticator = async (api: APIRequestContext, email: string) =>
  (await enrolledWith(api, email)).key;

/** The platform operator's restore, ending the person's factors and sessions; answers its code. */
export const restored = async (api: APIRequestContext, email: string) =>
  (await ask(api, "/restores", { email }, codeSent)).code;

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
      body: "<!doctype html><title>Claude</title><p>The assistant received the redirect.</p>",
    }),
  );

/** The code exchanged as Claude does, which is when the grant's refresh token is minted. */
export const claudeExchanges = async (
  api: APIRequestContext,
  asked: { readonly origin: string; readonly code: string; readonly verifier: string },
): Promise<{ readonly refreshToken: string }> => {
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
  const tokens = z.object({ refresh_token: z.string() }).parse(await exchanged.json());
  return { refreshToken: tokens.refresh_token };
};

/** Claude revokes its own grant at the authorization server, as disconnecting it does. */
export const claudeDisconnects = async (
  api: APIRequestContext,
  refreshToken: string,
): Promise<void> => {
  const revoked = await api.post("/oauth2/revoke", {
    form: { client_id: CLAUDE.client_id, token: refreshToken, token_type_hint: "refresh_token" },
  });
  expect(revoked.ok(), `the revocation answered ${revoked.status()}`).toBe(true);
};

export type SeedModelChoice = {
  readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
  readonly provider: string;
  readonly model: string;
};

/** A purpose `modelChoices` leaves out has no model choice. */
export const seedModelChoices = (
  api: APIRequestContext,
  input: { workspaceId: string; modelChoices: readonly SeedModelChoice[] },
) => ask(api, "/model-choices", input, modelChoicesSeeded);

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
  readonly unreadableReason?: string;
  readonly passages?: readonly string[];
  readonly findings?: readonly SeedFinding[];
  readonly cited?: boolean;
};

export type SeedConnectedSource = {
  readonly name: string;
  readonly sensitivity?: Sensitivity;
  readonly audience?: "everyone" | "groups";
  readonly sync?: "none" | "queued" | "claimed" | "done";
  readonly published?: boolean;
  readonly documents?: readonly SeedDocument[];
};

const seededConnectedSources = z.object({
  connectedSources: z.array(
    z.object({
      connectedSourceId: z.string(),
      name: z.string(),
      documents: z.array(
        z.object({
          documentId: z.string(),
          title: z.string(),
          citedBy: z.object({ iri: z.string(), writeUpId: z.string() }).nullable(),
        }),
      ),
    }),
  ),
});

export const seedConnectedSources = (
  api: APIRequestContext,
  input: { workspaceId: string; connectedSources: readonly SeedConnectedSource[] },
) => ask(api, "/connected-sources", input, seededConnectedSources);

const syncMoved = z.object({ jobId: z.string() });

/**
 * The suite runs no worker, so a spec watching a state word move asks the harness for its steps.
 */
export const moveTheSync = (
  api: APIRequestContext,
  input: { workspaceId: string; to: "claimed" | "done" },
) => ask(api, "/syncs", input, syncMoved);

const groupsMade = z.object({ made: z.number() });

/**
 * Groups made by the member `userId` names, through the slice's own actions, each holding every one
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
 * A person's ask to join a workspace by its short name, as the ask-to-join form leaves it, without the
 * sign-in the form needs.
 */
export const askToJoin = (
  api: APIRequestContext,
  input: { shortName: string; requesterId: string; reason: string },
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

/** What the api captured of the last email to this address, in place of the email nobody receives. */
const capturedFor = async <T>(
  api: APIRequestContext,
  path: string,
  email: string,
  answer: z.ZodType<T>,
): Promise<T> => {
  const sent = await api.get(`${HARNESS}${path}?email=${encodeURIComponent(email)}`);
  expect(sent.ok(), `nothing was captured at ${path} for this address`).toBe(true);
  return answer.parse(await sent.json());
};

export const codeSentTo = async (api: APIRequestContext, email: string): Promise<string> =>
  (await capturedFor(api, "/codes", email, codeSent)).code;

/** The token in the fragment of the email's sign-in link. */
export const linkSentTo = async (api: APIRequestContext, email: string): Promise<string> =>
  (await capturedFor(api, "/links", email, linkSent)).token;

const emailsCounted = z.object({ sent: z.number() });

/** How many emails the api has sent to an address, each counted as the transport took it. */
export const emailsSentTo = async (api: APIRequestContext, email: string): Promise<number> => {
  const counted = await api.get(`${HARNESS}/emails?to=${encodeURIComponent(email)}`);
  expect(counted.ok(), `counting the emails answered ${counted.status()}`).toBe(true);
  return emailsCounted.parse(await counted.json()).sent;
};

/** Timestamped and randomised, so a code read back for it is this test's alone. */
export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/** From the sign-in page the browser shows; an Admin or the operator is left on confirm or setup. */
export const signInByEmail = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(email);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();

  const code = page.getByLabel(SIGN_IN_WORDS.codeField, { exact: true });
  await expect(code).toBeVisible();
  await code.fill(await codeSentTo(api, email));

  // Six digits sign in on their own; navigating before the page is left cancels the request,
  // and no session is set.
  await expect(code).toHaveCount(0);
};

/**
 * The page's read lands first: one landing after the harness's write would send the page to
 * confirm itself, racing the visit below.
 */
const factorsRead = (page: Page) =>
  expect(
    page
      .getByRole("link", { name: CONFIRM_WORDS.recoveryCode })
      .or(page.getByRole("button", { name: SETUP_WORDS.authenticatorInstead })),
  ).toBeVisible();

/** The real confirm page, opened afresh since it drew the factors held before the harness wrote one. */
const confirmedWithTheHarness = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await factorsRead(page);
  const key = await withAnAuthenticator(api, email);
  await page.goto(`/confirm${new URL(page.url()).search}`);
  await page
    .getByRole("textbox", { name: CONFIRM_WORDS.codeField })
    .fill(authenticatorCodeAt(key, new Date()));
  await expect(page).not.toHaveURL(/\/confirm(?:\?|$)/);
};

/** A pending session draws no page before confirm or setup, so the first heading drawn says which. */
const PENDING_PAGE = /^\/(?:confirm|setup)$/;

const firstPageDrawn = async (page: Page): Promise<boolean> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return PENDING_PAGE.test(new URL(page.url()).pathname);
};

/** For an action that makes the session pending, such as joining as an Admin. */
export const confirmedWhenAsked = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await expect(page).toHaveURL(/\/(?:confirm|setup)(?:\?|$)/);
  await firstPageDrawn(page);
  await confirmedWithTheHarness(page, api, email);
};

/** As a person signs in, then past the confirm page an Admin or the operator must pass. */
export const signIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await signInByEmail(page, api, email);
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  if (await firstPageDrawn(page)) await confirmedWithTheHarness(page, api, email);
};

/** Asked for before signing in, so the sign-in page carries the member back to it. */
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

/** From the sign-in page to a role's home, as a member of one workspace arrives. */
export const signedInAtHome = async (
  page: Page,
  api: APIRequestContext,
  email: string,
  role: Parameters<typeof landedAtHome>[1] = "Admin",
): Promise<void> => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await landedAtHome(page, role);
};

/** From the sign-in page to the no-workspace page, as a person in no workspace arrives. */
export const signedInWithNoWorkspace = async (page: Page, api: APIRequestContext, who: string) => {
  const email = anAddress(who);
  const signedIn = await person(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeVisible();
  return signedIn;
};
