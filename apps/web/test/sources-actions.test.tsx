import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { ConnectedSourcesPage } from "@/features/sources/connected-sources-page.tsx";
import { SAID_OF_A_CONNECTED_SOURCE } from "@/features/sources/refusal-words.ts";
import { refusedFor } from "@/features/sources/refusal.tsx";
import { ReviewActions } from "@/features/sources/review-actions.tsx";
import type { GroupOfFindings } from "@/features/sources/sources-api.ts";
import { SOURCES_KEYSTROKES, useTickedGroups } from "@/features/sources/sources-state.ts";
import {
  CONNECTOR_WORDS,
  REVIEW_WORDS,
  ROW_ACTIONS,
  ruleWordOf,
  SENSITIVITY_PANEL_WORDS,
  sensitivityAndAudienceWords,
  STATE_WORDS,
  THE_ACTION_BEFORE_IS_STILL_GOING,
  THE_CHANGE_BEFORE_IS_STILL_GOING,
} from "@/features/sources/words.ts";
import { ViewStateSlot } from "@/shared/page-toolbar.tsx";
import { STOCK } from "@/shared/refusal-words.ts";

import { addressOf, answered } from "./stubbed-api.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const THE_CONNECTED_SOURCE = "01K5T0000000000000000BIND1";

const ANOTHER_CONNECTED_SOURCE = "01K5T0000000000000000BIND2";

const BANK_DETAILS: GroupOfFindings = {
  documentId: "01K5T00000000000000000DOC1",
  title: "Supplier form",
  sensitivity: "Internal",
  category: "bank-details",
  ruleId: "UK_BANK_ACCOUNT",
  tier: "always",
  specialCategory: false,
  found: 2,
  overriddenByErasure: 0,
  dismissed: 0,
};

const HEALTH_CUE: GroupOfFindings = {
  documentId: "01K5T00000000000000000DOC2",
  title: "Pump service notes",
  sensitivity: "Restricted",
  category: "special-category",
  ruleId: "HEALTH_CUE",
  tier: "always",
  specialCategory: true,
  found: 1,
  overriddenByErasure: 0,
  dismissed: 0,
};

/** Raised by a rule the page's list of rules has not met. */
const A_PASSPORT: GroupOfFindings = {
  ...BANK_DETAILS,
  category: "government-identifier",
  ruleId: "UK_PASSPORT",
};

const NOT_SPECIAL_CATEGORY = SAID_OF_A_CONNECTED_SOURCE["not-special-category"];

/** The review's half of the slot, standing in for the findings table a click writes through. */
function TicksIn(properties: { readonly connectedSourceId: string }) {
  const [, tick] = useTickedGroups();
  const ticking = (groups: readonly GroupOfFindings[]) => () => {
    tick({ connectedSourceId: properties.connectedSourceId, groups });
  };
  return (
    <>
      <button type="button" onClick={ticking([BANK_DETAILS])}>
        Tick bank details
      </button>
      <button type="button" onClick={ticking([HEALTH_CUE])}>
        Tick the health cue
      </button>
      <button type="button" onClick={ticking([HEALTH_CUE, BANK_DETAILS])}>
        Tick both
      </button>
      <button type="button" onClick={ticking([A_PASSPORT])}>
        Tick the passport
      </button>
    </>
  );
}

const reviewing = (connectedSourceId: string, tickedIn: string) =>
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <TicksIn connectedSourceId={tickedIn} />
        <ReviewActions connectedSourceId={connectedSourceId} />
      </ViewStateSlot>
    </Providers>,
  );

const action = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

const UNTICKED = [
  REVIEW_WORDS.keep.label,
  REVIEW_WORDS.narrowDocuments.label,
  REVIEW_WORDS.dismiss.label,
];

