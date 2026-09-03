import { AxeBuilder } from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { SCREENS } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  person,
  provision,
  seedRoutes,
  signIn,
  type SeedRoute,
} from "./harness.ts";

/**
 * T-022's acceptance seam, and the test T-038 exists for: browser to row-level policy. A real
 * browser, the real server over a real Postgres, and the System screen's routes card.
 *
 * Two workspaces are provisioned through the api's own harness, reached over its control face
 * (`apps/api/tests/harness-control.ts`) because this suite runs in another process. Nothing
 * here writes a row itself and nothing sets a cookie from outside: a workspace arrives through
 * the platform's provisioning act, and a session through the product's own sign-in screen
 * (T-037), so what the browser sees is what a person would see.
 */

/** `[UX2]`: "Lists and search hits render under one second." A screen that misses it is a bug. */
const LIST_BUDGET_MS = 1000;

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

/**
 * A workspace with its routes, and its Admin signed in on the product's own sign-in screen —
 * the two steps a person takes, not a cookie set from outside. `signIn` and `provision` are
 * T-037's helpers; this composes them for a suite whose subject is what the screen then shows.
 */
const signedInWith = async (
  page: Page,
  api: APIRequestContext,
  input: { readonly name: string; readonly routes: readonly SeedRoute[] },
) => {
  const email = anAddress("member");
  const workspace = await provision(api, { name: input.name, adminEmail: email });
  await seedRoutes(api, { workspaceId: workspace.workspaceId, routes: input.routes });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  return workspace;
};

test.describe("the System screen's routes card", () => {
  test("shows a member of one workspace their five routes and never another workspace's", async ({
    page,
    request,
  }) => {
    // The other workspace's routes name a provider and a model nothing of mine does, so the
    // absence below is an absence of *their* rows and not of a string we happen to share.
    const theirs = await provision(request, { name: "Southern Castings" });
    await seedRoutes(request, {
      workspaceId: theirs.workspaceId,
      routes: [
        { purpose: "answering", provider: "openai", model: "gpt-5-not-mine" },
        { purpose: "extraction", provider: "google", model: "gemini-not-mine" },
      ],
    });

    await signedInWith(page, request, {
      name: "Northern Tooling",
      routes: [
        { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
        { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
      ],
    });

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
    await expect(everything).not.toContainText(theirs.name);
  });

  test("says which purposes have no route, so the list is always five rows", async ({
    page,
    request,
  }) => {
    await signedInWith(page, request, {
      name: "Acme Joinery",
      routes: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
    });

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
    request,
  }) => {
    await signedInWith(page, request, {
      name: "Halifax Fabrication",
      routes: [{ purpose: "embedding", provider: "mistral", model: "mistral-embed" }],
    });

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

  test("carries no control that edits, adds or deletes a route", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Pennine Metalwork",
      routes: [
        { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
        { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
      ],
    });

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

  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Dales Engineering",
      routes: [
        { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
        { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
      ],
    });

    // Measured from a screen the person is already on, so what is timed is the list arriving —
    // the query, the answer and the render — and not the first load of the bundle behind it.
    await page
      .getByRole("navigation", { name: "Control Centre" })
      .getByRole("link", { name: "People" })
      .click();
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
      request,
    }) => {
      const workspace = await provision(request, { name: `Workspace for a ${role}` });
      await seedRoutes(request, {
        workspaceId: workspace.workspaceId,
        routes: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
      });
      const email = anAddress(role.toLowerCase());
      const member = await person(request, email);
      await addMember(request, { workspaceId: workspace.workspaceId, userId: member.id, role });

      await page.goto("/sign-in");
      await signIn(page, request, email);

      await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);
      await expect(routesCard(page)).toContainText("claude-sonnet-5");
    });
  }

  test("is reachable by keyboard and clean under axe, and leaves the rest of System unbuilt", async ({
    page,
    request,
  }) => {
    await signedInWith(page, request, {
      name: "Wharfedale Castings",
      routes: [
        { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
        { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
      ],
    });
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
        - paragraph: "Which model does which job in this workspace. Listed only: choosing a route is not part of this screen."
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
