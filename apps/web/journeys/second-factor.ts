import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import { authenticatorCodeAt } from "@better-answers/schema/testing/authenticator-code";

import { CONFIRM_WORDS, SETUP_WORDS } from "@/features/auth/second-factor-words.ts";

import { couldNotRun, failed } from "./outcome.ts";
import { refusedTheRun } from "./sign-in.ts";

/** Named, not imported: `apps/web` takes nothing from `apps/api` at runtime. */
const CONFIRM_PATH = "/second-factor/confirm/authenticator";

/** The product answers this when the session's person holds no authenticator to confirm with. */
const NOTHING_TO_CONFIRM = 409;

const OTPAUTH = /^otpauth:\/\//i;

/** The `secret` of the `otpauth://` link a setup's QR code carries, or the value as given. */
const secretOf = (value: string): string =>
  OTPAUTH.test(value) && URL.canParse(value)
    ? (new URL(value).searchParams.get("secret") ?? "")
    : value;

/** An authenticator's key as its setup shows it: base32, perhaps in spaced groups or lower case. */
const KEY = z
  .string()
  .transform((value) => secretOf(value.trim()).replaceAll(/\s/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z2-7]{16,}=*$/));

const enrolled = z.object({ key: KEY });

/** The key as the code generator takes it, from the key or its link; nothing if neither parses. */
export const authenticatorKeyOf = (value: string | undefined): string | undefined => {
  const parsed = KEY.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

/** Where the test Admin's authenticator key comes from; asked before the sign-in, so none is spent. */
export type FactorKey = () => Promise<string>;

/** The setting is named and its value never is: the key is a secret. */
export const keyFromTheSetting = (): FactorKey => {
  const key =
    authenticatorKeyOf(process.env["JOURNEYS_ADMIN_AUTHENTICATOR_KEY"]) ??
    couldNotRun("JOURNEYS_ADMIN_AUTHENTICATOR_KEY is not set to an authenticator's key");
  return async () => key;
};

/** By hand, against the browser suite's api, the harness writes the test Admin an authenticator. */
export const keyFromTheHarness =
  (request: APIRequestContext, address: string): FactorKey =>
  async () => {
    const answered = await request.post("/__harness/authenticators", { data: { email: address } });
    if (!answered.ok()) couldNotRun("the harness wrote the test Admin no authenticator");
    return enrolled.parse(await answered.json()).key;
  };

/** A page that sets a factor up, not one that confirms it, means the test Admin holds none. */
const theConfirmPage = async (page: Page): Promise<void> => {
  const field = page.getByLabel(CONFIRM_WORDS.codeField, { exact: true });
  const setup = page.getByRole("heading", { level: 1, name: SETUP_WORDS.heading });
  await expect(field.or(setup)).toBeVisible();
  if (await setup.isVisible()) {
    couldNotRun("the test Admin holds no second factor, so the sign-in met setup, not confirm");
  }
};

/** A code the product refuses is the release's; an Admin holding no authenticator is the ground's. */
const judged = (status: number): void => {
  if (status === NOTHING_TO_CONFIRM)
    couldNotRun("the test Admin holds no authenticator to confirm");
  failed(
    `the product refused the code the test Admin's authenticator key makes, answering ${status}`,
  );
};

/** Through the product's own confirm page, with the code the key makes now. */
export const confirmedWith = (page: Page, key: string): Promise<void> =>
  test.step("Confirm the second factor", async () => {
    await theConfirmPage(page);
    const field = page.getByLabel(CONFIRM_WORDS.codeField, { exact: true });
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === CONFIRM_PATH,
    );
    await field.fill(authenticatorCodeAt(key, new Date()));
    const response = await answered;
    refusedTheRun(response, "the confirm");
    if (!response.ok()) judged(response.status());
    // Six digits confirm on their own; leaving the page sooner cancels the request.
    await expect(field).toHaveCount(0);
  });