describe("the review's three bulk actions", () => {
  it("stand disabled, each described by the line that enables them", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    const enabling = screen.getByText(REVIEW_WORDS.selectFirst);
    for (const label of UNTICKED) {
      expect(action(label).disabled).toBe(true);
      expect(action(label).getAttribute("aria-describedby")).toBe(enabling.id);
    }
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("take a ticked group, and the enabling line goes", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick bank details"));

    expect(screen.queryByText(REVIEW_WORDS.selectFirst)).toBeNull();
    const keep = action(REVIEW_WORDS.keep.label);
    expect(keep.disabled).toBe(false);
    expect(keep.hasAttribute("aria-describedby")).toBe(false);
    expect(action(REVIEW_WORDS.narrowDocuments.label).disabled).toBe(false);
  });

  it("count the ticked groups in the dialog's name", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick both"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    expect(screen.getByRole("dialog", { name: /\b2\b/v })).toBeDefined();
  });

  it("never take groups another connected source's review ticked", () => {
    reviewing(THE_CONNECTED_SOURCE, ANOTHER_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    for (const label of UNTICKED) expect(action(label).disabled).toBe(true);
    expect(screen.getByText(REVIEW_WORDS.selectFirst)).toBeDefined();
  });

  it("list a ticked group by its rule's word", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick bank details"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    const listed = within(screen.getByRole("dialog")).getByRole("listitem");
    expect(listed.textContent).toContain(ruleWordOf(BANK_DETAILS.ruleId));
    expect(listed.textContent).not.toContain(BANK_DETAILS.ruleId);
  });

  it("list a rule they have not met as its id", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the passport"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    expect(within(screen.getByRole("dialog")).getByText(A_PASSPORT.ruleId)).toBeDefined();
  });
});

describe("the dismissal as not special category", () => {
  it("is offered over ticked special category groups alone", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    expect(action(REVIEW_WORDS.dismiss.label).disabled).toBe(false);
    expect(screen.queryByText(NOT_SPECIAL_CATEGORY)).toBeNull();
  });

  it("stands disabled over a mixed selection, and says why", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick both"));

    const dismissal = action(REVIEW_WORDS.dismiss.label);
    expect(dismissal.disabled).toBe(true);
    expect(dismissal.getAttribute("aria-describedby")).toBe(
      screen.getByText(NOT_SPECIAL_CATEGORY).id,
    );
    expect(action(REVIEW_WORDS.keep.label).disabled).toBe(false);
  });

  it("opens on s, asking a reason and naming no finding", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the health cue"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.dismiss.key });

    const dialog = screen.getByRole("dialog", { name: REVIEW_WORDS.dismiss.named(1) });
    expect(dialog.textContent).toContain(ruleWordOf(HEALTH_CUE.ruleId));
    expect(dialog.textContent).toContain("Pump service notes");
    expect(screen.getByLabelText("Reason")).toBeDefined();
    expect(dialog.textContent).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
  });

  it("says the api's not-special-category refusal as the hint does", () => {
    const { container } = render(<p>{refusedFor("not-special-category", "inapplicable").words}</p>);

    expect(container.textContent).toBe(NOT_SPECIAL_CATEGORY);
  });
});

const HANDBOOK = {
  connectedSourceId: THE_CONNECTED_SOURCE,
  name: "Staff handbook",
  connector: "upload",
  sensitivity: "Restricted",
  audience: "groups",
  audienceGroups: ["01K5T000000000000000GROUP1"],
  destination: ["passage-index", "bundle"],
  retentionClass: "keep",
  state: "received",
  publishedAt: null,
  documentCount: 1,
  passageCount: 0,
  lastSync: null,
  unreadable: [],
  unreadableByReason: {},
};

const PRICE_BOOK = {
  ...HANDBOOK,
  connectedSourceId: ANOTHER_CONNECTED_SOURCE,
  name: "Price book",
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
  state: "indexed",
};

const A_PUBLISH = "2026-10-07T09:05:00.000Z";

const WIDENED = { sensitivity: "Internal", audience: "groups" } as const;

const ANSWERS: Readonly<Record<string, unknown>> = {
  "sources.list": [HANDBOOK, PRICE_BOOK],
  "sources.widen": { visibility: WIDENED, concepts: [], writeUps: [] },
};

/** The api's refusal of a keep, as the tRPC client's batch carries it back. */
const KEEP_REFUSED = {
  error: {
    message: "refused",
    code: -32_600,
    data: {
      code: "BAD_REQUEST",
      httpStatus: 400,
      refusal: { word: "not-the-always-set", class: "inapplicable" },
    },
  },
};

