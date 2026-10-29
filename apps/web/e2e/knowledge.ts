import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import {
  keyListed,
  keystrokesDismissed,
  keystrokesListed,
  navOf,
  railOf,
  seedConcepts,
} from "./harness.ts";

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
export const isAFind = (url: URL): boolean => url.pathname.includes("knowledge.find");

export const isAnOpen = (url: URL): boolean => url.pathname.includes("knowledge.open");

export const heldBack = async (page: Page, named: (url: URL) => boolean) => {
  const held = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  await page.route(named, async (route) => {
    reached.resolve();
    await held.promise;
    await route.continue();
  });
  return { reached: reached.promise, release: held.resolve };
};

export const scrolledSideways = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

export const listsItsKeystrokes = async (
  page: Page,
  named: string,
  declared: Readonly<Record<string, { readonly key: string }>>,
  actions: readonly string[],
): Promise<void> => {
  const listed = await keystrokesListed(page, named);
  for (const { key } of Object.values(declared)) {
    await expect(keyListed(listed, key), `the list holds no ${key}`).toBeVisible();
  }
  for (const action of actions) await expect(listed).toContainText(action);
  await keystrokesDismissed(page, listed);
};

export const conceptsSeeded = async (
  api: APIRequestContext,
  input: Parameters<typeof seedConcepts>[1],
) => {
  const { concepts } = await seedConcepts(api, input);
  return new Map(concepts.map((concept) => [concept.title, concept]));
};

export const knowledgeMenuOpened = async (page: Page): Promise<Locator> => {
  await railOf(page).getByRole("link", { name: "Knowledge" }).click();
  const menu = navOf(page, "Knowledge");
  await expect(menu).toBeVisible();
  return menu;
};
