import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
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
  return workspace;
};

test.describe("the Model Choices card on the Models and Spend page", () => {
  test("loads under the Models heading and works by keyboard", async ({
    page,
    request,
    passesTheAccessibilityGate,
  }) => {
    await signedInWith(page, request, {
      name: "Wharfedale Castings",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    await test.step("shows the five model purposes within the list time budget", async () => {
      const started = Date.now();
      await page.goto(MODELS_AND_SPEND.path);
      await expect(modelChoicesCard(page).getByRole("listitem")).toHaveCount(5);
      const elapsed = Date.now() - started;

      test.info().annotations.push({ type: "model choices list", description: `${elapsed} ms` });
      expect(
        elapsed,
        "the Model Choices list took longer than its time budget to render",
      ).toBeLessThan(LIST_BUDGET_MS);
    });

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
