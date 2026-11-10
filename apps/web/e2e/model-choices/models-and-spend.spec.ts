import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { MODEL_CHOICES_WORDS } from "@/features/model-choices/words.ts";
import { CONTROL_CENTRE, menuGroupIn, pageById } from "@/shared/navigation.ts";

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

const modelChoicesCard = (page: Page) =>
  page.getByRole("region", { name: MODEL_CHOICES_WORDS.heading });

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

const MODELS_AND_SPEND = pageById(models, "models-and-spend");

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
      - region ${JSON.stringify(MODEL_CHOICES_WORDS.heading)}:
        - heading ${JSON.stringify(MODEL_CHOICES_WORDS.heading)} [level=2]
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
            - term: ${MODEL_CHOICES_WORDS.provider}
            - definition: "Anthropic"
            - term: ${MODEL_CHOICES_WORDS.model}
            - definition: ${ANSWERING.model}
          - listitem:
            - heading "Judging" [level=3]
            - paragraph
          - listitem:
            - heading "Embedding" [level=3]
            - term: ${MODEL_CHOICES_WORDS.provider}
            - definition: "Mistral AI"
            - term: ${MODEL_CHOICES_WORDS.model}
            - definition: ${EMBEDDING.model}
            - paragraph: /\\b${String(EMBEDDING_DIMENSIONS)}\\b/
    `);
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${JSON.stringify(pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name)} [level=1]
        - tablist ${JSON.stringify(pageById(menuGroupIn(CONTROL_CENTRE, "models"), "models-and-spend").name)}:
          - tab ${JSON.stringify(MODEL_CHOICES_WORDS.heading)} [selected]
          - tab "Spend"
        - tabpanel ${JSON.stringify(MODEL_CHOICES_WORDS.heading)}:
          - /children: equal
          - region ${JSON.stringify(MODEL_CHOICES_WORDS.heading)}
    `);

    await passesTheAccessibilityGate();
  });
});
