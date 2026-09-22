import { expect, type APIRequestContext, type Page } from "@playwright/test";

const HARNESS = "/__harness";

export type Provisioned = {
  readonly workspaceId: string;
  readonly name: string;
  readonly admin: Person;
};

export type Person = {
  readonly id: string;
  readonly email: string;

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

export const removeMember = async (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string },
): Promise<void> => {
  const answered = await api.delete(`${HARNESS}/members`, { data: input });
  expect(answered.ok(), `removing a member answered ${answered.status()}`).toBe(true);
};

export const revokeCredentials = (api: APIRequestContext, userId: string) =>
  ask<{ revoked: boolean }>(api, "/revocations", { userId });

export type SeedRoute = {
  readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
  readonly provider: string;
  readonly model: string;
};

export const seedRoutes = (
  api: APIRequestContext,
  input: { workspaceId: string; routes: readonly SeedRoute[] },
) => ask<{ seeded: number }>(api, "/routes", input);

export const anAddress = (who: string): string =>
  `${who}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

// Sign-out is one disclosure in from the top bar, so a spec that leaves opens the menu first.
export const signOutFromTheShell = async (page: Page, who: string): Promise<void> => {
  await page
    .getByRole("banner")
    .getByRole("button", { name: new RegExp(who) })
    .click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
};

export const skipLinkReachesTheScreen = async (page: Page): Promise<void> => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
};

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

  // Wait for the screen to be left, not just the click: navigating away cancels the request
  // in flight and no session is set.
  await expect(code).toHaveCount(0);
};
