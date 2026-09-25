import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import type { REDACTION_TIERS, SENSITIVITIES } from "@better-answers/schema";

const HARNESS = "/__harness";

const aPerson = z.object({ id: z.string(), email: z.string(), name: z.string() });

const aProvisionedWorkspace = z.object({
  workspaceId: z.string(),
  name: z.string(),
  slug: z.string(),
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

// A display name left out is the harness's own; an empty one is a person who has given none yet.
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
  readonly quarantineError?: string;
  readonly chunks?: readonly string[];
  readonly findings?: readonly SeedFinding[];
  readonly cited?: boolean;
};

export type SeedBinding = {
  readonly name: string;
  readonly sensitivity?: Sensitivity;
  readonly audience?: "everyone" | "groups";
  readonly run?: "none" | "queued" | "claimed" | "done";
  readonly published?: boolean;
  readonly documents?: readonly SeedDocument[];
};

const seededBindings = z.object({
  bindings: z.array(
    z.object({
      bindingId: z.string(),
      name: z.string(),
      documents: z.array(
        z.object({
          documentId: z.string(),
          title: z.string(),
          citedBy: z.object({ iri: z.string(), compositionId: z.string() }).nullable(),
        }),
      ),
    }),
  ),
});

export const seedBindings = (
  api: APIRequestContext,
  input: { workspaceId: string; bindings: readonly SeedBinding[] },
) => ask(api, "/bindings", input, seededBindings);

const indexRunMoved = z.object({ jobId: z.string() });

// The suite runs no worker, so a spec watching a state word move asks the harness for its steps.
export const moveTheIndexRun = (
  api: APIRequestContext,
  input: { workspaceId: string; to: "claimed" | "done" },
) => ask(api, "/index-runs", input, indexRunMoved);

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

const ACT_BUDGET_MS = 100;

// Timed in the page, from the next key to a button reading `busy`: a matcher's polling is
// coarser than the budget.
export const clockTheAct = (page: Page, busy: string) =>
  page.evaluate((reading) => {
    const busyNow = () =>
      [...document.querySelectorAll("main button")].some(
        (button) => button.textContent === reading,
      );
    const clocked = new Promise<number>((resolve) => {
      document.addEventListener(
        "keydown",
        () => {
          const pressedAt = performance.now();
          const observer = new MutationObserver(() => {
            if (!busyNow()) return;
            observer.disconnect();
            resolve(performance.now() - pressedAt);
          });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        },
        { capture: true, once: true },
      );
    });
    Reflect.set(window, "actClocked", clocked);
  }, busy);

export const theActReadWithinItsBudget = async (page: Page, act: string): Promise<void> => {
  const elapsed = await page.evaluate(() => Reflect.get(window, "actClocked"));
  test.info().annotations.push({ type: act, description: `${elapsed} ms` });
  expect(elapsed, `the ${act} did not read as busy within its budget`).toBeLessThan(ACT_BUDGET_MS);
};
