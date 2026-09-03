import { AxeBuilder } from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";

import { EMBEDDING_DIMENSIONS, type llmPurpose } from "@better-answers/schema";

import { SCREENS } from "@/shared/screens.ts";

/**
 * T-022's acceptance seam, and the test T-038 exists for: browser to row-level policy. A real
 * browser, the real server over a real Postgres, and the System screen's routes card.
 *
 * Two workspaces are provisioned through the app tier's own harness, reached over its control
 * face (`apps/api/tests/control.ts`) because this suite runs in another process. Nothing here
 * writes a row itself: a workspace arrives through the platform's provisioning act and a
 * session through the sign-in flow, so what the browser sees is what a person would see.
 */

/** `[UX2]`: "Lists and search hits render under one second." A screen that misses it is a bug. */
const LIST_BUDGET_MS = 1000;

/** The prefix `apps/api/tests/serve.ts` mounts the harness's control face under. */
const CONTROL = "/__test__";

/** What the control face answers, parsed rather than asserted, so a change to it fails here. */
const workspaceAnswer = z.object({ workspaceId: z.string().min(1), adminEmail: z.email() });
const memberAnswer = z.object({ email: z.email() });
const sessionAnswer = z.object({
  cookies: z.array(z.object({ name: z.string().min(1), value: z.string().min(1) })).min(1),
});

type Workspace = z.infer<typeof workspaceAnswer>;
type Member = z.infer<typeof memberAnswer>;
/** A route to seed. The purpose is the column's own enum, so a typo is a type error here. */
type Route = {
  readonly purpose: (typeof llmPurpose.enumValues)[number];
  readonly provider: string;
  readonly model: string;
};

const parsed = async <TShape extends z.ZodType>(
  response: APIResponse,
  shape: TShape,
): Promise<z.infer<TShape>> => {
  if (!response.ok()) throw new Error(`the control face answered ${response.status()}`);
  return shape.parse(await response.json());
};

const provision = async (
  request: APIRequestContext,
  routes: readonly Route[],
): Promise<Workspace> =>
  parsed(await request.post(`${CONTROL}/workspace`, { data: { routes } }), workspaceAnswer);

const addMember = async (
  request: APIRequestContext,
  workspaceId: string,
  role: "Admin" | "Editor" | "Viewer",
): Promise<Member> =>
  parsed(await request.post(`${CONTROL}/member`, { data: { workspaceId, role } }), memberAnswer);

/**
 * Sign a person in and leave the browser holding their session.
 *
 * **Harness-driven, pending T-037.** The SPA's sign-in screen is that ticket's; until it lands
 * there is no screen to drive, so the flow is run through the harness — the same email step and
 * the same six-digit code the product's sign-in uses — and the cookie it produces is put into
 * the browser. When T-037 merges, this function's body becomes "go to the sign-in screen, type
 * the address, read the code, type it", and every test below is unchanged: that is why it is
 * one helper and not four lines repeated.
 */
const signInAs = async (
  context: BrowserContext,
  request: APIRequestContext,
  member: Member,
): Promise<void> => {
  const { cookies } = await parsed(
    await request.post(`${CONTROL}/session`, { data: { email: member.email } }),
    sessionAnswer,
  );
  await context.addCookies(
    cookies.map((cookie) => ({
      ...cookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      // The session cookie is issued `Secure`; a browser treats the loopback as a trustworthy
      // origin, so it is sent over the plain-HTTP loopback the suite serves on.
      secure: true,
      sameSite: "Lax" as const,
    })),
  );
};

const routesCard = (page: Page) => page.getByRole("region", { name: "Routes" });

