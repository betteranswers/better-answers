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
import { sentenceOf } from "@/shared/refusal-words.ts";

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

const { why, next } = SAID_OF_A_CONNECTED_SOURCE["not-special-category"];

const NOT_SPECIAL_CATEGORY = `${why} ${next}`;

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

  it("name the ticked groups, and the enabling line goes", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick bank details"));

    expect(screen.queryByText(REVIEW_WORDS.selectFirst)).toBeNull();
    const keep = action(REVIEW_WORDS.keep.named(1));
    expect(keep.disabled).toBe(false);
    expect(keep.hasAttribute("aria-describedby")).toBe(false);
    expect(action("Narrow 1 document").disabled).toBe(false);
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

    expect(action(REVIEW_WORDS.dismiss.named(1)).disabled).toBe(false);
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
    expect(action(REVIEW_WORDS.keep.named(2)).disabled).toBe(false);
  });

  it("opens on s, asking a reason and naming no finding", () => {
    reviewing(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the health cue"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.dismiss.key });

    const dialog = screen.getByRole("dialog", { name: REVIEW_WORDS.dismiss.named(1) });
    expect(dialog.textContent).toContain(`${ruleWordOf(HEALTH_CUE.ruleId)} in Pump service notes`);
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

const WIDENED = { sensitivity: "Internal", audience: "groups" } as const;

const TO_PUBLIC = { sensitivity: "Public", audience: "groups" } as const;

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

const HELD: ReadonlySet<string> = new Set(["sources.widen", "sources.keepInText"]);

/** Reads are answered at once; a widening is taken and a keep refused once `held` lets them. */
const atSources = (
  api: { readonly held?: Promise<void>; readonly findings?: readonly GroupOfFindings[] } = {},
) => {
  const asked: string[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    ...ANSWERS,
    "sources.findings": api.findings ?? [],
  };
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const { pathname } = addressOf(input);
    if (!pathname.startsWith("/trpc/")) return answered({});
    const names = pathname.replace("/trpc/", "").split(",");
    asked.push(...names);
    if (names.some((name) => HELD.has(name))) await api.held;
    return answered(
      names.map((name) =>
        name === "sources.keepInText" ? KEEP_REFUSED : { result: { data: answers[name] } },
      ),
    );
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

const commitTo = (row: ReturnType<typeof within>, asked: typeof WIDENED | typeof TO_PUBLIC) =>
  row.getByRole("button", { name: SENSITIVITY_PANEL_WORDS.widen.commit("Staff handbook", asked) });

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
  expect(
    await held.row.findByText(sentenceOf(SAID_OF_A_CONNECTED_SOURCE["not-the-always-set"])),
  ).toBeDefined();
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

  it("lists the one term that changes and names the result", async () => {
    atSources();
    const row = await rowOf("Staff handbook");

    fireEvent.click(rowAction(row, ROW_ACTIONS.widen, "Staff handbook"));

    const panel = within(row.getByRole("group"));
    expect(panel.getAllByRole("term").map((term) => term.textContent)).toEqual(["Sensitivity"]);
    expect(panel.getByRole("definition").textContent).toMatch(/Restricted.+Internal/v);
    expect(commitTo(panel, WIDENED)).toBeDefined();
    expect(panel.queryByText(/audit row/iv)).toBeNull();
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

    fireEvent.click(commitTo(row, WIDENED));

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
    fireEvent.click(commitTo(row, WIDENED));
    await row.findByText(WIDENED.sensitivity);

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.widen.key });
    const second = commitTo(row, TO_PUBLIC);
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
    expect(
      panel.getByRole("button", {
        name: SENSITIVITY_PANEL_WORDS.narrow.commit("Price book", {
          sensitivity: "Restricted",
          audience: "everyone",
        }),
      }),
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
