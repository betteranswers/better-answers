import { configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import { z } from "zod";

import { CONCEPT_IRI_PREFIX } from "@better-answers/schema/concept-file";

import { MATCHES_A_PAGE, SEARCH_LIST } from "@/features/knowledge/knowledge-state.ts";
import { SEARCH_PAGE } from "@/shared/knowledge/concept-address.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { server } from "@test/stub-server.ts";
import { heldBack, type Api } from "@test/stubbed-api.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

export type Match = Readonly<Record<string, unknown>>;

export type Router = Awaited<ReturnType<typeof openAt>>;

const FIND = "knowledge.find";

const OPEN = "knowledge.open";

const FIND_ASKED = z.object({
  query: z.string(),
  limit: z.number(),
  cursor: z.string().optional(),
});

export type FindAsked = z.output<typeof FIND_ASKED>;

const PASSAGE_ASKED = z.object({ locator: z.string() });

const CONCEPT_ASKED = z.object({ iri: z.string() });

const lastAsk = (procedure: string): unknown =>
  server.asks.findLast((ask) => ask.procedure === procedure)?.input;

export const answeringFinds = (answer: (asked: FindAsked) => unknown) => (): unknown =>
  answer(FIND_ASKED.parse(lastAsk(FIND)));

export const answeringPassages = (answer: (locator: string) => unknown) => (): unknown =>
  answer(PASSAGE_ASKED.parse(lastAsk(OPEN)).locator);

export const answeringConcepts = (answer: (iri: string) => unknown) => (): unknown =>
  answer(CONCEPT_ASKED.parse(lastAsk(OPEN)).iri);

export const refusing = (refusal: unknown) => (): unknown => refusal;

export const findsAsked = (): readonly FindAsked[] =>
  server.asks.filter((ask) => ask.procedure === FIND).map((ask) => FIND_ASKED.parse(ask.input));

export const opensAsked = (): number => server.asks.filter((ask) => ask.procedure === OPEN).length;

export const pageOf = (matches: readonly Match[], asked: FindAsked) => {
  const from = asked.cursor === undefined ? 0 : Number(asked.cursor);
  const shown = matches.slice(from, from + asked.limit);
  const next = from + shown.length;
  return {
    query: asked.query,
    matches: shown,
    ...(next < matches.length ? { nextCursor: String(next) } : {}),
  };
};

export const finding = (table: Readonly<Record<string, readonly Match[]>>) =>
  answeringFinds((asked) => read(pageOf(table[asked.query] ?? [], asked)));

export const withMoreHeld = (api: Api, table: Readonly<Record<string, readonly Match[]>>) => {
  const held = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  api.set(
    FIND,
    answeringFinds((asked) => {
      const answer = read(pageOf(table[asked.query] ?? [], asked));
      if (asked.cursor === undefined) return answer;
      reached.resolve();
      return held.promise.then(() => answer);
    }),
  );
  return {
    reached: reached.promise,
    release: () => {
      held.resolve();
    },
  };
};

const ULID_LENGTH = 26;

const iriOf = (number: number): string =>
  `${CONCEPT_IRI_PREFIX}${String(number).padStart(ULID_LENGTH, "0")}`;

const aConcept = (title: string, number: number): Match => ({
  layer: "bundles",
  iri: iriOf(number),
  kind: "Answer",
  title,
  trust: { status: "unverified" },
  trustWords: "Unverified",
  collection: null,
  tags: [],
});

export const AUDIT_LOGS_RETENTION = aConcept("Audit Logs Retention", 1);

export const AUDIT_COMMITTEE = aConcept("Audit Committee", 2);

export const FORKLIFT_LICENCES = aConcept("Forklift Licences", 4);

export const aConceptRead = (title: string, number: number) =>
  read({
    found: true,
    concept: {
      iri: iriOf(number),
      frontmatter: { title, type: "Answer" },
      body: `${title} is kept.`,
      relations: [],
      bodyLinks: [],
      trust: { status: "unverified" },
      trustWords: "Unverified",
      evidence: [],
      access: "You can read this concept.",
      lead: "This concept answers from what the company has recorded.",
      next: "Ask a question to use it.",
    },
  });

const aDocument = (title: string, locator: string, openingLine: string): Match => ({
  layer: "sources",
  kind: "document",
  title,
  locator,
  sensitivity: "Internal",
  openingLine,
});

export const aPassageRead = (
  source: string,
  locator: string,
  text: string,
  sensitivity = "Internal",
) => read({ found: true, passage: { locator, source, sensitivity, text } });

export const HANDBOOK = "Warehouse handbook";

export const palletPassage = (index: number): string =>
  `Pallet bay ${index + 1} takes stock wrapped and labelled before it is racked.`;

const palletLocator = (index: number): string => `handbook/chars:${index}`;

export const PALLET_PASSAGES: readonly Match[] = Array.from(
  { length: MATCHES_A_PAGE + 5 },
  (_, index) => aDocument(HANDBOOK, palletLocator(index), palletPassage(index)),
);

const passageAtPalletLocator = (locator: string): string => {
  const index = PALLET_PASSAGES.findIndex((match) => match["locator"] === locator);
  return palletPassage(index);
};

export const FORKLIFT_GUIDE = "Forklift guide";

const FORKLIFT_GUIDE_TEXT = "A forklift lifts each pallet off the racking.";

const FORKLIFT_GUIDE_LOCATOR = "yard/chars:0";

export const aForkliftGuide = aDocument(
  FORKLIFT_GUIDE,
  FORKLIFT_GUIDE_LOCATOR,
  FORKLIFT_GUIDE_TEXT,
);

export const aRackingPlan = aDocument(
  "Racking plan",
  "yard/chars:1",
  "Each pallet bay is racked by row.",
);

export const thePalletPassages = answeringPassages((locator) =>
  aPassageRead(HANDBOOK, locator, passageAtPalletLocator(locator)),
);

export const theForkliftGuide = answeringPassages(() =>
  aPassageRead(FORKLIFT_GUIDE, FORKLIFT_GUIDE_LOCATOR, FORKLIFT_GUIDE_TEXT),
);

export const aCeilingMet = (retryAfterSeconds: number) => ({
  error: {
    message: "Too many requests.",
    code: -32_029,
    data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds },
  },
});

