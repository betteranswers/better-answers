import { createHash, randomBytes } from "node:crypto";

import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

import type {
  AUDIENCES,
  CANDIDATE_VERDICTS,
  FEEDBACK_REASONS,
  FLAG_CLOSINGS,
  JUDGE_STATES,
  QUESTION_TRANSPORTS,
  QUESTION_VERDICTS,
  REDACTION_TIERS,
  SENSITIVITIES,
} from "@better-answers/schema";
import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import {
  authenticatorCodeField,
  emailField,
  landedAtHome,
  sendCodeButton,
  switcherOf,
  verificationCodeField,
} from "./locators.ts";
import { askedAt } from "./refused-read.ts";

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
  const why = answered.ok() ? "" : `: ${await answered.text()}`;
  expect(answered.ok(), `${path} answered ${answered.status()}${why}`).toBe(true);
  return answer.parse(await answered.json());
};

export const provision = (api: APIRequestContext, input: { name: string; adminEmail?: string }) =>
  ask(api, "/workspaces", input, aProvisionedWorkspace);

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

export const markTheOperator = (
  api: APIRequestContext,
  email: string,
  change: "grant" | "revoke" = "grant",
) => ask(api, "/operators", { email, change }, operatorMarked);
const invitationWritten = z.object({ id: z.string() });

/** The store keeps Better Auth's spelling; a spec says the glossary's. */
const STORED_STATUS = { accepted: "accepted", cancelled: "canceled" } as const;

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

const confirmationAged = z.object({ aged: z.boolean() });

export const ageTheConfirmation = (api: APIRequestContext, userId: string) =>
  ask(api, "/confirmations/aged", { userId }, confirmationAged);

export const ageTheCode = (api: APIRequestContext, email: string) =>
  ask(api, "/codes/aged", { email }, confirmationAged);

export const reconfirmOf = (page: Page): Locator =>
  page.getByRole("dialog", { name: "Confirm It’s You" });

export const reconfirmedOn = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await expect(reconfirmOf(page)).toBeVisible();
  const key = await withAnAuthenticator(api, email);
  await authenticatorCodeField(page).fill(authenticatorCodeAt(key, new Date()));
  await expect(reconfirmOf(page)).toHaveCount(0);
};

const enrolled = z.object({ key: z.string(), recoveryCodes: z.array(z.string()) });

export const enrolledWith = (
  api: APIRequestContext,
  email: string,
  codes: "saved" | "none" = "saved",
) => ask(api, "/authenticators", { email, codes }, enrolled);

export const withAnAuthenticator = async (api: APIRequestContext, email: string) =>
  (await enrolledWith(api, email)).key;

export const CLAUDES_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

const CLAUDE = {
  client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
  redirect_uri: CLAUDES_REDIRECT_URI,
} as const;