const embeddingRow = (page: Page) =>
  routesCard(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Embedding" }) });

/** The five rows, in the order the purpose enum declares and a reader reads them. */
const PURPOSES = ["Extraction", "Enrichment", "Answering", "Judging", "Embedding"];

/**
 * The substance of the card's why-line, in the words `CONTEXT.md`'s *route* entry settles: the
 * embedding route is *fixed* and never changes once vectors exist (ADR 0020). Asserted as a
 * phrase rather than the whole sentence, so rewording the rest of it is not a test change.
 */
const FIXED_REASON_PHRASE = "never changes once vectors exist";

test.describe("the System screen's routes card", () => {
  test("shows a member of one workspace their five routes and never another workspace's", async ({
    page,
    context,
    request,
  }) => {
    const mine = await provision(request, [
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);
    // The other workspace's routes name a provider and a model nothing of mine does, so the
    // absence below is an absence of *their* rows and not of a string we happen to share.
    await provision(request, [
      { purpose: "answering", provider: "openai", model: "gpt-5-not-mine" },
      { purpose: "extraction", provider: "google", model: "gemini-not-mine" },
    ]);
    await signInAs(context, request, { email: mine.adminEmail });

    await page.goto("/system");
    const card = routesCard(page);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);

    await expect(card).toContainText("anthropic");
    await expect(card).toContainText("claude-sonnet-5");

    // Row-level policy, asserted over the whole page rather than the card: a screen that leaked
    // another workspace's routes anywhere — a heading, a hidden node, a cached list — fails here.
    const everything = page.locator("body");
    await expect(everything).not.toContainText("openai");
    await expect(everything).not.toContainText("gpt-5-not-mine");
    await expect(everything).not.toContainText("google");
    await expect(everything).not.toContainText("gemini-not-mine");
  });

  test("says which purposes have no route, so the list is always five rows", async ({
    page,
    context,
    request,
  }) => {
    const workspace = await provision(request, [
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
    ]);
    await signInAs(context, request, { email: workspace.adminEmail });

    await page.goto("/system");
    const card = routesCard(page);

    await expect(card.getByRole("listitem")).toHaveCount(5);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);
    await expect(card.getByText("No route is set.")).toHaveCount(4);

    // The embedding row still reads as fixed with nothing chosen: *fixed* is what the platform
    // has decided about the purpose, not something a particular choice acquires, and a reader
    // looking at an unconfigured embedding purpose must learn there will never be a control.
    const embedding = embeddingRow(page);
    await expect(embedding).toContainText("No route is set.");
    await expect(embedding.getByText("Fixed", { exact: true })).toHaveCount(1);
    await expect(embedding).toContainText(FIXED_REASON_PHRASE);
    // The count is the chosen model's vector width, so with nothing chosen there is none to show.
    await expect(embedding).not.toContainText("dimensions");
  });

  test("says the embedding route is fixed, in words, with its dimension count and why", async ({
    page,
    context,
    request,
  }) => {
    const workspace = await provision(request, [
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);
    await signInAs(context, request, { email: workspace.adminEmail });

    await page.goto("/system");
    const embedding = embeddingRow(page);

    await expect(embedding).toContainText("mistral");
    await expect(embedding).toContainText("mistral-embed");
    // The word, not a colour: a reader who cannot see the outline still learns the route is fixed.
    await expect(embedding).toContainText("Fixed");
    // The count as the platform pins it, never a literal (`[DEPS2]`). The screen reads it off the
    // wire; this equality is what holds the two ends of that number together.
    await expect(embedding).toContainText(`${EMBEDDING_DIMENSIONS} dimensions`);
    // The why-line, in the words `CONTEXT.md`'s *route* entry settles (ADR 0020's amendment).
    await expect(embedding).toContainText(FIXED_REASON_PHRASE);

    // One state tag on the card, on the one row it is about: the four other purposes are not
    // fixed and say nothing that could be read as if they were.
    await expect(routesCard(page).getByText("Fixed", { exact: true })).toHaveCount(1);
  });

  test("carries no control that edits, adds or deletes a route", async ({
    page,
    context,
    request,
  }) => {
    const workspace = await provision(request, [
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);
    await signInAs(context, request, { email: workspace.adminEmail });

    await page.goto("/system");
    const card = routesCard(page);

    // Nothing operable at all: editing is a later ticket with its own gating, and a disabled
    // control that hints at it would be the half-gated write this ticket refuses to ship.
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("link")).toHaveCount(0);
    await expect(card.getByRole("textbox")).toHaveCount(0);
    await expect(card.getByRole("combobox")).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    await expect(card).not.toContainText(/edit|add|delete|remove/i);
  });

  test("renders the list within the constitution's latency budget", async ({
    page,
    context,
    request,
  }) => {
    const workspace = await provision(request, [
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);
    await signInAs(context, request, { email: workspace.adminEmail });

    // Measured from a screen the person is already on, so what is timed is the list arriving —
    // the query, the answer and the render — and not the first load of the bundle behind it.
    await page.goto("/people");
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    const started = Date.now();
    await page
      .getByRole("navigation", { name: "Control Centre" })
      .getByRole("link", { name: "System" })
      .click();
    await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);
    const elapsed = Date.now() - started;

    // Reported whatever happens, so a run that passes near the ceiling still says how near.
    test.info().annotations.push({ type: "routes list", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    test(`shows the list to a member at ${role}, because the list is read-only`, async ({
      page,
      context,
      request,
    }) => {
      const workspace = await provision(request, [
        { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      ]);
      const member = await addMember(request, workspace.workspaceId, role);
      await signInAs(context, request, member);

      await page.goto("/system");

      await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);
      await expect(routesCard(page)).toContainText("claude-sonnet-5");
    });
  }

  test("is reachable by keyboard and clean under axe, and leaves the rest of System unbuilt", async ({
    page,
    context,
    request,
  }) => {
    const workspace = await provision(request, [
      { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
      { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
    ]);
    await signInAs(context, request, { email: workspace.adminEmail });

    await page.goto("/system");
    await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);

    // The card adds nothing to the tab order — it has no controls — so the traversal past the
    // navigation still lands on the screen itself, which the skip link is what reaches.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the screen" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    // The announced structure itself, not a claim about it: the accessibility tree a screen
    // reader reads, written out. A row that lost its heading, a list that stopped being a list
    // or a state tag that turned into an image fails here even though the pixels are unchanged.
    // This is the record of what the card sounds like; no live screen reader is driven by CI.
    await expect(routesCard(page)).toMatchAriaSnapshot(`
      - region "Routes":
        - heading "Routes" [level=2]
        - paragraph: /Which model does which job in this workspace/
        - list:
          - listitem:
            - heading "Extraction" [level=3]
            - paragraph: No route is set.
          - listitem:
            - heading "Enrichment" [level=3]
            - paragraph: No route is set.
          - listitem:
            - heading "Answering" [level=3]
            - term: Provider
            - definition: anthropic
            - term: Model
            - definition: claude-sonnet-5
          - listitem:
            - heading "Judging" [level=3]
            - paragraph: No route is set.
          - listitem:
            - heading "Embedding" [level=3]
            - term: Provider
            - definition: mistral
            - term: Model
            - definition: mistral-embed
            - paragraph: /Fixed ${EMBEDDING_DIMENSIONS} dimensions/
            - paragraph: /${FIXED_REASON_PHRASE}/
    `);

    // `@axe-core/playwright` 4.13.0, read from npm 03/09/2026 (`[DEPS1]`). Automated rules are
    // evidence, not proof: the keyboard traversal and the aria snapshot above are the rest of it.
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(audit.violations).toEqual([]);

    // The rest of System, and every one of the other five screens, still say they are unbuilt.
    await expect(page.getByText(/The rest of System/)).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Control Centre" });
    for (const screen of SCREENS.filter((candidate) => candidate.id !== "system")) {
      await navigation.getByRole("link", { name: screen.name }).click();
      await expect(page.getByRole("heading", { level: 1, name: screen.name })).toBeVisible();
      await expect(page.getByText("This screen is not built yet.")).toBeVisible();
    }
  });
});
