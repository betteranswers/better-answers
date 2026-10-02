import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

import { SIGN_IN_WORDS } from "@/features/auth/sign-in-words.ts";

import type { InboxAnswer, Noted } from "./inbox.ts";
import { couldNotRun, type Outcome } from "./outcome.ts";

/** Named, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const SEND_PATH = "/email-otp/send-verification-otp";
const SIGN_IN_PATH = "/sign-in/email-otp";

const FORBIDDEN = 403;
const TOO_MANY_REQUESTS = 429;

/** Noting the inbox, 10 s; its 90 s deadline plus a last poll, 20 s; a re-ask, 20 s; the screen. */
const SIGN_IN_TIMEOUT_MS = 150_000;

/** Asked before Send, so the code it later answers is that Send's alone. */
export type CodeSource = (address: string) => Promise<Noted>;

type Awaiting = Extract<Noted, { readonly answer: "noted" }>;

type Fault = Exclude<InboxAnswer["answer"], "code">;

/** A missing email judges the release; an inbox that cannot tell judges nothing. */
const INBOX_FAULTS = {
  "no-mail": {
    outcome: "fail",
    why: "no sign-in email reached the test inbox within its deadline",
  },
  "no-code": { outcome: "fail", why: "the sign-in email carried no code" },
  ambiguous: {
    outcome: "could-not-run",
    why: "the test inbox held more than one new sign-in email, or one that failed authentication",
  },
  unreachable: { outcome: "could-not-run", why: "the test inbox did not answer" },
} as const satisfies Readonly<Record<Fault, { readonly outcome: Outcome; readonly why: string }>>;

const codeFrom = (answer: InboxAnswer): string => {
  if (answer.answer === "code") return answer.code;
  const { outcome, why } = INBOX_FAULTS[answer.answer];
  if (outcome === "could-not-run") return couldNotRun(why);
  throw new Error(why);
};

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

const answerTo = (page: Page, path: string): Promise<Response> =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === path,
  );

/** A second email since the first means another Send rotated the code. */
const refusedCode = async (awaiting: Awaiting, status: number): Promise<never> => {
  const again = await awaiting.codeSent();
  if (again.answer === "ambiguous") {
    return couldNotRun("another Send rotated the code before it was entered");
  }
  if (again.answer === "unreachable") return couldNotRun(INBOX_FAULTS.unreachable.why);
  throw new Error(`the product refused the code its own email carried, answering ${status}`);
};

/**
 * At `/`, which the SPA takes to sign-in: the auth library allows an address three loads of
 * `/sign-in` in ten seconds, and journeys share one.
 */
const sendTheCode = async (page: Page, address: string): Promise<void> => {
  const opened = await page.goto("/");
  if (opened !== null) refusedByTheEdge(opened, "the sign-in screen");
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
  // Six digits sign in on their own; leaving the screen sooner cancels the request.
  await expect(field).toHaveCount(0);
};

/**
 * Through the product's own screen, pressing Send once. A fault in the run's ground ends it
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
