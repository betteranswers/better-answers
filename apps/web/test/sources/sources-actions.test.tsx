import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BoundFunctions, queries } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppClients, Providers } from "@/app/providers.tsx";
import { ConnectedSourcesPage } from "@/features/sources/connected-sources-page.tsx";
import { refusedFor } from "@/features/sources/refusal.tsx";
import { ReviewActions } from "@/features/sources/review-actions.tsx";
import type { GroupOfFindings } from "@/features/sources/sources-api.ts";
import { SOURCES_KEYSTROKES, useTickedGroups } from "@/features/sources/sources-state.ts";
import { ViewStateSlot } from "@/shared/page/page-toolbar.tsx";
import { addressOf, answered } from "@test/stubbed-api.ts";

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

const A_PASSPORT: GroupOfFindings = {
  ...BANK_DETAILS,
  category: "government-identifier",
  ruleId: "UK_PASSPORT",
};

function GroupTicker(properties: { readonly connectedSourceId: string }) {
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

const renderReviewActions = (connectedSourceId: string, tickedIn: string) =>
  render(
    <Providers clients={createAppClients()}>
      <ViewStateSlot>
        <GroupTicker connectedSourceId={tickedIn} />
        <ReviewActions connectedSourceId={connectedSourceId} />
      </ViewStateSlot>
    </Providers>,
  );

const action = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });

const KEEP = "Keep in Text";

const NARROW_DOCUMENTS = "Narrow These Documents";

const DISMISS = "Dismiss as Not Special Category";

const BULK_ACTIONS = [KEEP, NARROW_DOCUMENTS, DISMISS];

const describerOf = (control: HTMLElement): HTMLElement | null =>
  document.getElementById(control.getAttribute("aria-describedby") ?? "");

const describedBy = (control: HTMLElement): string | undefined => describerOf(control)?.textContent;

const bulkActionsState = () => {
  const hints = BULK_ACTIONS.map((label) => describerOf(action(label)));
  return {
    disabled: BULK_ACTIONS.map((label) => action(label).disabled),
    oneSharedHint: hints.every((hint) => hint !== null && hint === hints[0]),
    hintHasWords: /\S/v.test(hints[0]?.textContent ?? ""),
  };
};

const DISABLED_WITH_A_SELECT_FIRST_HINT = {
  disabled: [true, true, true],
  oneSharedHint: true,
  hintHasWords: true,
};

describe("the review's three bulk actions", () => {
  it("are disabled and share a hint to select first", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    expect(bulkActionsState()).toEqual(DISABLED_WITH_A_SELECT_FIRST_HINT);
  });

  it("enable once a group is ticked, and the hint goes", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    const hint = describerOf(action(KEEP));
    expect(hint?.textContent, "the actions have no hint saying to select a group").toMatch(/\S/v);

    fireEvent.click(action("Tick bank details"));

    expect(hint?.isConnected, "the select-first hint is still shown").toBe(false);
    const keep = action(KEEP);
    expect(keep.disabled).toBe(false);
    expect(keep.hasAttribute("aria-describedby")).toBe(false);
    expect(action(NARROW_DOCUMENTS).disabled).toBe(false);
  });

  it("count the ticked groups in the dialog's name", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick both"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    expect(screen.getByRole("dialog", { name: /\b2\b/v })).toBeDefined();
  });

  it("ignore groups ticked in another source's review", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, ANOTHER_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    expect(bulkActionsState()).toEqual(DISABLED_WITH_A_SELECT_FIRST_HINT);
  });

  it("list a ticked group by its rule's name", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick bank details"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    const listed = within(screen.getByRole("dialog")).getByRole("listitem");
    expect(listed.textContent).toContain("Sort code and account number");
    expect(listed.textContent).not.toContain(BANK_DETAILS.ruleId);
  });

  it("never list an unknown rule by its id", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the passport"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });

    const listed = within(screen.getByRole("dialog")).getByRole("listitem");
    expect(listed.textContent).not.toContain(A_PASSPORT.ruleId);
  });
});