export const aSearchApi = (): Api => adaAnAdmin();

const searchRegion = (): HTMLElement => screen.getByRole("region", { name: "Search" });

export const searchBox = (): HTMLInputElement =>
  within(searchRegion()).getByRole<HTMLInputElement>("searchbox", {
    name: "Search by a word or a question",
  });

export const searchHeading = (): HTMLElement =>
  within(searchRegion()).getByRole("heading", { name: "Search" });

export const matchRows = (): readonly HTMLElement[] => {
  const list = within(searchRegion()).queryByRole("list", { name: "Matches" });
  return list === null ? [] : within(list).getAllByRole("listitem");
};

export const said = (): HTMLElement => {
  const [first] = within(searchRegion()).getAllByRole("status");
  if (first === undefined) throw new Error("the Search region has no status");
  return first;
};

export const saidNow = (): string => said().textContent;

export const textOfRows = () => matchRows().map((row) => row.textContent);

export const listsOnly = (title: string) =>
  waitFor(() => expect(textOfRows()).toEqual([expect.stringContaining(title)]));

export const alerted = (): HTMLElement | null => within(searchRegion()).queryByRole("alert");

export const loadMore = (): HTMLElement | null =>
  within(searchRegion()).queryByRole("button", { name: "Load More" });

export const loadMoreButton = (): HTMLElement =>
  within(searchRegion()).getByRole("button", { name: "Load More" });

export const retryButton = (): HTMLElement =>
  within(searchRegion()).getByRole("button", { name: "Retry" });

