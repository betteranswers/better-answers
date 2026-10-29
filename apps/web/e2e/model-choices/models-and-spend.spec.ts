import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { CONTROL_CENTRE, menuGroupIn, HOMES, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  aMemberSignedInAt,
  anAddress,
  provision,
  seedModelChoices,
  signIn,
  skipLinkReachesThePage,
  type SeedModelChoice,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const modelChoicesCard = (page: Page) => page.getByRole("region", { name: "Model Choices" });

const ANSWERING: SeedModelChoice = {
  purpose: "answering",
  provider: "anthropic",
  model: "claude-sonnet-5",
};

const EMBEDDING: SeedModelChoice = {
  purpose: "embedding",
  provider: "mistral",
  model: "mistral-embed",
};

const ANSWERING_AND_EMBEDDING: readonly SeedModelChoice[] = [ANSWERING, EMBEDDING];

const models = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(models, "Models and Spend");

const openModelChoices = async (page: Page) => {
  await page.goto(MODELS_AND_SPEND.path);
  await expect(modelChoicesCard(page)).toBeVisible();
};

const signedInWith = async (
  page: Page,
  api: APIRequestContext,
  input: { readonly name: string; readonly modelChoices: readonly SeedModelChoice[] },
) => {
  const email = anAddress("member");
  const workspace = await provision(api, { name: input.name, adminEmail: email });
  await seedModelChoices(api, {
    workspaceId: workspace.workspaceId,
    modelChoices: input.modelChoices,
  });
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await openModelChoices(page);
  return workspace;
};

test.describe("the Models and spend page's model choices card", () => {
  test("renders the list within the constitution's latency budget", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Dales Engineering",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    const nav = page.getByRole("navigation", { name: "Control Centre" });
    await nav.getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    const started = Date.now();
    await nav.getByRole("link", { name: "Models and Spend" }).click();
    await expect(modelChoicesCard(page).getByRole("listitem")).toHaveCount(5);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "model choices list", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  test("is keyboard-reachable and axe-clean under its group", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedInWith(page, request, {
      name: "Wharfedale Castings",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });
    await expect(modelChoicesCard(page).getByRole("listitem")).toHaveCount(5);

    await skipLinkReachesThePage(page);

    await expect(modelChoicesCard(page)).toMatchAriaSnapshot(`
      - region "Model Choices":
        - heading "Model Choices" [level=2]
        - paragraph
        - paragraph
        - list:
          - listitem:
            - heading "Extraction" [level=3]
            - paragraph
          - listitem:
            - heading "Enrichment" [level=3]
            - paragraph
          - listitem:
            - heading "Answering" [level=3]
            - term: Model provider
            - definition: "Anthropic"
            - term: Model
            - definition: ${ANSWERING.model}
          - listitem:
            - heading "Judging" [level=3]
            - paragraph
          - listitem:
            - heading "Embedding" [level=3]
            - term: Model provider
            - definition: "Mistral AI"
            - term: Model
            - definition: ${EMBEDDING.model}
            - paragraph: /\\b${String(EMBEDDING_DIMENSIONS)}\\b/
            - paragraph
    `);
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading "Models" [level=1]
        - paragraph
        - tablist "Models and Spend":
          - tab "Model Choices" [selected]
          - tab "Spend"
        - tabpanel "Model Choices":
          - /children: equal
          - region "Model Choices"
    `);

    await passesTheAccessibilityGate();
  });
});

test.describe("a page's older address", () => {
  test("never shows a Viewer an address under /system/", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);
    await page.goto("/people/not-a-page");
    await expect(page.getByRole("link", { name: "Go to New Question" })).toBeVisible();
    const neverExisted = await page.getByRole("main").ariaSnapshot();

    const visited: string[] = [];
    page.on("framenavigated", (frame) => visited.push(frame.url()));
    await page.goto("/people/audit-log");

    await expect(page.getByRole("link", { name: "Go to New Question" })).toBeVisible();
    await expect(page).toHaveURL(/\/people\/audit-log$/);
    expect(await page.getByRole("main").ariaSnapshot(), "a hidden page gives itself away").toBe(
      neverExisted,
    );
    expect(visited.filter((address) => address.includes("/system/"))).toEqual([]);
    await passesTheAccessibilityGate();
  });
});
