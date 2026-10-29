import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

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

export const windowRefocused = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    window.dispatchEvent(new Event("visibilitychange"));
    // Two tasks on: the query client resumes its paused actions first, and the api's client batches on a timer.
    for (const _task of [1, 2]) {
      await new Promise((later) => {
        setTimeout(later);
      });
    }
    await fetch("/health");
  });

const PAST_THE_READS_CEILING = 121;

const READS_WINDOW_MS = 60_000;

const FILL_AND_REFUSAL_MS = 10_000;

const aFreshReadsWindow = async (): Promise<void> => {
  const left = READS_WINDOW_MS - (Date.now() % READS_WINDOW_MS);
  if (left > FILL_AND_REFUSAL_MS) return;
  await new Promise((later) => {
    setTimeout(later, left);
  });
};

export const readsCeilingFilled = async (page: Page, read: string): Promise<void> => {
  await aFreshReadsWindow();
  const asked = new URL(read);
  const call = Object.values(
    z.record(z.string(), z.unknown()).parse(JSON.parse(asked.searchParams.get("input") ?? "{}")),
  )[0];
  const batch = 41;
  for (let sent = 0; sent < PAST_THE_READS_CEILING; sent += batch) {
    const input = Object.fromEntries(Array.from({ length: batch }, (_, at) => [String(at), call]));
    const path = Array.from({ length: batch }, () => "knowledge.find").join(",");
    await page.request.get(
      `/trpc/${path}?${new URLSearchParams({ batch: "1", input: JSON.stringify(input) }).toString()}`,
    );
  }
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