export const rowAt = (at: number): HTMLElement => {
  const row = matchRows()[at];
  if (row === undefined) throw new Error(`no match is listed at ${String(at)}`);
  return row;
};

export const rowNamed = (title: string): HTMLElement => {
  const row = matchRows().find((each) => each.textContent.includes(title));
  if (row === undefined) throw new Error(`${title} is not listed`);
  return row;
};

export const openerIn = (row: HTMLElement, title: string): HTMLElement =>
  within(row).getByRole("button", { name: title });

export const passagePanel = (title: string): HTMLElement | null =>
  screen.queryByRole("dialog", { name: title });

export const typed = (query: string): void => {
  fireEvent.change(searchBox(), { target: { value: query } });
};

const addressSearch = (router: Router): string | null =>
  new URLSearchParams(router.state.location.searchStr).get(`${SEARCH_LIST}.search`);

const addressHolds = (router: Router, query: string) =>
  waitFor(() => {
    if (addressSearch(router) !== query) throw new Error("the typed search has not settled");
  });

export const searched = async (router: Router, query: string): Promise<void> => {
  typed(query);
  await addressHolds(router, query);
  await waitFor(() => {
    if (!saidNow().includes(query)) throw new Error("the status does not name the search");
    if (matchRows().length === 0) throw new Error("no match is drawn");
  });
};

export const openedSearch = async (api: Api, address: string = SEARCH_PAGE.path) => {
  const router = await openAt(address, api);
  await screen.findByRole("searchbox", { name: "Search by a word or a question" });
  return router;
};

export const palletsFound = async () => {
  const api = aSearchApi();
  api.set(FIND, finding({ pallet: PALLET_PASSAGES }));
  api.set(OPEN, thePalletPassages);
  const router = await openedSearch(api);
  await searched(router, "pallet");
  return { api, router };
};

export const knowledgeRailPressed = (): void => {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "Areas" })).getByRole("link", {
      name: "Knowledge",
    }),
  );
};

export const foundNothing = async (
  api: Api,
  query: string,
  ask: () => void = () => {
    typed(query);
  },
): Promise<void> => {
  const find = heldBack(api, FIND, read({ query, matches: [] }));
  ask();
  await find.asked;
  await waitFor(() => expect(saidNow()).toContain(query));
  const whileAsking = saidNow();
  find.resolve();
  await waitFor(() =>
    expect(saidNow(), "the status still says the search is asking").not.toBe(whileAsking),
  );
  expect(saidNow()).toContain(query);
  expect(matchRows()).toHaveLength(0);
};

const named = (node: Element | null): string =>
  node === null ? "nothing" : `<${node.tagName.toLowerCase()}> ${node.textContent.slice(0, 40)}`;

export const focusIsOn = (element: Element, why: string): void => {
  if (document.activeElement !== element) {
    throw new Error(`${why}: focus is on ${named(document.activeElement)}, not ${named(element)}`);
  }
};

export const focusLandsOn = (where: () => Element, why: string) =>
  waitFor(() => {
    focusIsOn(where(), why);
  });

/** A click focuses a button first, which a bare `fireEvent.click` does not. */
export const pressed = (control: HTMLElement): void => {
  control.focus();
  fireEvent.click(control);
};

export const keyPressed = (key: string): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

export const refocused = (): void => {
  globalThis.dispatchEvent(new Event("visibilitychange"));
};

export const aMoment = (): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, 50);
  });

const ROOM_BESIDE_FROM_PX = 1280;

const ROOM_BESIDE = "--room-beside";

export const atWidth = (width: number): void => {
  document.documentElement.style.setProperty(ROOM_BESIDE, width < ROOM_BESIDE_FROM_PX ? "0" : "1");
};

const WAITS_AT_MOST_MS = 4000;

export const placedForSearch = (): void => {
  placedWithoutMeasuring();
  configure({ asyncUtilTimeout: WAITS_AT_MOST_MS });
  afterEach(() => {
    document.documentElement.style.removeProperty(ROOM_BESIDE);
  });
};
