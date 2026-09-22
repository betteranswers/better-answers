import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

const HARNESS = "/__harness";

const aPerson = z.object({ id: z.string(), email: z.string(), name: z.string() });

const aProvisionedWorkspace = z.object({
  workspaceId: z.string(),
  name: z.string(),
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

export const person = (api: APIRequestContext, email: string) =>
  ask(api, "/people", { email }, aPerson);

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

export type SeedRoute = {
  readonly purpose: "extraction" | "enrichment" | "answering" | "judging" | "embedding";
  readonly provider: string;
  readonly model: string;
};

export const seedRoutes = (
  api: APIRequestContext,
  input: { workspaceId: string; routes: readonly SeedRoute[] },
) => ask(api, "/routes", input, routesSeeded);

// The code the api captured for this address, in place of the email nobody receives.
export const codeSentTo = async (api: APIRequestContext, email: string): Promise<string> => {
  const sent = await api.get(`${HARNESS}/codes?email=${encodeURIComponent(email)}`);
  expect(sent.ok(), "no code was captured for this address").toBe(true);
  return codeSent.parse(await sent.json()).code;
};

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
  await code.fill(await codeSentTo(api, email));
  await page.getByRole("button", { name: "Sign in" }).click();

  // Wait for the screen to be left, not just the click: navigating away cancels the request
  // in flight and no session is set.
  await expect(code).toHaveCount(0);
};
