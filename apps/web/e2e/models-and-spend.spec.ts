import type { APIRequestContext, Page } from "@playwright/test";

import { EMBEDDING_DIMENSIONS } from "@better-answers/schema";

import { goHome } from "@/app/words.ts";
import { MODEL_CHOICES_WORDS, providerWordOf } from "@/features/model-choices/words.ts";
import { aRole } from "@/features/people/role-meanings.ts";
import { CONTROL_CENTRE, menuGroupIn, HOMES, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "./browser.ts";
import {
  aMemberSignedInAt,
  notFoundOfferingHome,
  anAddress,
  provision,
  seedModelChoices,
  signIn,
  skipLinkReachesThePage,
  type SeedModelChoice,
} from "./harness.ts";

const LIST_BUDGET_MS = 1000;

const modelChoicesCard = (page: Page) => page.getByRole("region", { name: "Model choices" });

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

const EVERY_PURPOSE: readonly SeedModelChoice[] = [
  { purpose: "extraction", provider: "anthropic", model: "claude-haiku-5" },
  { purpose: "enrichment", provider: "local", model: "llama-4" },
  ANSWERING,
  { purpose: "judging", provider: "anthropic", model: "claude-opus-5" },
  EMBEDDING,
];

const UNNAMED_PROVIDER = "acme-inference";

const PURPOSES = ["Extraction", "Enrichment", "Answering", "Judging", "Embedding"] as const;

const rowOf = (page: Page, purpose: (typeof PURPOSES)[number]) =>
  modelChoicesCard(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 3, name: purpose }) });

const embeddingRow = (page: Page) => rowOf(page, "Embedding");

const whoSetsLine = (page: Page) =>
  modelChoicesCard(page).getByText(MODEL_CHOICES_WORDS.whoSets, { exact: true });

const models = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(models, "Models and spend");