/** The api's refusal for the reader's role, in a word this feature lists no sentence for. */
const ROLE_FORBIDS = {
  error: {
    message: "refused",
    code: -32_003,
    data: {
      code: "FORBIDDEN",
      httpStatus: 403,
      refusal: { word: "role-forbids", class: "forbidden" },
    },
  },
};

const HELD: ReadonlySet<string> = new Set([
  "sources.narrow",
  "sources.widen",
  "sources.publish",
  "sources.keepInText",
]);

type SourcesApi = {
  /** Read as each held call arrives, so a test may hold a later call and not an earlier one. */
  held?: Promise<void>;
  readonly findings?: readonly GroupOfFindings[];

  /** The actions the api refuses for the reader's role. */
  readonly forbidden?: readonly string[];

  /** The connected sources the list read answers, where a test needs its own. */
  readonly listed?: readonly unknown[];
};

/** Reads are answered at once; a widening is taken and a keep refused once `held` lets them. */
const atSources = (api: SourcesApi = {}) => {
  const asked: string[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    ...ANSWERS,
    "sources.list": api.listed ?? ANSWERS["sources.list"],
    "sources.findings": api.findings ?? [],
  };
  const refusals = new Map<string, unknown>([["sources.keepInText", KEEP_REFUSED]]);
  for (const action of api.forbidden ?? []) refusals.set(action, ROLE_FORBIDS);
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered({});
    const names = pathname.replace("/trpc/", "").split(",");
    asked.push(...names);
    if (names.some((name) => HELD.has(name))) await api.held;
    return answered(names.map((name) => refusals.get(name) ?? { result: { data: answers[name] } }));
  });
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <ConnectedSourcesPage />
      </ViewStateSlot>
    </Providers>,
  );
  return asked;
};

const rowOf = async (name: string) => within(await screen.findByRole("listitem", { name }));

/** jsdom's accessible name drops the space a browser keeps before the hidden source's name. */
const rowAction = (row: ReturnType<typeof within>, label: string, name: string) =>
  row.getByRole("button", { name: new RegExp(`^${label} ?${name}$`, "v") });

const panelOf = (change: "narrow" | "widen", name: string) =>
  screen.queryByRole("group", { name: SENSITIVITY_PANEL_WORDS[change].named(name) });

const reviewOf = (name: string) =>
  screen.queryByRole("region", { name: REVIEW_WORDS.heading(name) });

/** The handbook's widening opened from its row's button, which then holds focus as the opener. */
const widenOpened = (row: ReturnType<typeof within>): HTMLElement => {
  const widen = rowAction(row, ROW_ACTIONS.widen, "Staff handbook");
  widen.focus();
  fireEvent.click(widen);
  return widen;
};

const commitIn = (row: ReturnType<typeof within>) =>
  row.getByRole("button", { name: SENSITIVITY_PANEL_WORDS.widen.commit });

const describedBy = (control: HTMLElement): string | undefined =>
  document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent;

const TICKING = { name: REVIEW_WORDS.select(BANK_DETAILS) };

/** A keep sent from the handbook's review, its answer held and the hold already drawn. */
const aKeepHeldPending = async () => {
  const answer = Promise.withResolvers<void>();
  atSources({ held: answer.promise, findings: [BANK_DETAILS] });
  const row = await rowOf("Staff handbook");
  const review = rowAction(row, ROW_ACTIONS.review, "Staff handbook");
  fireEvent.click(review);
  fireEvent.click(await row.findByRole("checkbox", TICKING));
  fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });
  const reason = screen.getByLabelText("Reason");
  fireEvent.change(reason, { target: { value: "Printed on every invoice" } });
  fireEvent.submit(reason);
  // The hold is drawn a task after the keep is sent, as a second press would find it.
  await waitFor(() => {
    expect(review.getAttribute("aria-disabled")).toBe("true");
  });
  return { answer, row, review };
};

