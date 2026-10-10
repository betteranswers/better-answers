import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

import type { AUDIENCES, SENSITIVITIES } from "@better-answers/schema";

import { keystrokesDismissed, keystrokesListed } from "./harness.ts";

/** Matched by name anywhere in the path, because the tRPC client batches its reads. */
export const isAFind = (url: URL): boolean => url.pathname.includes("knowledge.find");

export const isAnOpen = (url: URL): boolean => url.pathname.includes("knowledge.open");

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

type Sensitivity = (typeof SENSITIVITIES)[number];

/** `label` is the file's own name for the source; `sensitivity` holds the document closer than its concept. */
type CitedDocument = {
  readonly title: string;
  readonly label?: string;
  readonly passages: readonly string[];
  readonly sensitivity?: Sensitivity;
};

/** A concept seeded earlier in the same list, by its title. */
type CitedConcept = { readonly concept: string };

/** A place of the file's own in a source, such as `p.4`, which opens nothing. */
type CitedPlace = { readonly title: string; readonly at: string };

type FrontmatterEntry = Readonly<Record<string, string | number | boolean | null>>;

/** A body that writes `[^source-N]` places that source's mark; the rest follow its last word. */
type SeedConcept = {
  readonly title: string;
  readonly body: string;
  readonly kind?: string;
  readonly sensitivity?: Sensitivity;
  readonly audience?: (typeof AUDIENCES)[number];
  readonly trust?: "unverified" | "machine-confirmed" | "human-reviewed";
  readonly linksTo?: readonly string[];
  readonly sources?: readonly (CitedDocument | CitedConcept | CitedPlace)[];
  readonly frontmatter?: Readonly<
    Record<
      string,
      string | number | boolean | null | readonly string[] | readonly FrontmatterEntry[]
    >
  >;
};

const seeded = z.object({
  concepts: z.array(
    z.object({
      iri: z.string(),
      title: z.string(),
      documents: z.array(z.object({ documentId: z.string(), title: z.string() })),
    }),
  ),
});

/** The harness's `seedConcepts` with every source it takes, answering each concept by its title. */
export const conceptsSeeded = async (
  api: APIRequestContext,
  input: { workspaceId: string; userId: string; concepts: readonly SeedConcept[] },
) => {
  const answered = await api.post("/__harness/concepts", { data: input });
  expect(answered.ok(), `/concepts answered ${String(answered.status())}`).toBe(true);
  const { concepts } = seeded.parse(await answered.json());
  return new Map(concepts.map((concept) => [concept.title, concept]));
};