/** No role lands on Models and spend, so every test here opens it from the member's home. */
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
  test("shows a member their five model choices, never another workspace's", async ({
    page,
    request,
  }) => {
    const theirs = await provision(request, { name: "Southern Castings" });
    await seedModelChoices(request, {
      workspaceId: theirs.workspaceId,
      modelChoices: [
        { purpose: "answering", provider: "openai", model: "gpt-5-not-mine" },
        { purpose: "extraction", provider: "google", model: "gemini-not-mine" },
      ],
    });

    await signedInWith(page, request, {
      name: "Northern Tooling",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    const card = modelChoicesCard(page);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);
    await expect(card).toContainText(providerWordOf(ANSWERING.provider));
    await expect(card).toContainText(ANSWERING.model);

    const everything = page.locator("body");
    await expect(everything).not.toContainText("openai");
    await expect(everything).not.toContainText(providerWordOf("openai"));
    await expect(everything).not.toContainText("gpt-5-not-mine");
    await expect(everything).not.toContainText("google");
    await expect(everything).not.toContainText(providerWordOf("google"));
    await expect(everything).not.toContainText("gemini-not-mine");
    await expect(everything).not.toContainText(theirs.name);
  });

  test("names a set purpose's provider, never by its stored id", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Calderdale Patterns",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    await expect(
      rowOf(page, "Answering").getByText(providerWordOf(ANSWERING.provider), { exact: true }),
    ).toBeVisible();
    await expect(
      embeddingRow(page).getByText(providerWordOf(EMBEDDING.provider), { exact: true }),
    ).toBeVisible();

    // Exact, because a model's id can hold its provider's: mistral-embed.
    await expect(page.getByText(ANSWERING.provider, { exact: true })).toHaveCount(0);
    await expect(page.getByText(EMBEDDING.provider, { exact: true })).toHaveCount(0);
  });

  test("shows a provider it cannot name as its stored id", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Airedale Springs",
      modelChoices: [{ purpose: "judging", provider: UNNAMED_PROVIDER, model: "acme-large" }],
    });

    await expect(rowOf(page, "Judging").getByText(UNNAMED_PROVIDER, { exact: true })).toBeVisible();
  });

  test("keeps five rows and says once who sets a model", async ({ page, request }) => {
    await signedInWith(page, request, { name: "Acme Joinery", modelChoices: [ANSWERING] });

    const card = modelChoicesCard(page);
    await expect(card.getByRole("listitem")).toHaveCount(5);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(PURPOSES);
    await expect(card.getByText(MODEL_CHOICES_WORDS.unset, { exact: true })).toHaveCount(4);
    await expect(whoSetsLine(page)).toHaveCount(1);

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText(MODEL_CHOICES_WORDS.unset);
    await expect(
      embedding.getByText(MODEL_CHOICES_WORDS.fixed, { exact: true }),
      "an embedding purpose with no model choice has nothing fixed to note",
    ).toHaveCount(0);
    await expect(embedding).not.toContainText(MODEL_CHOICES_WORDS.fixedReason);
  });

  test("says in one line that no model choice is set", async ({ page, request }) => {
    await signedInWith(page, request, { name: "Ryedale Pressings", modelChoices: [] });

    const card = modelChoicesCard(page);
    await expect(card.getByText(MODEL_CHOICES_WORDS.noneSet, { exact: true })).toBeVisible();
    await expect(whoSetsLine(page)).toBeVisible();
    await expect(card.getByRole("list")).toHaveCount(0);
    await expect(card.getByRole("heading", { level: 3 })).toHaveCount(0);
    await expect(card).not.toContainText(MODEL_CHOICES_WORDS.fixedReason);
  });

  test("omits who sets a model once every purpose has one", async ({ page, request }) => {
    await signedInWith(page, request, { name: "Swaledale Gears", modelChoices: EVERY_PURPOSE });

    const card = modelChoicesCard(page);
    await expect(card.getByRole("listitem")).toHaveCount(5);
    await expect(card.getByText(MODEL_CHOICES_WORDS.unset, { exact: true })).toHaveCount(0);
    await expect(whoSetsLine(page)).toHaveCount(0);
  });

  test("says why the embedding model choice is fixed, with dimensions", async ({
    page,
    request,
  }) => {
    await signedInWith(page, request, { name: "Halifax Fabrication", modelChoices: [EMBEDDING] });

    const embedding = embeddingRow(page);
    await expect(embedding).toContainText(providerWordOf(EMBEDDING.provider));
    await expect(embedding).toContainText(EMBEDDING.model);

    await expect(embedding).toContainText(MODEL_CHOICES_WORDS.fixed);

    await expect(embedding).toContainText(`${EMBEDDING_DIMENSIONS} dimensions`);

    await expect(embedding).toContainText(MODEL_CHOICES_WORDS.fixedReason);

    await expect(
      modelChoicesCard(page).getByText(MODEL_CHOICES_WORDS.fixed, { exact: true }),
    ).toHaveCount(1);
  });

  test("offers no control that edits, adds or deletes model choices", async ({ page, request }) => {
    await signedInWith(page, request, {
      name: "Pennine Metalwork",
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    const card = modelChoicesCard(page);

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
      modelChoices: ANSWERING_AND_EMBEDDING,
    });

    const nav = page.getByRole("navigation", { name: CONTROL_CENTRE.name });
    await nav.getByRole("link", { name: "Members" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();

    const started = Date.now();
    await nav.getByRole("link", { name: MODELS_AND_SPEND.name }).click();
    await expect(modelChoicesCard(page).getByRole("listitem")).toHaveCount(5);
    const elapsed = Date.now() - started;

    test.info().annotations.push({ type: "model choices list", description: `${elapsed} ms` });
    expect(elapsed).toBeLessThan(LIST_BUDGET_MS);
  });

  for (const role of ["Editor", "Viewer"] as const) {
    test(`shows ${aRole(role)} the page as not found`, async ({ page, request }) => {
      await aMemberSignedInAt(page, request, role, MODELS_AND_SPEND.path);

      await notFoundOfferingHome(page, role);
      await expect(modelChoicesCard(page)).toHaveCount(0);
    });
  }

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
      - region "Model choices":
        - heading "Model choices" [level=2]
        - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.lead)}
        - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.whoSets)}
        - list:
          - listitem:
            - heading "Extraction" [level=3]
            - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.unset)}
          - listitem:
            - heading "Enrichment" [level=3]
            - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.unset)}
          - listitem:
            - heading "Answering" [level=3]
            - term: Provider
            - definition: ${JSON.stringify(providerWordOf(ANSWERING.provider))}
            - term: Model
            - definition: ${ANSWERING.model}
          - listitem:
            - heading "Judging" [level=3]
            - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.unset)}
          - listitem:
            - heading "Embedding" [level=3]
            - term: Provider
            - definition: ${JSON.stringify(providerWordOf(EMBEDDING.provider))}
            - term: Model
            - definition: ${EMBEDDING.model}
            - paragraph: ${JSON.stringify(`${MODEL_CHOICES_WORDS.fixed} ${EMBEDDING_DIMENSIONS} dimensions`)}
            - paragraph: ${JSON.stringify(MODEL_CHOICES_WORDS.fixedReason)}
    `);
    // The heading and its lead line, then the tabs. Equal children: the panel holds the card alone.
    await expect(page.getByRole("main", { name: "Page" })).toMatchAriaSnapshot(`
      - main "Page":
        - heading ${JSON.stringify(models.name)} [level=1]
        - paragraph: ${JSON.stringify(models.summary)}
        - tablist ${JSON.stringify(MODELS_AND_SPEND.name)}:
          - tab "Model choices" [selected]
          - tab "Spend"
        - tabpanel "Model choices":
          - /children: equal
          - region "Model choices"
    `);

    await passesTheAccessibilityGate();
  });
});

const MOVED = [
  ["/people/audit-log", "/system/audit-log"],
  ["/system/routes-and-spend", MODELS_AND_SPEND.path],
  ["/agent-operations/routes-and-spend", MODELS_AND_SPEND.path],
] as const;

test.describe("a page's older address", () => {
  for (const [from, to] of MOVED) {
    test(`leads an Admin from ${from} to ${to}, Back returning`, async ({ page, request }) => {
      await signedInWith(page, request, { name: "Nidderdale Forge", modelChoices: [] });
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