export const aPkcePair = () => {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

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

export const catchClaudesRedirect = (page: Page) =>
  page.route(`${CLAUDES_REDIRECT_URI}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>Claude</title><p>The assistant received the redirect.</p>",
    }),
  );

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

export const claudeRefreshes = async (
  api: APIRequestContext,
  asked: { readonly origin: string; readonly refreshToken: string },
): Promise<{ readonly refreshToken: string }> => {
  const refreshed = await api.post("/oauth2/token", {
    form: {
      ...CLAUDE,
      resource: `${asked.origin}/mcp`,
      grant_type: "refresh_token",
      refresh_token: asked.refreshToken,
    },
  });
  expect(refreshed.ok(), `the refresh answered ${refreshed.status()}`).toBe(true);
  const tokens = z.object({ refresh_token: z.string() }).parse(await refreshed.json());
  return { refreshToken: tokens.refresh_token };
};

export type SeedModelChoice = {
  readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
  readonly provider: string;
  readonly model: string;
};

export const seedModelChoices = (
  api: APIRequestContext,
  input: { workspaceId: string; modelChoices: readonly SeedModelChoice[] },
) => ask(api, "/model-choices", input, modelChoicesSeeded);

type Sensitivity = (typeof SENSITIVITIES)[number];

type RedactionTier = (typeof REDACTION_TIERS)[number];

type SeedFinding = {
  readonly category: string;
  readonly ruleId: string;
  readonly spans: number;
  readonly dismissed?: number;
} & (
  | {
      readonly tier: "always";
      readonly kept?: boolean;
      readonly overriddenByErasure?: boolean;
    }
  | {
      readonly tier: Exclude<RedactionTier, "always">;
      readonly kept?: false;
      readonly overriddenByErasure?: false;
    }
);

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

type SeedCitedDocument = {
  readonly title: string;
  readonly label?: string;
  readonly passages: readonly string[];
  readonly sensitivity?: Sensitivity;
};

type SeedCitedConcept = { readonly concept: string };

type SeedCitedPlace = { readonly title: string; readonly at: string };

type SeedFrontmatterEntry = Readonly<Record<string, string | number | boolean | null>>;

export type SeedConcept = {
  readonly title: string;
  readonly collection?: string;
  readonly body: string;
  readonly kind?: string;
  readonly sensitivity?: Sensitivity;
  readonly audience?: (typeof AUDIENCES)[number];
  readonly groupMemberIds?: readonly string[];
  readonly trust?: "unverified" | "machine-confirmed" | "human-reviewed";
  readonly linksTo?: readonly string[];
  readonly sources?: readonly (SeedCitedDocument | SeedCitedConcept | SeedCitedPlace)[];
  readonly frontmatter?: Readonly<
    Record<
      string,
      string | number | boolean | null | readonly string[] | readonly SeedFrontmatterEntry[]
    >
  >;
};

const seededConcepts = z.object({
  concepts: z.array(
    z.object({
      iri: z.string(),
      title: z.string(),
      path: z.string(),
      documents: z.array(z.object({ documentId: z.string(), title: z.string() })),
    }),
  ),
});

/** @public S2a */
export const seedConcepts = (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; concepts: readonly SeedConcept[] },
) => ask(api, "/concepts", input, seededConcepts);

type SeedOwner = (
  | { readonly collection: string; readonly iri?: never }
  | { readonly iri: string; readonly collection?: never }
) & { readonly personId: string | null };

const ownersNamed = z.object({ named: z.number() });

export const nameOwners = (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; owners: readonly SeedOwner[] },
) => ask(api, "/owners", input, ownersNamed);

type SeedIndexBatch = {
  readonly collection: string | null;
  readonly kind: string;
  readonly count: number;
  readonly title?: string;
  readonly sensitivity?: Sensitivity;
  readonly audienceGroups?: readonly string[];
};

const indexSeeded = z.object({ seeded: z.number() });

export const seedConceptIndex = (
  api: APIRequestContext,
  input: { workspaceId: string; batches: readonly SeedIndexBatch[] },
) => ask(api, "/concept-index", input, indexSeeded);

const editSuggested = z.object({ suggestionId: z.string(), setId: z.string() });

export const seedEditSuggestion = (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; iri: string; title?: string; body?: string },
) => ask(api, "/suggestions", input, editSuggested);

type SeedFlag = {
  readonly reason: (typeof FEEDBACK_REASONS)[number];
  readonly note?: string;
  readonly disputedSentence?: string;
  readonly disputedConcept?: string;
  readonly closedAs?: (typeof FLAG_CLOSINGS)[number];
};

export type SeedRecord = {
  readonly askedBy?: string;
  readonly transport?: (typeof QUESTION_TRANSPORTS)[number];
  readonly collections?: readonly string[];
  readonly question: string | null;
  readonly verdict: (typeof QUESTION_VERDICTS)[number];
  readonly judgeState?: (typeof JUDGE_STATES)[number];
  readonly concepts?: readonly {
    readonly iri: string;
    readonly tier?: SeedConcept["trust"];
    readonly judged?: (typeof CANDIDATE_VERDICTS)[number];
  }[];
  readonly drafted?: readonly { readonly sentence: string; readonly concepts: readonly string[] }[];
  readonly flags?: readonly SeedFlag[];
};

const seededQuestions = z.object({
  records: z.array(z.object({ recordId: z.string(), flagIds: z.array(z.string()) })),
});

export const seedQuestions = (
  api: APIRequestContext,
  input: { workspaceId: string; records: readonly SeedRecord[] },
) => ask(api, "/questions", input, seededQuestions);

type ScriptedSentence = { readonly citing: string; readonly sentence: string };

export type AskingScript = {
  readonly workspaceId: string;
  readonly judging?: { readonly fits: readonly string[] } | "fails";
  readonly drafting?: { readonly writes: readonly ScriptedSentence[] } | "fails";
  readonly limitGbp?: string;
  readonly holds?: "judge" | "draft";
};

export const scriptAsking = (api: APIRequestContext, script: AskingScript) =>
  ask(api, "/asking", script, z.object({ scripted: z.literal(true) }));

export const releaseTheModel = (api: APIRequestContext, workspaceId: string) =>
  ask(api, "/asking/releases", { workspaceId }, z.object({ released: z.literal(true) }));

const modelCalls = z.object({ judge: z.number(), draft: z.number() });

export const modelCallsIn = async (api: APIRequestContext, workspaceId: string) => {
  const answered = await api.get(`${HARNESS}/asking/calls`, { params: { workspaceId } });
  expect(answered.ok(), `the calls answered ${answered.status()}`).toBe(true);
  return modelCalls.parse(await answered.json());
};

const syncMoved = z.object({ jobId: z.string() });

export const moveTheSync = (
  api: APIRequestContext,
  input: { workspaceId: string; to: "claimed" | "done" },
) => ask(api, "/syncs", input, syncMoved);

const groupsMade = z.object({ made: z.number() });

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

export const askToJoin = (
  api: APIRequestContext,
  input: { shortName: string; requesterId: string; reason: string },
) => ask(api, "/access-requests", input, accessAsked);

const nameFlagged = z.object({ flagged: z.literal(true) });

export const flagTheName = (
  api: APIRequestContext,
  input: { workspaceId: string; adminId: string; personId: string },
) => ask(api, "/name-flags", input, nameFlagged);

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

export const linkSentTo = async (api: APIRequestContext, email: string): Promise<string> =>
  (await capturedFor(api, "/links", email, linkSent)).token;

const emailsCounted = z.object({ sent: z.number() });

export const emailsSentTo = async (api: APIRequestContext, email: string): Promise<number> => {
  const counted = await api.get(`${HARNESS}/emails?to=${encodeURIComponent(email)}`);
  expect(counted.ok(), `counting the emails answered ${counted.status()}`).toBe(true);
  return emailsCounted.parse(await counted.json()).sent;
};

const aSessionSeeded = z.object({ sessionId: z.string() });

export const aSessionOn = async (
  api: APIRequestContext,
  personId: string,
  userAgent?: string,
): Promise<string> => {
  const asked = await ask(
    api,
    "/sessions",
    { userId: personId, ...(userAgent === undefined ? {} : { userAgent }) },
    aSessionSeeded,
  );
  return asked.sessionId;
};

export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

export const signInByEmail = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await emailField(page).fill(email);
  await sendCodeButton(page).click();

  const code = verificationCodeField(page);
  await expect(code).toBeVisible();
  await code.fill(await codeSentTo(api, email));

  await expect(code).toHaveCount(0);
};

const factorsRead = (page: Page) =>
  expect(
    page
      .getByRole("link", { name: "Use a Recovery Code" })
      .or(page.getByRole("button", { name: "Set Up an Authenticator Instead" })),
  ).toBeVisible();

const confirmedWithTheHarness = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await factorsRead(page);
  const key = await withAnAuthenticator(api, email);
  await page.goto(`/confirm${new URL(page.url()).search}`);
  await authenticatorCodeField(page).fill(authenticatorCodeAt(key, new Date()));
  await expect(page).not.toHaveURL(/\/confirm(?:\?|$)/);
};

const PENDING_PAGE = /^\/(?:confirm|setup)$/;

const firstPageDrawn = async (page: Page): Promise<boolean> => {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  return PENDING_PAGE.test(new URL(page.url()).pathname);
};

export const confirmedWhenAsked = async (
  page: Page,
  api: APIRequestContext,
  email: string,
): Promise<void> => {
  await expect(page).toHaveURL(/\/(?:confirm|setup)(?:\?|$)/);
  await firstPageDrawn(page);
  await confirmedWithTheHarness(page, api, email);
};

export const signIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await signInByEmail(page, api, email);
  await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  if (await firstPageDrawn(page)) await confirmedWithTheHarness(page, api, email);
};

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

export const inTwoWorkspaces = async (
  page: Page,
  api: APIRequestContext,
  names: { readonly first: string; readonly second: string },
  role: "Admin" | "Viewer" = "Admin",
) => {
  const email = anAddress("switching");
  const first = await provision(api, { name: names.first, adminEmail: email });
  const second = await provision(api, { name: names.second });
  await addMember(api, { workspaceId: second.workspaceId, userId: first.admin.id, role });

  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.getByRole("button", { name: first.name, exact: true }).click();
  await landedAtHome(page, "Admin");
  await expect(switcherOf(page, first.name)).toBeVisible();
  return { email, first, second };
};

export const signedInWithNoWorkspace = async (page: Page, api: APIRequestContext, who: string) => {
  const email = anAddress(who);
  const signedIn = await person(api, email);
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await expect(page.getByRole("heading", { level: 1, name: "No Workspace Yet" })).toBeVisible();
  return signedIn;
};

const MEMBER_READ = "session.member";

const A_FAILED_READ = {
  error: {
    message: "INTERNAL_SERVER_ERROR",
    code: -32_603,
    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
  },
};

export const memberUnreadUntil = async (page: Page, landed: Promise<void>): Promise<void> => {
  let theShellsReadToDrop = true;
  await page.route(
    (url) => askedAt(url.href).includes(MEMBER_READ),
    async (route) => {
      const asked = askedAt(route.request().url());
      if (theShellsReadToDrop) {
        theShellsReadToDrop = false;
        await route.abort();
        return;
      }
      const theLoneRetryToHold = asked.length === 1;
      if (theLoneRetryToHold) {
        await landed;
        await route.continue();
        return;
      }
      const answered = await route.fetch();
      const answers = z.array(z.unknown()).parse(await answered.json());
      await route.fulfill({
        response: answered,
        json: answers.map((answer, at) => (asked[at] === MEMBER_READ ? A_FAILED_READ : answer)),
      });
    },
  );
};

export const holdingTheFirstAnswer = async (
  page: Page,
  matches: (url: URL) => boolean,
): Promise<{
  readonly reached: Promise<void>;
  readonly release: () => void;
  readonly asked: () => number;
}> => {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  let asked = 0;
  await page.route(matches, async (route) => {
    asked += 1;
    const first = asked === 1;
    const response = await route.fetch();
    if (first) {
      reached.resolve();
      await released.promise;
    }
    await route.fulfill({ response });
  });
  return { reached: reached.promise, release: released.resolve, asked: () => asked };
};
