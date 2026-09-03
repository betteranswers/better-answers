import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The api's own test harness, reached over HTTP (`apps/api/tests/harness-control.ts`).
 * Every browser test provisions through this — a workspace with its first Admin, a person
 * with no membership, a second membership, a revocation — and reads the six-digit code
 * from the captured email transport, which is the only place a code may be read from
 * (`[LOG1]` forbids the app's logger from ever holding one).
 *
 * The paths are the harness's and exist only in front of the browser suite's server;
 * nothing in `apps/api/src` serves them.
 */

const HARNESS = "/__harness";

export type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly admin: Person;
};

export type Person = {
  readonly id: string;
  readonly email: string;
  /** What the shell shows for a person; the seeded default, since nobody has typed one. */
  readonly name: string;
};

const ask = async <T>(api: APIRequestContext, path: string, body: unknown): Promise<T> => {
  const answered = await api.post(`${HARNESS}${path}`, { data: body });
  expect(answered.ok(), `${path} answered ${answered.status()}`).toBe(true);
  return (await answered.json()) as T;
};

export const provision = (api: APIRequestContext, input: { name: string; adminEmail?: string }) =>
  ask<Provisioned>(api, "/workspaces", input);

export const person = (api: APIRequestContext, email: string) =>
  ask<Person>(api, "/people", { email });

export const addMember = (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; role: "Admin" | "Editor" | "Viewer" },
) => ask<{ added: boolean }>(api, "/members", input);

export const revokeCredentials = (api: APIRequestContext, userId: string) =>
  ask<{ revoked: boolean }>(api, "/revocations", { userId });

/** An address nobody else in the run will use, so a code read back is this test's. */
export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/**
 * Sign a person in through the product's own screen — the two steps a person takes, not a
 * cookie set from outside — and stop on whatever screen the sign-in led to.
 */
export const signIn = async (page: Page, api: APIRequestContext, email: string): Promise<void> => {
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send code" }).click();

  const code = page.getByLabel("Code");
  await expect(code).toBeVisible();
  const sent = await api.get(`${HARNESS}/codes?email=${encodeURIComponent(email)}`);
  expect(sent.ok(), "no code was captured for this address").toBe(true);
  const { code: sixDigits } = (await sent.json()) as { code: string };

  await code.fill(sixDigits);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the screen to be left, not just for the click: a test that navigated away
  // here would cancel the request in flight and then wonder why it had no session.
  await expect(code).toHaveCount(0);
};
