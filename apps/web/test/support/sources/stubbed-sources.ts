import { fireEvent, screen, within } from "@testing-library/react";

import type { GroupOfFindings, ListedConnectedSource } from "@/features/sources/sources-api.ts";
import { CONTROL_CENTRE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import type { Api } from "@test/stubbed-api.ts";
import { adaAnAdmin, openAt, read } from "@test/two-workspaces.ts";

const CONNECTED_SOURCES = pageNamed(
  menuGroupIn(CONTROL_CENTRE, "sources"),
  "Connected Sources",
).path;

let minted = 0;

/** The api's ids are 26-character ulids, so a page that drew one would show it. */
export const anId = (): string => {
  minted += 1;
  return `01K5T${String(minted).padStart(21, "0")}`;
};

type Sync = NonNullable<ListedConnectedSource["lastSync"]>;

/** A connected source as it crosses the wire, where the api's branded ids are plain strings. */
type AConnectedSource = {
  readonly connectedSourceId: string;
  readonly name: string;
  readonly connector: ListedConnectedSource["connector"];
  readonly sensitivity: ListedConnectedSource["sensitivity"];
  readonly audience: ListedConnectedSource["audience"];
  readonly audienceGroups: readonly string[] | null;
  readonly destination: ListedConnectedSource["destination"];
  readonly retentionClass: ListedConnectedSource["retentionClass"];
  readonly state: ListedConnectedSource["state"];
  readonly publishedAt: string | null;
  readonly documentCount: number;
  readonly passageCount: number;
  readonly lastSync: {
    readonly jobId: string;
    readonly kind: Sync["kind"];
    readonly reason: Sync["reason"];
    readonly status: Sync["status"];
    readonly attempts: number;
    readonly enqueuedAt: string;
    readonly finishedAt: string | null;
  } | null;
  readonly unreadable: readonly {
    readonly documentId: string;
    readonly title: string;
    readonly reason: string;
  }[];
  readonly unreadableByReason: Readonly<Record<string, number>>;
};

type AGroupOfFindings = {
  readonly documentId: string;
  readonly title: string;
  readonly sensitivity: GroupOfFindings["sensitivity"];
  readonly category: GroupOfFindings["category"];
  readonly ruleId: string;
  readonly tier: GroupOfFindings["tier"];
  readonly specialCategory: boolean;
  readonly found: number;
  readonly overriddenByErasure: number;
  readonly dismissed: number;
};

export const aConnectedSource = (
  name: string,
  overrides: Partial<AConnectedSource> = {},
): AConnectedSource => ({
  connectedSourceId: anId(),
  name,
  connector: "upload",
  sensitivity: "Internal",
  audience: "everyone",
  audienceGroups: null,
  destination: ["passage-index", "bundle"],
  retentionClass: "keep",
  state: "indexed",
  publishedAt: null,
  documentCount: 1,
  passageCount: 0,
  lastSync: {
    jobId: anId(),
    kind: "index",
    reason: null,
    status: "done",
    attempts: 1,
    enqueuedAt: "2026-10-07T09:00:00.000Z",
    finishedAt: "2026-10-07T09:05:00.000Z",
  },
  unreadable: [],
  unreadableByReason: {},
  ...overrides,
});

export const aGroupOfFindings = (overrides: Partial<AGroupOfFindings> = {}): AGroupOfFindings => ({
  documentId: anId(),
  title: "Supplier form",
  sensitivity: "Internal",
  category: "bank-details",
  ruleId: "UK_BANK_ACCOUNT",
  tier: "always",
  specialCategory: false,
  found: 2,
  overriddenByErasure: 0,
  dismissed: 0,
  ...overrides,
});

export const BANK_ACCOUNT_BOX =
  "Select bank details by Sort code and account number in Supplier form";

export const supplierFormsFindings = (): readonly AGroupOfFindings[] => {
  const form = anId();
  return [
    aGroupOfFindings({ documentId: form }),
    aGroupOfFindings({
      documentId: form,
      category: "home-address",
      ruleId: "UK_HOME_ADDRESS",
      tier: "default-on",
      found: 1,
    }),
    aGroupOfFindings({
      title: "Staff survey",
      sensitivity: "Restricted",
      category: "special-category",
      ruleId: "HEALTH_CUE",
      specialCategory: true,
      found: 1,
    }),
  ];
};

export const anAdminWith = (...sources: readonly AConnectedSource[]): Api => {
  const api = adaAnAdmin();
  api.set("sources.list", () => read(sources));
  return api;
};

export const openSources = (api: Api) => openAt(CONNECTED_SOURCES, api);

export const connectedSourcesRegion = (): HTMLElement =>
  screen.getByRole("region", { name: "Connected Sources" });

/** The line a settled action leaves is the last status the region holds. */
export const saidIn = (): HTMLElement | undefined =>
  within(connectedSourcesRegion()).getAllByRole("status").at(-1);

export const rowOf = (name: string): Promise<HTMLElement> =>
  screen.findByRole("listitem", { name });

const ROW_ACTIONS = {
  review: "Review Findings",
  publish: "Publish",
  narrow: "Narrow Sensitivity",
  widen: "Widen Sensitivity or Audience",
} as const;

/** jsdom's accessible name drops the space a browser keeps before the hidden source's name. */
export const rowAction = (row: HTMLElement, action: keyof typeof ROW_ACTIONS): HTMLElement =>
  within(row).getByRole("button", { name: new RegExp(`^${ROW_ACTIONS[action]} ?`, "v") });

export const moreDetailsOf = (row: HTMLElement): HTMLElement =>
  within(row).getByRole("button", { name: /^More Details ?/v });

export const reviewOf = (name: string): HTMLElement | null =>
  screen.queryByRole("region", { name: `Review of ${name}` });

export const panelOf = (change: "narrow" | "widen", name: string): HTMLElement | null =>
  screen.queryByRole("group", {
    name:
      change === "narrow"
        ? `Narrow the Sensitivity of ${name}`
        : `Widen the Sensitivity or Audience of ${name}`,
  });

export const thePanelOf = (change: "narrow" | "widen", name: string): HTMLElement => {
  const panel = panelOf(change, name);
  if (panel === null) throw new Error(`no ${change} panel is open on ${name}`);
  return panel;
};

/** What a browser does when a pointer presses a button: the button takes focus, then it acts. */
export const pressed = (button: HTMLElement): void => {
  button.focus();
  fireEvent.click(button);
};

/** A key goes to the element in focus, and the page hears it as the document does. */
export const press = (key: string): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

export const describerOf = (control: HTMLElement): HTMLElement | null => {
  const id = control.getAttribute("aria-describedby");
  return id === null ? null : document.getElementById(id);
};

export const describedBy = (control: HTMLElement): string =>
  describerOf(control)?.textContent ?? "";

const definitionOf = (terms: readonly HTMLElement[], word: string): HTMLElement => {
  const definition = terms.find((each) => each.textContent === word)?.nextElementSibling;
  if (!(definition instanceof HTMLElement)) throw new Error(`no definition follows ${word}`);
  return definition;
};

/** The row's own lead, drawn before More Details opens. */
export const leadOf = (row: HTMLElement, word: string): HTMLElement =>
  definitionOf(within(row).getAllByRole("term"), word);

/** A term More Details repeats is read from its last place. */
export const detailOf = (row: HTMLElement, word: string): HTMLElement =>
  definitionOf(within(row).getAllByRole("term").toReversed(), word);
