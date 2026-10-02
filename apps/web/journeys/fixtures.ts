import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { z } from "zod";

import type { Role } from "@/shared/navigation.ts";

import { expect, test as suite } from "../e2e/browser.ts";
import { codeSentTo } from "../e2e/harness.ts";
import { noteInbox } from "./inbox.ts";
import { couldNotRun, playsTheRole } from "./outcome.ts";
import { refusedByTheEdge, signIn, type CodeSource } from "./sign-in.ts";

type JourneyFixtures = {
  /** The test person a journey signs in as. The preflight names none, and signs nobody in. */
  readonly role: Role | undefined;
  readonly signedIn: void;
};

const ADDRESS = z.email();
const SENDER = z.string().min(1);
const CODE_SOURCES = ["inbox", "harness"] as const;
const CODE_SOURCE = z.enum(CODE_SOURCES);

/** The setting is named and its value never is: the addresses are secrets. */
const addressOf = (role: Role): string => {
  const name = `JOURNEYS_${role.toUpperCase()}_EMAIL`;
  const parsed = ADDRESS.safeParse(process.env[name]);
  return parsed.success ? parsed.data : couldNotRun(`${name} is not set to an address`);
};

const inboxSource = (): CodeSource => {
  const sender = SENDER.safeParse(process.env["JOURNEYS_SENDER"]);
  if (!sender.success) return couldNotRun("JOURNEYS_SENDER is not set");
  return (recipient) => noteInbox({ recipient, sender: sender.data });
};

/** By hand, against the browser suite's api, its capture holds the code nobody is mailed. */
const harnessSource =
  (request: APIRequestContext): CodeSource =>
  async (address) => ({
    answer: "noted",
    codeSent: async () => ({ answer: "code", code: await codeSentTo(request, address) }),
  });

const codeSourceOf = (request: APIRequestContext): CodeSource => {
  const named = CODE_SOURCE.safeParse(process.env["JOURNEYS_CODE_SOURCE"]);
  if (!named.success) {
    return couldNotRun(
      `JOURNEYS_CODE_SOURCE names no code source: set it to ${CODE_SOURCES.join(" or ")}`,
    );
  }
  return named.data === "inbox" ? inboxSource() : harnessSource(request);
};

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
      try {
        const { address, source } = await suite.step("Read the journeys' settings", () => ({
          address: addressOf(role),
          source: codeSourceOf(request),
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