describe("dismissing findings as not special category", () => {
  it("is enabled when only special category groups are ticked", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick the health cue"));

    const dismissal = action(DISMISS);
    expect(dismissal.disabled).toBe(false);
    expect(dismissal.hasAttribute("aria-describedby"), "the enabled action still has a hint").toBe(
      false,
    );
  });

  it("is disabled for a mixed selection and says why", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);

    fireEvent.click(action("Tick both"));

    const dismissal = action(DISMISS);
    expect(dismissal.disabled).toBe(true);
    expect(describedBy(dismissal), "the disabled action does not say why").toMatch(/\S/v);
    expect(action(KEEP).disabled).toBe(false);
  });

  it("opens on s, asking for a reason without showing ids", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick the health cue"));

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.dismiss.key });

    const dialog = screen.getByRole("dialog", {
      name: "Dismiss 1 Group of Findings as Not Special Category",
    });
    expect(dialog.textContent).toContain("Health wording");
    expect(dialog.textContent).toContain("Pump service notes");
    expect(screen.getByLabelText("Reason")).toBeDefined();
    expect(dialog.textContent).not.toMatch(/\b[0-9A-HJKMNP-TV-Z]{26}\b/);
  });

  it("words the api's refusal the same as the hint", () => {
    renderReviewActions(THE_CONNECTED_SOURCE, THE_CONNECTED_SOURCE);
    fireEvent.click(action("Tick both"));
    const hint = describedBy(action(DISMISS));
    cleanup();

    const { container } = render(<p>{refusedFor("not-special-category", "inapplicable").words}</p>);

    expect(container.textContent, "the api's refusal and the hint say different things").toBe(hint);
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
  held?: Promise<void>;
  readonly findings?: readonly GroupOfFindings[];

  readonly forbidden?: readonly string[];

  readonly listed?: readonly unknown[];
};

const atSources = (api: SourcesApi = {}) => {
  const asked: string[] = [];
  const answers: Readonly<Record<string, unknown>> = {
    ...ANSWERS,
    "sources.list": api.listed ?? ANSWERS["sources.list"],
    "sources.findings": api.findings ?? [],
  };
  const refusals = new Map<string, unknown>([["sources.keepInText", KEEP_REFUSED]]);
  for (const forbidden of api.forbidden ?? []) refusals.set(forbidden, ROLE_FORBIDS);
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

const ROW_ACTIONS = {
  review: "Review Findings",
  publish: "Publish",
  narrow: "Narrow Sensitivity",
  widen: "Widen Sensitivity or Audience",
};

/** jsdom drops the space a browser keeps before the visually hidden source name. */
const rowAction = (row: BoundFunctions<typeof queries>, label: string, name: string) =>
  row.getByRole("button", { name: new RegExp(`^${label} ?${name}$`, "v") });

const PANEL_NAMED = {
  narrow: (name: string) => `Narrow the Sensitivity of ${name}`,
  widen: (name: string) => `Widen the Sensitivity or Audience of ${name}`,
};

const panelOf = (change: "narrow" | "widen", name: string) =>
  screen.queryByRole("group", { name: PANEL_NAMED[change](name) });

const reviewOf = (name: string) => screen.queryByRole("region", { name: `Review of ${name}` });

const widenOpened = (row: BoundFunctions<typeof queries>): HTMLElement => {
  const widen = rowAction(row, ROW_ACTIONS.widen, "Staff handbook");
  widen.focus();
  fireEvent.click(widen);
  return widen;
};

const commitIn = (row: BoundFunctions<typeof queries>) =>
  row.getByRole("button", { name: "Widen" });

const BANK_DETAILS_CHECKBOX = {
  name: `Select bank details findings in ${BANK_DETAILS.title} found by the Sort code and account number rule`,
};

const messagesOutsideRows = () =>
  screen
    .getAllByRole("status")
    .filter((status) => status.closest("li") === null && /\S/v.test(status.textContent));

const startPendingKeep = async () => {
  const answer = Promise.withResolvers<void>();
  atSources({ held: answer.promise, findings: [BANK_DETAILS] });
  const row = await rowOf("Staff handbook");
  const messagesBefore = messagesOutsideRows().length;
  const review = rowAction(row, ROW_ACTIONS.review, "Staff handbook");
  fireEvent.click(review);
  fireEvent.click(await row.findByRole("checkbox", BANK_DETAILS_CHECKBOX));
  fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.keep.key });
  const reason = screen.getByLabelText("Reason");
  fireEvent.change(reason, { target: { value: "Printed on every invoice" } });
  fireEvent.submit(reason);
  await waitFor(() => {
    expect(review.getAttribute("aria-disabled")).toBe("true");
  });
  return { answer, row, review, messagesBefore };
};

