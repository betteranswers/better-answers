import { expect, type Page, type Response, type Route } from "@playwright/test";
import { z } from "zod";

import { keystrokesDismissed, keystrokesListed } from "./harness.ts";

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
export const isAFind = (url: URL): boolean => url.pathname.includes("knowledge.find");

export const isAnOpen = (url: URL): boolean => url.pathname.includes("knowledge.open");

type Answer = Readonly<Record<string, unknown>>;

const anAnswer = z.record(z.string(), z.unknown());

const batched = z.array(z.object({ result: z.object({ data: anAnswer }) }));

/** The api's own answers changed on their way to the page; a batch can carry a find beside an open. */
const answeredWith =
  (changed: (data: Answer) => Answer) =>
  async (route: Route): Promise<void> => {
    const response = await route.fetch();
    const answers = batched.parse(await response.json());
    await route.fulfill({
      response,
      json: answers.map(({ result }) => ({ result: { data: changed(result.data) } })),
    });
  };

const matchesIn = z.object({ matches: z.array(anAnswer) });

const matchesOf = (data: Answer): readonly Answer[] | undefined =>
  matchesIn.safeParse(data).data?.matches;

/** The matches a `knowledge.find` answered with, as the page was sent them. */
export const matchesAnswered = async (response: Response): Promise<readonly Answer[]> =>
  batched.parse(await response.json()).flatMap(({ result }) => matchesOf(result.data) ?? []);

/** A find's answer with its matches changed and the rest as the api sent it. */
export const matchesBecome = (changed: (matches: readonly Answer[]) => readonly Answer[]) =>
  answeredWith((data) => {
    const matches = matchesOf(data);
    return matches === undefined ? data : { ...data, matches: changed(matches) };
  });

const passageIn = z.object({ passage: anAnswer });

/** An open's answer with some of its passage changed and the rest as the api sent it. */
export const passageBecomes = (changed: Answer) =>
  answeredWith((data) => {
    const passage = passageIn.safeParse(data).data?.passage;
    return passage === undefined ? data : { ...data, passage: { ...passage, ...changed } };
  });

/** A batch refused as the api refuses a call past a ceiling, with a minute to wait, so no test runs against the clock. */
export const refusedAtACeiling = (route: Route): Promise<void> => {
  const calls = new URL(route.request().url()).pathname.split(",");
  const refusal = {
    error: {
      message: "Too many requests.",
      code: -32_029,
      data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds: 60 },
    },
  };
  return route.fulfill({ status: 429, json: calls.map(() => refusal) });
};

/** Holds each request it names until `release`, so a test goes on while the page still waits on it. */
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

/** The window taking focus again. Its own request leaves after any read that asked, so a count taken next holds it. */
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

/** One more call than the person's knowledge reads may make in a minute. */
const PAST_THE_READS_CEILING = 121;

/** Batched calls fill the person's ceiling and leave the address's, which counts requests, clear. */
export const readsCeilingFilled = async (page: Page, read: string): Promise<void> => {
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

/** How far the page scrolls sideways, which at every width is nowhere. */
export const scrolledSideways = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** `?` lists each keystroke the page declares, and Escape hands focus back to its button. */
export const listsItsKeystrokes = async (
  page: Page,
  named: string,
  declared: readonly { readonly action: string }[],
): Promise<void> => {
  const listed = await keystrokesListed(page, named);
  for (const keystroke of declared) await expect(listed).toContainText(keystroke.action);
  await keystrokesDismissed(page, listed);
};
