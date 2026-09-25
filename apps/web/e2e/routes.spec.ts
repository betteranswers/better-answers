import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { SCREENS, viewsOf } from "@/shared/screens.ts";

import { expect, test } from "./browser.ts";
import {
  addMember,
  anAddress,
  person,
  provision,
  seedRoutes,
  signIn,
  skipLinkReachesTheScreen,
  type SeedRoute,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const routesCard = (page: Page) => page.getByRole("region", { name: "Routes" });

const ANSWERING_AND_EMBEDDING: readonly SeedRoute[] = [
  { purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" },
  { purpose: "embedding", provider: "mistral", model: "mistral-embed" },
];

const embeddingRow = (page: Page) =>
  routesCard(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: "Embedding" }) });

const PURPOSES = ["Extraction", "Enrichment", "Answering", "Judging", "Embedding"];

const FIXED_REASON_PHRASE = "never changes once vectors exist";

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
  test("shows a member their five routes, never another workspace's", async ({ page, request }) => {
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
      routes: ANSWERING_AND_EMBEDDING,
    });

    const card = routesCard(page);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);
    await expect(card).toContainText("anthropic");
    await expect(card).toContainText("claude-sonnet-5");

    const everything = page.locator("body");
    await expect(everything).not.toContainText("openai");
    await expect(everything).not.toContainText("gpt-5-not-mine");
    await expect(everything).not.toContainText("google");
    await expect(everything).not.toContainText("gemini-not-mine");
    await expect(everything).not.toContainText(theirs.name);
  });

  test("says which purposes have no route, keeping five rows", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Acme Joinery",
      routes: [{ purpose: "answering", provider: "anthropic", model: "claude-sonnet-5" }],
    });

    const card = routesCard(page);
    await expect(card.getByRole("listitem")).toHaveCount(5);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);
    await expect(card.getByText("No route is set.")).toHaveCount(4);

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText("No route is set.");
    await expect(embedding.getByText("Fixed", { exact: true })).toHaveCount(1);
    await expect(embedding).toContainText(FIXED_REASON_PHRASE);

    await expect(embedding).not.toContainText("dimensions");
  });

  test("says the embedding route is fixed, its dimensions and why", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Halifax Fabrication",
      routes: [{ purpose: "embedding", provider: "mistral", model: "mistral-embed" }],
    });

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText("mistral");
    await expect(embedding).toContainText("mistral-embed");

    await expect(embedding).toContainText("Fixed");

    await expect(embedding).toContainText(`${EMBEDDING_DIMENSIONS} dimensions`);

    await expect(embedding).toContainText(FIXED_REASON_PHRASE);

    await expect(routesCard(page).getByText("Fixed", { exact: true })).toHaveCount(1);
  });

  test("carries no control that edits, adds or deletes a route", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Pennine Metalwork",
      routes: ANSWERING_AND_EMBEDDING,
    });

    const card = routesCard(page);

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
      routes: ANSWERING_AND_EMBEDDING,
    });

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

    test.info().annotations.push({ type: "routes list", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Admin", "Editor", "Viewer"] as const) {
    test(`shows the list to a member at ${role}`, async ({ page, request }) => {
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

  test("is keyboard-reachable and axe-clean, with the rest unbuilt", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedInWith(page, request, {
      name: "Wharfedale Castings",
      routes: ANSWERING_AND_EMBEDDING,
    });
    await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);

    await skipLinkReachesTheScreen(page);

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

    await passesTheAccessibilityGate();

    await expect(page.getByText(/The rest of System/)).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "Control Centre" });
    const opensUnbuilt = SCREENS.filter((candidate) =>
      viewsOf(candidate).some((view) => view.path === candidate.defaultView && !view.built),
    );
    for (const screen of opensUnbuilt) {
      await navigation.getByRole("link", { name: screen.name }).click();
      await expect(page.getByRole("heading", { level: 1, name: screen.name })).toBeVisible();
      await expect(page.getByText("This view is not built yet.")).toBeVisible();
    }
  });
});