/** Which reviews are drawn, and whether the page said why a held press did nothing. */
const reviewsDrawn = () => ({
  handbook: reviewOf("Staff handbook") !== null,
  priceBook: reviewOf("Price book") !== null,
  saidWhy: screen.queryByText(THE_ACTION_BEFORE_IS_STILL_GOING) !== null,
});

const HELD_AS_IT_WAS = { handbook: true, priceBook: false, saidWhy: true };

/** The review that sent the keep is still drawn, so the refusal reaches it and its group. */
const theKeepIsRefusedInItsReview = async (held: Awaited<ReturnType<typeof aKeepHeldPending>>) => {
  held.answer.resolve();
  expect(await held.row.findByText(SAID_OF_A_CONNECTED_SOURCE["not-the-always-set"])).toBeDefined();
  expect(held.row.getByRole("checkbox", TICKING).getAttribute("aria-checked")).toBe("true");
  await waitFor(() => {
    expect(held.review.hasAttribute("aria-disabled")).toBe(false);
  });
};

describe("a connected source's row", () => {
  it("reads its stored values as words", async () => {
    atSources();
    const row = await rowOf("Staff handbook");

    expect(row.getByText(CONNECTOR_WORDS.upload)).toBeDefined();
    expect(row.getByText(STATE_WORDS.received)).toBeDefined();
    expect(row.getByText("Restricted")).toBeDefined();
    expect(row.queryByText("upload")).toBeNull();
    expect(row.queryByText("received")).toBeNull();
  });

  it("labels each action with its effect and its source", async () => {
    atSources();
    const row = await rowOf("Price book");

    for (const label of Object.values(ROW_ACTIONS)) {
      expect(rowAction(row, label, "Price book")).toBeDefined();
    }
  });

  it("opens its review inside itself, focus on the heading", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const review = rowAction(row, ROW_ACTIONS.review, "Staff handbook");
    expect(review.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(review);

    const heading = row.getByRole("heading", {
      level: 4,
      name: REVIEW_WORDS.heading("Staff handbook"),
    });
    expect(document.activeElement).toBe(heading);
    expect(row.getByRole("region", { name: REVIEW_WORDS.heading("Staff handbook") })).toBeDefined();
    expect(review.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes its review on a second press, focus kept", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const review = rowAction(row, ROW_ACTIONS.review, "Staff handbook");
    fireEvent.click(review);

    review.focus();
    fireEvent.click(review);

    expect(reviewOf("Staff handbook")).toBeNull();
    expect(review.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(review);
  });

  it("holds its review open until a pending keep answers", async () => {
    const held = await aKeepHeldPending();

    fireEvent.click(held.review);

    expect(reviewsDrawn()).toEqual(HELD_AS_IT_WAS);
    await theKeepIsRefusedInItsReview(held);
  });

  it("holds another row's Review press while a keep is pending", async () => {
    const held = await aKeepHeldPending();
    const theirs = rowAction(await rowOf("Price book"), ROW_ACTIONS.review, "Price book");

    fireEvent.click(theirs);

    expect(reviewsDrawn()).toEqual(HELD_AS_IT_WAS);
    expect(theirs.getAttribute("aria-disabled")).toBe("true");
    await theKeepIsRefusedInItsReview(held);
  });

  it("holds r in another row while a keep is pending", async () => {
    const held = await aKeepHeldPending();
    const priceBook = await rowOf("Price book");
    // Flushed, so the row is the one in focus before the key is read.
    act(() => {
      rowAction(priceBook, ROW_ACTIONS.review, "Price book").focus();
    });

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.review.key });

    expect(reviewsDrawn()).toEqual(HELD_AS_IT_WAS);
    await theKeepIsRefusedInItsReview(held);
  });

  it("closes one review as another's opens", async () => {
    atSources();
    const handbook = await rowOf("Staff handbook");
    const priceBook = await rowOf("Price book");
    fireEvent.click(rowAction(handbook, ROW_ACTIONS.review, "Staff handbook"));

    fireEvent.click(rowAction(priceBook, ROW_ACTIONS.review, "Price book"));

    expect(reviewOf("Staff handbook")).toBeNull();
    expect(
      priceBook.getByRole("region", { name: REVIEW_WORDS.heading("Price book") }),
    ).toBeDefined();
  });
});

