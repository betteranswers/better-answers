import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";

import type { InboxAnswer, Noted } from "./inbox.ts";
import { couldNotRun, failed, type Outcome } from "./outcome.ts";

/** Named, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const SEND_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_PATH = "/sign-in/email-otp";

const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;

/**
 * Noting the inbox, 5 s; its 90 s deadline then a list, retrieve and two key lookups, 14 s; a
 * re-ask, 14 s; the page.
 */
const SIGN_IN_TIMEOUT_MS = 150_000;

/** Asked before Send, so the code it later answers is that Send's alone. */
export type CodeSource = (address: string) => Promise<Noted>;

type Awaiting = Extract<Noted, { readonly answer: "noted" }>;

type Fault = Exclude<InboxAnswer["answer"], "code">;

type Judgement = { readonly outcome: Exclude<Outcome, "held">; readonly why: string };

/** A missing email judges the release; an inbox that cannot tell judges nothing. */
const INBOX_FAULTS = {
  "no-mail": {
    outcome: "fail",
    why: "no sign-in email reached the test inbox within its deadline",
  },
  "no-code": { outcome: "fail", why: "the sign-in email carried no code" },
  ambiguous: {
    outcome: "could-not-run",
    why: "the test inbox held more than one new sign-in email",
  },
  unverified: {
    outcome: "could-not-run",
    why: "the only new emails from the sender failed their signature check, or their signing key could not be looked up",
  },
  unreachable: { outcome: "could-not-run", why: "the test inbox did not answer" },
} as const satisfies Readonly<Record<Fault, Judgement>>;

/** Asked again after a refused code, where a second email means another Send rotated it. */
const REASKED_FAULTS = {
  ...INBOX_FAULTS,
  ambiguous: {
    outcome: "could-not-run",
    why: "another Send rotated the code before it was entered",
  },
} as const satisfies Readonly<Record<Fault, Judgement>>;

const judgedAs = ({ outcome, why }: Judgement): never =>
  outcome === "could-not-run" ? couldNotRun(why) : failed(why);

const codeFrom = (answer: InboxAnswer): string =>
  answer.answer === "code" ? answer.code : judgedAs(INBOX_FAULTS[answer.answer]);

type Answered = Pick<APIResponse, "status" | "headers">;

/** A ceiling or a challenge stops the run before the product is reached, so it judges nothing. */
export const refusedTheRun = (response: Answered, at: string): void => {
  if (response.status() === TOO_MANY_REQUESTS) couldNotRun(`a rate ceiling refused ${at}`);
  if (response.headers()["cf-mitigated"] === "challenge") couldNotRun(`the edge challenged ${at}`);
};

/** The product answers 403 here only to a post from a foreign origin, so a 403 is the edge's. */
export const refusedByTheEdge = (response: Answered, at: string): void => {
  refusedTheRun(response, at);
  if (response.status() === FORBIDDEN) couldNotRun(`the edge refused ${at}`);
};

/** Inside the sign-in's budget: the action timeout alone would fail a slow Send after spending it. */
const ANSWER_TIMEOUT_MS = 60_000;

const answerTo = (page: Page, path: string): Promise<Response> =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === path,
    { timeout: ANSWER_TIMEOUT_MS },
  );

/** Only the same email again leaves the product's refusal to judge. */
const refusedCode = async (awaiting: Awaiting, status: number): Promise<never> => {
  const again = await awaiting.codeSent();
  if (again.answer !== "code") return judgedAs(REASKED_FAULTS[again.answer]);
  throw new Error(`the product refused the code its own email carried, answering ${status}`);
};

/**
 * At `/`, which the SPA takes to sign-in: the auth library allows an address three loads of
 * `/sign-in` in ten seconds, and journeys share one.
 */
const sendTheCode = async (page: Page, address: string): Promise<void> => {
  const opened = await page.goto("/");
  if (opened !== null) refusedByTheEdge(opened, "the sign-in page");
  const sent = answerTo(page, SEND_PATH);
  await page.getByLabel(SIGN_IN_WORDS.emailField).fill(address);
  await page.getByRole("button", { name: SIGN_IN_WORDS.send }).click();
  const response = await sent;
  refusedByTheEdge(response, "the Send");
  expect(response.ok(), `the Send answered ${response.status()}`).toBe(true);
};

const enterTheCode = async (page: Page, awaiting: Awaiting, code: string): Promise<void> => {
  const field = page.getByLabel(SIGN_IN_WORDS.codeField, { exact: true });
  const answered = answerTo(page, SIGN_IN_PATH);
  await field.fill(code);
  const response = await answered;
  refusedTheRun(response, "the code");
  if (!response.ok()) await refusedCode(awaiting, response.status());
  // Six digits sign in on their own; leaving the page sooner cancels the request.
  await expect(field).toHaveCount(0);
};

/**
 * Through the product's own page, pressing Send once. A fault in the run's ground ends it
 * could-not-run; a fault in the release fails it.
 */
export const signIn = (page: Page, address: string, source: CodeSource): Promise<void> =>
  test.step(
    "Sign in",
    async () => {
      const awaiting = await test.step("Note the test inbox", async () => {
        const noted = await source(address);
        return noted.answer === "noted" ? noted : couldNotRun(INBOX_FAULTS.unreachable.why);
      });
      await test.step("Send the code", () => sendTheCode(page, address));
      const code = await test.step("Read the code from the test inbox", async () =>
        codeFrom(await awaiting.codeSent()));
      await test.step("Enter the code", () => enterTheCode(page, awaiting, code));
    },
    { timeout: SIGN_IN_TIMEOUT_MS },
  );
