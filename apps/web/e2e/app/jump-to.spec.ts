import type { APIRequestContext, Page } from "@playwright/test";

import { CONTROL_CENTRE, HOMES, menuGroupIn, pageNamed } from "@/shared/navigation.ts";

import { expect, test } from "../browser.ts";
import {
  actionClocked,
  addMember,
  aMemberSignedInAt,
  anAddress,
  clockTheNextDraw,
  person,
  provision,
  signIn,
} from "../harness.ts";

const LIST_BUDGET_MS = 1000;

const MODELS = menuGroupIn(CONTROL_CENTRE, "models");

const MODELS_AND_SPEND = pageNamed(MODELS, "Models and Spend");

const INVITE_A_PERSON = "Invite a Person";

const PRIYA = "Priya Shah";

const TOM = "Tom Okafor";

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Jump To" });

const inputOf = (page: Page) => dialogOf(page).getByRole("combobox", { name: "Jump To" });

const optionOf = (page: Page, name: string | RegExp) =>
  dialogOf(page).getByRole("option", { name });

const groupOf = (page: Page, name: string) => dialogOf(page).getByRole("group", { name });

const searchRowOf = (page: Page) => groupOf(page, "Knowledge").getByRole("option");

const searchBoxOf = (page: Page) =>
  page
    .getByRole("region", { name: "Search" })
    .getByRole("searchbox", { name: "Search by a word or a question" });

const signedInOffMembers = async (page: Page, api: APIRequestContext, email: string) => {
  await page.goto("/sign-in");
  await signIn(page, api, email);
  await page.goto(MODELS_AND_SPEND.path);
  await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();
};

type Teammate = { readonly address: string; readonly id: string };

type Team = { readonly priya: Teammate; readonly tom: Teammate };

const anAdminWithATeam = async (page: Page, api: APIRequestContext, name: string) => {
  const email = anAddress("jump-to");
  const workspace = await provision(api, { name, adminEmail: email });
  const joined: Teammate[] = [];
  for (const [address, displayName, role] of [
    [anAddress("priya"), PRIYA, "Editor"],
    [anAddress("tom"), TOM, "Viewer"],
  ] as const) {
    const member = await person(api, address, { displayName });
    await addMember(api, { workspaceId: workspace.workspaceId, userId: member.id, role });
    joined.push({ address, id: member.id });
  }
  const [priya, tom] = joined;
  if (priya === undefined || tom === undefined) throw new Error("the team was joined");
  const team: Team = { priya, tom };
  await signedInOffMembers(page, api, email);
  return team;
};

const opened = async (page: Page, keys: string) => {
  await page.keyboard.press(keys);
  await expect(dialogOf(page)).toBeVisible();
  await expect(inputOf(page)).toBeFocused();
};

const typed = async (page: Page, words: string) => {
  await inputOf(page).fill(words);
};

for (const [what, words] of [
  ["a decimal", "1.50"],
  ["an exponent", "1e3"],
  ["a quoted phrase", '"audit logs"'],
] as const) {
  test(`carries ${what} from jump-to to Search as typed`, async ({ page, request }) => {
    await aMemberSignedInAt(page, request, "Viewer", HOMES.Viewer.path);

    await opened(page, "Control+k");
    await typed(page, words);
    await searchRowOf(page).click();

    await expect(searchBoxOf(page)).toHaveValue(words);
    await expect(page).toHaveURL(/knowledge\.search=/);
    await page.reload();
    await expect(searchBoxOf(page)).toHaveValue(words);
  });
}

test("draws the list within its second, timed in the page", async ({ page, request }) => {
  await anAdminWithATeam(page, request, "Ryedale Metalwork");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Models" })).toBeVisible();

  await clockTheNextDraw(page, { at: "//*[@role='dialog']", reads: TOM });
  await page.keyboard.press("Meta+k");
  const elapsed = await actionClocked(page);
  test.info().annotations.push({ type: "jump-to list", description: `${elapsed} ms` });
  expect(elapsed, "the jump-to list did not draw within its second").toBeLessThan(LIST_BUDGET_MS);

  await expect(groupOf(page, "Pages")).toBeVisible();
  await expect(optionOf(page, new RegExp(PRIYA))).toBeVisible();
  await expect(optionOf(page, INVITE_A_PERSON)).toBeVisible();
});