describe("widening a connected source in its row", () => {
  it("opens on w with focus on the sensitivity", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    // Flushed, so the row is the one in focus before the key is read.
    act(() => {
      rowAction(row, ROW_ACTIONS.review, "Staff handbook").focus();
    });

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.widen.key });

    const panel = row.getByRole("group", {
      name: SENSITIVITY_PANEL_WORDS.widen.named("Staff handbook"),
    });
    expect(describedBy(panel)).toBe(SENSITIVITY_PANEL_WORDS.widen.consequence(false));
    expect(document.activeElement).toBe(
      within(panel).getByRole("combobox", { name: "Sensitivity" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("describes widening a published source by who it then reaches", async () => {
    const { widen } = SENSITIVITY_PANEL_WORDS;
    atSources({ listed: [{ ...HANDBOOK, state: "published", publishedAt: A_PUBLISH }] });
    const row = await rowOf("Staff handbook");

    fireEvent.click(rowAction(row, ROW_ACTIONS.widen, "Staff handbook"));

    expect(describedBy(row.getByRole("group"))).toBe(widen.consequence(true));
    expect(widen.consequence(true)).not.toBe(widen.consequence(false));
  });

  it("lists the one term that changes and names the result", async () => {
    atSources();
    const row = await rowOf("Staff handbook");

    fireEvent.click(rowAction(row, ROW_ACTIONS.widen, "Staff handbook"));

    const panel = within(row.getByRole("group"));
    expect(panel.getAllByRole("term").map((term) => term.textContent)).toEqual(["Sensitivity"]);
    expect(panel.getByRole("definition").textContent).toMatch(/Restricted.+Internal/v);
    expect(commitIn(panel)).toBeDefined();
  });

  it("closes on Cancel, focus back on its opener", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const widen = widenOpened(row);

    fireEvent.click(row.getByRole("button", { name: "Cancel" }));

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement).toBe(widen);
  });

  it("keeps its opener when w is pressed again", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const widen = widenOpened(row);
    const cancel = row.getByRole("button", { name: "Cancel" });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: SOURCES_KEYSTROKES.widen.key });
    expect(document.activeElement).toBe(row.getByRole("combobox", { name: "Sensitivity" }));
    fireEvent.click(cancel);

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement).toBe(widen);
  });

  it("keeps its opener when another change replaces the panel", async () => {
    atSources();
    const row = await rowOf("Price book");
    const narrow = rowAction(row, ROW_ACTIONS.narrow, "Price book");
    narrow.focus();
    fireEvent.click(narrow);
    const cancel = row.getByRole("button", { name: "Cancel" });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: SOURCES_KEYSTROKES.widen.key });
    expect(panelOf("widen", "Price book")).not.toBeNull();
    fireEvent.click(row.getByRole("button", { name: "Cancel" }));

    expect(panelOf("widen", "Price book")).toBeNull();
    expect(document.activeElement).toBe(narrow);
  });

  it("commits at once, focus on the source's heading", async () => {
    atSources({ held: Promise.withResolvers<void>().promise });
    const row = await rowOf("Staff handbook");
    widenOpened(row);

    fireEvent.click(commitIn(row));

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement).toBe(
      row.getByRole("heading", { level: 3, name: "Staff handbook" }),
    );
    expect(await row.findByText(WIDENED.sensitivity)).toBeDefined();
  });

  it("asks nothing of a commit pressed while one is pending", async () => {
    const answer = Promise.withResolvers<void>();
    const asked = atSources({ held: answer.promise });
    const row = await rowOf("Staff handbook");
    widenOpened(row);
    fireEvent.click(commitIn(row));
    await row.findByText(WIDENED.sensitivity);

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.widen.key });
    const second = commitIn(row);
    fireEvent.click(second);

    expect(second.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(second)).toBe(THE_CHANGE_BEFORE_IS_STILL_GOING);
    expect(panelOf("widen", "Staff handbook")).not.toBeNull();
    expect(asked.filter((name) => name === "sources.widen")).toHaveLength(1);

    answer.resolve();
    expect(
      await screen.findByText(new RegExp(sensitivityAndAudienceWords(WIDENED), "v")),
    ).toBeDefined();
  });
});

