import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { z } from "zod";

import type { Role } from "@/shared/navigation.ts";

import { expect, test as suite } from "../e2e/browser.ts";
import { codeSentTo } from "../e2e/harness.ts";
import { noteInbox, probeInbox } from "./inbox.ts";
import { couldNotRun, playsTheRole } from "./outcome.ts";
import { goOnUnlessStopped } from "./run-stop.ts";
import { refusedByTheEdge, signIn, type CodeSource } from "./sign-in.ts";

type JourneyFixtures = {
  /** The test person a journey signs in as. The preflight names none, and signs nobody in. */
  readonly role: Role | undefined;
  readonly signedIn: void;
};

const ADDRESS = z.email();
const SENDER = z.string().min(1);

/** The reader adds each path itself, and sends the key nowhere but over https. */
const INBOX_URL = z
  .url({ protocol: /^https$/ })
  .transform((value) => new URL(value))
  .refine((url) => url.href === `${url.origin}/`);
const CODE_SOURCES = ["inbox", "harness"] as const;
const CODE_SOURCE = z.enum(CODE_SOURCES);

/** The setting is named and its value never is: the addresses are secrets. */
const addressOf = (role: Role): string => {
  const name = `JOURNEYS_${role.toUpperCase()}_EMAIL`;
  const parsed = ADDRESS.safeParse(process.env[name]);
  return parsed.success ? parsed.data : couldNotRun(`${name} is not set to an address`);
};

/** Each test person's address, by role. A caller never prints one. */
export const theTestPeople = () => ({
  Admin: addressOf("Admin"),
  Editor: addressOf("Editor"),
  Viewer: addressOf("Viewer"),
});

type Reader = {
  readonly source: CodeSource;
  /** Whether the code source can hold a code at all, asked once before anyone signs in. */
  readonly stands: () => Promise<boolean>;
};

/** The URL's value is never named: it is a secret, as the addresses are. */
const inboxReader = (): Reader => {
  const sender = SENDER.safeParse(process.env["JOURNEYS_SENDER"]);
  if (!sender.success) return couldNotRun("JOURNEYS_SENDER is not set");
  const apiUrl = INBOX_URL.safeParse(process.env["JOURNEYS_INBOX_URL"]);
  if (!apiUrl.success) return couldNotRun("JOURNEYS_INBOX_URL is not set to a bare https origin");
  return {
    source: (recipient) => noteInbox({ recipient, sender: sender.data, apiUrl: apiUrl.data }),
    stands: () => probeInbox(apiUrl.data),
  };
};

/** By hand, against the browser suite's api, its capture holds the code nobody is mailed. */
const harnessReader = (request: APIRequestContext): Reader => ({
  source: async (address) => ({
    answer: "noted",
    codeSent: async () => ({ answer: "code", code: await codeSentTo(request, address) }),
  }),
  stands: async () => true,
});

const readerOf = (request: APIRequestContext): Reader => {
  const named = CODE_SOURCE.safeParse(process.env["JOURNEYS_CODE_SOURCE"]);
  if (!named.success) {
    return couldNotRun(
      `JOURNEYS_CODE_SOURCE names no code source: set it to ${CODE_SOURCES.join(" or ")}`,
    );
  }
  return named.data === "inbox" ? inboxReader() : harnessReader(request);
};

/**
 * Before anyone signs in, so a missing setting or an inbox that is silent or cannot store spends no
 * sign-in. Neither check sends anything.
 */
export const theSettingsAndInboxHold = (request: APIRequestContext): Promise<void> =>
  suite.step("Read the journeys' settings and note the test inbox", async () => {
    const reader = readerOf(request);
    const noted = await reader.source(theTestPeople().Admin);
    if (noted.answer !== "noted") couldNotRun("the test inbox did not answer");
    if (!(await reader.stands())) couldNotRun("the test inbox could not store a message");
  });

/** Through the context's own cookies, so it holds when the page does not. */
const signedOut = (context: BrowserContext, baseURL: string | undefined): Promise<void> =>
  suite.step("Sign out on the server", async () => {
    const signOut = new URL("/sign-out", baseURL);
    const answered = await context.request.post(signOut.href, {
      data: {},
      headers: { origin: signOut.origin },
    });
    refusedByTheEdge(answered, "the sign-out");
    expect(answered.ok(), `signing out answered ${answered.status()}`).toBe(true);
  });

/**
 * The browser suite's `test`, with no client address of its own, since production's edge sets
 * one. A journey names its person with `test.use({ role })`.
 */
export const test = suite.extend<JourneyFixtures>({
  role: [undefined, { option: true }],

  context: async ({ browser }, use) => {
    const context = await browser.newContext();
    await use(context);
    await context.close();
  },

  request: async ({ playwright, baseURL }, use) => {
    const api = await playwright.request.newContext(baseURL === undefined ? {} : { baseURL });
    await use(api);
    await api.dispose();
  },

  signedIn: [
    async ({ role, page, context, request, baseURL }, use) => {
      if (role === undefined) {
        await use();
        return;
      }
      playsTheRole(role);
      await suite.step("Check the run goes on", goOnUnlessStopped);
      try {
        const { address, source } = await suite.step("Read the journeys' settings", () => ({
          address: addressOf(role),
          source: readerOf(request).source,
        }));
        await signIn(page, address, source);
        await use();
      } finally {
        await signedOut(context, baseURL);
      }
    },
    { auto: true },
  ],
});

export { expect };