const reviewState = (held: Awaited<ReturnType<typeof startPendingKeep>>) => ({
  handbook: reviewOf("Staff handbook") !== null,
  priceBook: reviewOf("Price book") !== null,
  saysToWait: messagesOutsideRows().length > held.messagesBefore,
});

const HANDBOOK_REVIEW_STILL_OPEN = { handbook: true, priceBook: false, saysToWait: true };

const shownAlerts = (scope: BoundFunctions<typeof queries>) =>
  scope.queryAllByRole("alert").filter((alert) => /\S/v.test(alert.textContent));

const expectKeepRefusedInItsReview = async (held: Awaited<ReturnType<typeof startPendingKeep>>) => {
  held.answer.resolve();
  await waitFor(() => {
    expect(shownAlerts(held.row), "the review shows no refusal").toHaveLength(1);
  });
  expect(held.row.getByRole("checkbox", BANK_DETAILS_CHECKBOX).getAttribute("aria-checked")).toBe(
    "true",
  );
  await waitFor(() => {
    expect(held.review.hasAttribute("aria-disabled")).toBe(false);
  });
};

describe("a connected source's row", () => {
  it("shows stored values as readable words", async () => {
    atSources();
    const row = await rowOf("Staff handbook");

    expect(row.getByText("Upload")).toBeDefined();
    expect(row.getByText("Received")).toBeDefined();
    expect(row.getByText("Restricted")).toBeDefined();
    expect(row.queryByText("upload")).toBeNull();
    expect(row.queryByText("received")).toBeNull();
  });

  it("labels each action with what it does and the source", async () => {
    atSources();
    const row = await rowOf("Price book");

    for (const label of Object.values(ROW_ACTIONS)) {
      expect(rowAction(row, label, "Price book")).toBeDefined();
    }
  });

  it("opens its review inside the row and focuses its heading", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const review = rowAction(row, ROW_ACTIONS.review, "Staff handbook");
    expect(review.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(review);

    const heading = row.getByRole("heading", {
      level: 4,
      name: "Review of Staff handbook",
    });
    expect(document.activeElement).toBe(heading);
    expect(row.getByRole("region", { name: "Review of Staff handbook" })).toBeDefined();
    expect(review.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes its review on a second press and keeps focus", async () => {
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

  it("keeps its review open while a keep is pending", async () => {
    const held = await startPendingKeep();

    fireEvent.click(held.review);

    expect(reviewState(held)).toEqual(HANDBOOK_REVIEW_STILL_OPEN);
    await expectKeepRefusedInItsReview(held);
  });

  it("ignores another row's Review button while a keep is pending", async () => {
    const held = await startPendingKeep();
    const theirs = rowAction(await rowOf("Price book"), ROW_ACTIONS.review, "Price book");

    fireEvent.click(theirs);

    expect(reviewState(held)).toEqual(HANDBOOK_REVIEW_STILL_OPEN);
    expect(theirs.getAttribute("aria-disabled")).toBe("true");
    await expectKeepRefusedInItsReview(held);
  });

  it("ignores r in another row while a keep is pending", async () => {
    const held = await startPendingKeep();
    const priceBook = await rowOf("Price book");
    act(() => {
      rowAction(priceBook, ROW_ACTIONS.review, "Price book").focus();
    });

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.review.key });

    expect(reviewState(held)).toEqual(HANDBOOK_REVIEW_STILL_OPEN);
    await expectKeepRefusedInItsReview(held);
  });

  it("closes one review when another opens", async () => {
    atSources();
    const handbook = await rowOf("Staff handbook");
    const priceBook = await rowOf("Price book");
    fireEvent.click(rowAction(handbook, ROW_ACTIONS.review, "Staff handbook"));

    fireEvent.click(rowAction(priceBook, ROW_ACTIONS.review, "Price book"));

    expect(reviewOf("Staff handbook")).toBeNull();
    expect(priceBook.getByRole("region", { name: "Review of Price book" })).toBeDefined();
  });
});

describe("widening a connected source in its row", () => {
  it("opens on w and focuses the Sensitivity field", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    act(() => {
      rowAction(row, ROW_ACTIONS.review, "Staff handbook").focus();
    });

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.widen.key });

    const panel = row.getByRole("group", {
      name: PANEL_NAMED.widen("Staff handbook"),
    });
    expect(describedBy(panel), "the panel does not say what widening does").toMatch(/\S/v);
    expect(document.activeElement).toBe(
      within(panel).getByRole("combobox", { name: "Sensitivity" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("describes widening differently once a source is published", async () => {
    atSources({
      listed: [{ ...HANDBOOK, state: "published", publishedAt: A_PUBLISH }, PRICE_BOOK],
    });
    const handbook = await rowOf("Staff handbook");
    const priceBook = await rowOf("Price book");

    fireEvent.click(rowAction(handbook, ROW_ACTIONS.widen, "Staff handbook"));
    const published = describedBy(handbook.getByRole("group"));
    fireEvent.click(rowAction(priceBook, ROW_ACTIONS.widen, "Price book"));
    const unpublished = describedBy(priceBook.getByRole("group"));

    expect(published, "the published source's panel says nothing").toMatch(/\S/v);
    expect(unpublished, "the unpublished source's panel says nothing").toMatch(/\S/v);
    expect(published, "both panels describe widening the same way").not.toBe(unpublished);
  });

  it("lists only the sensitivity change and offers Widen", async () => {
    atSources();
    const row = await rowOf("Staff handbook");

    fireEvent.click(rowAction(row, ROW_ACTIONS.widen, "Staff handbook"));

    const panel = within(row.getByRole("group"));
    expect(panel.getAllByRole("term").map((term) => term.textContent)).toEqual(["Sensitivity"]);
    expect(panel.getByRole("definition").textContent).toMatch(/Restricted.+Internal/v);
    expect(commitIn(panel)).toBeDefined();
  });

  it("closes on Cancel and returns focus to Widen", async () => {
    atSources();
    const row = await rowOf("Staff handbook");
    const widen = widenOpened(row);

    fireEvent.click(row.getByRole("button", { name: "Cancel" }));

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(document.activeElement).toBe(widen);
  });

  it("returns focus to Widen after w is pressed again", async () => {
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

  it("returns focus to Narrow after w replaces its panel", async () => {
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

  it("applies at once and focuses the source's heading", async () => {
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

  it("sends no second widening while the first is pending", async () => {
    const answer = Promise.withResolvers<void>();
    const asked = atSources({ held: answer.promise });
    const row = await rowOf("Staff handbook");
    const messagesBefore = messagesOutsideRows().map((status) => status.textContent);
    widenOpened(row);
    fireEvent.click(commitIn(row));
    await row.findByText(WIDENED.sensitivity);

    fireEvent.keyDown(document.body, { key: SOURCES_KEYSTROKES.widen.key });
    const second = commitIn(row);
    fireEvent.click(second);

    expect(second.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(second), "the disabled Widen does not say why").toMatch(/\S/v);
    expect(panelOf("widen", "Staff handbook")).not.toBeNull();
    expect(asked.filter((name) => name === "sources.widen")).toHaveLength(1);

    answer.resolve();
    await waitFor(() => {
      expect(messagesOutsideRows().map((status) => status.textContent)).toEqual([
        ...messagesBefore,
        expect.stringMatching(/Staff handbook\D+Internal/v),
      ]);
    });
  });
});

const widenTheHandbook = async () => {
  const row = await rowOf("Staff handbook");
  widenOpened(row);
  fireEvent.click(commitIn(row));
};

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
  fireEvent.click(row.getByRole("button", { name: "Narrow" }));
};

const ACTIONS_SENT_FROM_A_ROW = [
  { action: "widening", procedure: "sources.widen", send: widenTheHandbook },
  { action: "publish", procedure: "sources.publish", send: publishThePriceBook },
  { action: "narrowing", procedure: "sources.narrow", send: narrowThePriceBook },
];

const statusMessages = (): readonly string[] =>
  screen
    .getAllByRole("status")
    .map((status) => status.textContent)
    .filter((words) => words !== "");

describe("a pending connected source action", () => {
  it.each(ACTIONS_SENT_FROM_A_ROW)(
    "shows a pending message for $action until it answers",
    async ({ procedure, send }) => {
      const answer = Promise.withResolvers<void>();
      atSources({ held: answer.promise, forbidden: [procedure] });
      await rowOf("Price book");
      const before = statusMessages();

      await send();

      expect(statusMessages(), "no pending message appeared").toHaveLength(before.length + 1);
      answer.resolve();
      await waitFor(() => {
        expect(shownAlerts(screen), "the refusal is not shown").toHaveLength(1);
      });
      expect(statusMessages(), "the pending message stayed after the answer").toEqual(before);
    },
  );
});

describe("a connected source action refused twice", () => {
  it.each(ACTIONS_SENT_FROM_A_ROW)(
    "clears the alert when a refused $action is sent again",
    async ({ procedure, send }) => {
      const api: SourcesApi = { forbidden: [procedure] };
      atSources(api);
      await send();
      let alert: HTMLElement | undefined;
      await waitFor(() => {
        [alert] = shownAlerts(screen);
        expect(alert, "the first refusal is not shown").toBeDefined();
      });
      const refusal = alert?.textContent;

      const second = Promise.withResolvers<void>();
      api.held = second.promise;
      await send();

      expect(alert?.textContent, "the alert kept the first refusal while resending").toBe("");
      second.resolve();
      await waitFor(() => {
        expect(alert?.textContent, "the second refusal is not shown").toBe(refusal);
      });
    },
  );
});

describe("narrowing a connected source in its row", () => {
  it("offers only a sensitivity and shows the change", async () => {
    atSources();
    const row = await rowOf("Price book");

    fireEvent.click(rowAction(row, ROW_ACTIONS.narrow, "Price book"));

    const panel = within(row.getByRole("group", { name: PANEL_NAMED.narrow("Price book") }));
    expect(panel.getAllByRole("combobox")).toHaveLength(1);
    expect(panel.getAllByRole("term").map((term) => term.textContent)).toEqual(["Sensitivity"]);
    expect(panel.getByRole("definition").textContent).toMatch(/Internal.+Restricted/v);
    expect(panel.getByRole("button", { name: "Narrow" })).toBeDefined();
  });

  it("replaces a panel that is open in another row", async () => {
    atSources();
    const handbook = await rowOf("Staff handbook");
    const priceBook = await rowOf("Price book");
    fireEvent.click(rowAction(handbook, ROW_ACTIONS.widen, "Staff handbook"));

    fireEvent.click(rowAction(priceBook, ROW_ACTIONS.narrow, "Price book"));

    expect(panelOf("widen", "Staff handbook")).toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });
});
