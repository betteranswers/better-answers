import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { goHome } from "@/app/words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { ROUTES_WORDS } from "@/features/routes/words.ts";
import { CONTROL_CENTRE, menuGroupIn, HOMES, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  notFoundOfferingHome,
  anAddress,
  provision,
  seedRoutes,
  signIn,
  skipLinkReachesThePage,
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

const agentOperations = menuGroupIn(CONTROL_CENTRE, "agent-operations");

const ROUTES_AND_SPEND = pageNamed(agentOperations, "Routes and spend");

/** No role lands on Routes and spend, so every test here opens it from the member's home. */
const openRoutes = async (page: Page) => {
  await page.goto(ROUTES_AND_SPEND.path);
  await expect(routesCard(page)).toBeVisible();
};

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
  await openRoutes(page);
  return workspace;
};

test.describe("the Routes and spend page's routes card", () => {
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
    await expect(card.getByText(ROUTES_WORDS.unset, { exact: true })).toHaveCount(4);

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText(ROUTES_WORDS.unset);
    await expect(
      embedding.getByText(ROUTES_WORDS.fixed, { exact: true }),
      "an embedding purpose with no route has nothing fixed to note",
    ).toHaveCount(0);
    await expect(embedding).not.toContainText(ROUTES_WORDS.fixedReason);
  });

  test("says in one line that no route is set", async ({ page, request }) => {
    await signedInWith(page, request, { name: "Ryedale Pressings", routes: [] });

    const card = routesCard(page);
    await expect(card.getByText(ROUTES_WORDS.noneSet, { exact: true })).toBeVisible();
    await expect(card.getByRole("list")).toHaveCount(0);
    await expect(card.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(card).not.toContainText(ROUTES_WORDS.fixedReason);
  });

  test("says the embedding route is fixed, its dimensions and why", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Halifax Fabrication",
      routes: [{ purpose: "embedding", provider: "mistral", model: "mistral-embed" }],
    });

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText("mistral");
    await expect(embedding).toContainText("mistral-embed");

    await expect(embedding).toContainText(ROUTES_WORDS.fixed);

    await expect(embedding).toContainText(`${EMBEDDING_DIMENSIONS} dimensions`);

    await expect(embedding).toContainText(ROUTES_WORDS.fixedReason);

    await expect(routesCard(page).getByText(ROUTES_WORDS.fixed, { exact: true })).toHaveCount(1);
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

    const nav = page.getByRole("navigation", { name: CONTROL_CENTRE.name });
    await nav.getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    const started = Date.now();
    await nav.getByRole("link", { name: ROUTES_AND_SPEND.name }).click();
    await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "routes list", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${aRole(role)} the page as not found`, async ({ page, request }) => {
      await aMemberSignedInAt(page, request, role, ROUTES_AND_SPEND.path);

      await notFoundOfferingHome(page, role);
      await expect(routesCard(page)).toHaveCount(0);
    });
  }

  test("is keyboard-reachable and axe-clean under its group", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedInWith(page, request, {
      name: "Wharfedale Castings",
      routes: ANSWERING_AND_EMBEDDING,
    });
    await expect(routesCard(page).getByRole("listitem")).toHaveCount(5);

    await skipLinkReachesThePage(page);

    await expect(routesCard(page)).toMatchAriaSnapshot(`
      - region "Routes":
        - heading "Routes" [level=2]
        - paragraph: ${JSON.stringify(ROUTES_WORDS.lead)}
        - list:
          - listitem:
            - heading "Extraction" [level=3]
            - paragraph: ${JSON.stringify(ROUTES_WORDS.unset)}
          - listitem:
            - heading "Enrichment" [level=3]
            - paragraph: ${JSON.stringify(ROUTES_WORDS.unset)}
          - listitem:
            - heading "Answering" [level=3]
            - term: Provider
            - definition: anthropic
            - term: Model
            - definition: claude-sonnet-5
          - listitem:
            - heading "Judging" [level=3]
            - paragraph: ${JSON.stringify(ROUTES_WORDS.unset)}
          - listitem:
            - heading "Embedding" [level=3]
            - term: Provider
            - definition: mistral
            - term: Model
            - definition: mistral-embed
            - paragraph: ${JSON.stringify(`${ROUTES_WORDS.fixed} ${EMBEDDING_DIMENSIONS} dimensions`)}
            - paragraph: ${JSON.stringify(ROUTES_WORDS.fixedReason)}
    `);
    // Equal children: the page holds its heading, its lead line and the card, nothing else.
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - tabpanel "Routes":
          - /children: equal
          - heading ${JSON.stringify(agentOperations.name)} [level=1]
          - paragraph: ${JSON.stringify(agentOperations.summary)}
          - region "Routes"
    `);

    await passesTheAccessibilityGate();
  });
});

const MOVED = [
  ["/people/audit-log", "/system/audit-log"],
  ["/system/routes-and-spend", ROUTES_AND_SPEND.path],
] as const;

test.describe("a page's older address", () => {
  for (const [from, to] of MOVED) {
    test(`leads an Admin from ${from} to ${to}, Back returning`, async ({ page, request }) => {
      await signedInWith(page, request, { name: "Nidderdale Forge", routes: [] });
      await page
        .getByRole("navigation", { name: CONTROL_CENTRE.name })
        .getByRole("link", { name: "Members" })
        .click();
      await expect(page).toHaveURL(/\/people\/members$/);

      await page.goto(from);

      await expect(page).toHaveURL(new RegExp(`${to}$`));
      await page.goBack();
      await expect(page).toHaveURL(/\/people\/members$/);
    });
  }

  test("never shows a Viewer an address under /system/", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
    await page.goto("/people/not-a-page");
    await expect(page.getByRole("link", { name: goHome(HOMES.Viewer) })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    const visited: string[] = [];
    page.on("framenavigated", (frame) => visited.push(frame.url()));
    await page.goto("/people/audit-log");

    await expect(page.getByRole("link", { name: goHome(HOMES.Viewer) })).toBeVisible();
    await expect(page).toHaveURL(/\/people\/audit-log$/);
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden page gives itself away").toBe(
      neverExisted,
    );
    expect(visited.filter((address) => address.includes("/system/"))).toEqual([]);
    await passesTheAccessibilityGate();
  });
});