const widenTheHandbook = async () => {
  const row = await rowOf("Staff handbook");
  widenOpened(row);
  fireEvent.click(commitIn(row));
};

/** The price book's publish, opened from its row, every confirmation ticked, then sent. */
const publishThePriceBook = async () => {
  const row = await rowOf("Price book");
  fireEvent.click(rowAction(row, ROW_ACTIONS.publish, "Price book"));
  const dialog = within(await screen.findByRole("dialog"));
  for (const confirmation of dialog.getAllByRole("checkbox")) fireEvent.click(confirmation);
  fireEvent.click(dialog.getByRole("button", { name: "Publish" }));
};

const narrowThePriceBook = async () => {
  const row = await rowOf("Price book");
  fireEvent.click(rowAction(row, ROW_ACTIONS.narrow, "Price book"));
  fireEvent.click(row.getByRole("button", { name: SENSITIVITY_PANEL_WORDS.narrow.commit }));
};

const SENT_FROM_A_ROW = [
  { action: "widening", procedure: "sources.widen", send: widenTheHandbook },
  { action: "publish", procedure: "sources.publish", send: publishThePriceBook },
  { action: "narrowing", procedure: "sources.narrow", send: narrowThePriceBook },
];

/** Every status on the page that holds words, the list's count among them. */
const saidNow = (): readonly string[] =>
  screen
    .getAllByRole("status")
    .map((status) => status.textContent)
    .filter((words) => words !== "");

describe("a connected source's action in flight", () => {
  it.each(SENT_FROM_A_ROW)(
    "says the $action is pending until it lands",
    async ({ procedure, send }) => {
      const answer = Promise.withResolvers<void>();
      atSources({ held: answer.promise, forbidden: [procedure] });
      await rowOf("Price book");
      const before = saidNow();

      await send();

      expect(saidNow()).toHaveLength(before.length + 1);
      answer.resolve();
      await screen.findByText(STOCK.permission);
      expect(saidNow()).toEqual(before);
    },
  );
});

/** The same sentence said twice is announced once, so the alert stands empty between them. */
describe("a connected source's action refused twice", () => {
  it.each(SENT_FROM_A_ROW)(
    "empties the alert when a refused $action is sent again",
    async ({ procedure, send }) => {
      const api: SourcesApi = { forbidden: [procedure] };
      atSources(api);
      await send();
      const alert = await screen.findByText(STOCK.permission);
      expect(alert.getAttribute("role")).toBe("alert");

      const second = Promise.withResolvers<void>();
      api.held = second.promise;
      await send();

      expect(alert.textContent).toBe("");
      second.resolve();
      await waitFor(() => {
        expect(alert.textContent).toBe(STOCK.permission);
      });
    },
  );
});

describe("narrowing a connected source in its row", () => {
  it("offers a sensitivity alone and names the result", async () => {
    atSources();
    const row = await rowOf("Price book");

    fireEvent.click(rowAction(row, ROW_ACTIONS.narrow, "Price book"));

    const panel = within(
      row.getByRole("group", { name: SENSITIVITY_PANEL_WORDS.narrow.named("Price book") }),
    );
    expect(panel.getAllByRole("combobox")).toHaveLength(1);
    expect(panel.getAllByRole("term").map((term) => term.textContent)).toEqual(["Sensitivity"]);
    expect(panel.getByRole("definition").textContent).toMatch(/Internal.+Restricted/v);
    expect(
      panel.getByRole("button", { name: SENSITIVITY_PANEL_WORDS.narrow.commit }),
    ).toBeDefined();
  });

  it("takes the place of a panel open in another row", async () => {
    atSources();
    const handbook = await rowOf("Staff handbook");
    const priceBook = await rowOf("Price book");
    fireEvent.click(rowAction(handbook, ROW_ACTIONS.widen, "Staff handbook"));

    fireEvent.click(rowAction(priceBook, ROW_ACTIONS.narrow, "Price book"));

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });
});
