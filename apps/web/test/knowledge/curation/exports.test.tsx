import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import { STALE_CONFIRMATION } from "@/features/auth/refusal-words.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { theOneEmptyStatus } from "@test/empty-status.ts";
import { downloadsWatched, type SavedFile } from "@test/knowledge/downloads.ts";
import { aGuideSummary, idOf } from "@test/knowledge/guide-answers.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { BOTH_HELD } from "@test/second-factor-api.ts";
import { server } from "@test/stub-server.ts";
import { holdProcedure, type Api } from "@test/stubbed-api.ts";
import { adaAnAdmin, adaAt, aRefusalAnswer, LOST, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const saved = downloadsWatched();

afterEach(() => {
  cleanup();
});

const PAGE = pageNamed(menuGroupIn(KNOWLEDGE, "curation"), "Exports").path;

const KNOWLEDGE_BASE = "Knowledge Base Snapshot";

const RECORDS = "Records";

const GUIDE = "Guide Snapshot";

const EXPORT_BUNDLE = "knowledge.exportBundle";

const EXPORT_RECORDS = "knowledge.exportRecords";

const EXPORT_GUIDE = "knowledge.exportGuide";

const ZIP_BYTES = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x80);

const KNOWLEDGE_BASE_ANSWER = {
  name: "knowledge-base-2026-11-05.zip",
  base64: Buffer.from(ZIP_BYTES).toString("base64"),
  files: 5,
  head: "a".repeat(40),
};

const RECORDS_ANSWER = {
  name: "records-2026-11-05.zip",
  base64: Buffer.from(ZIP_BYTES).toString("base64"),
  families: ["owners", "verifications", "usage"],
};

const GUIDE_ANSWER = {
  name: "guide-northgate-ltd-2026-11-05.md",
  markdown: "# Northgate Ltd\n\nGuide snapshot, 5 November 2026. Not maintained.\n",
  sections: 8,
};

const PAST_ITS_CEILING = {
  error: {
    message: "too many requests",
    code: -32_029,
    data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds: 61 },
  },
};

const OTHER_GUIDE = aGuideSummary({
  guideId: idOf(8),
  kind: "Tender pack",
  collection: "southgate",
  subject: null,
});

const anAdminOffering = (guides: readonly unknown[] = [aGuideSummary()]): Api => {
  const api = adaAnAdmin();
  api.set("knowledge.guides", () => read(guides));
  api.set(EXPORT_BUNDLE, () => read(KNOWLEDGE_BASE_ANSWER));
  api.set(EXPORT_RECORDS, () => read(RECORDS_ANSWER));
  api.set(EXPORT_GUIDE, () => read(GUIDE_ANSWER));
  return api;
};

const region = () => within(screen.getByRole("region", { name: "Exports", hidden: true }));

const buttonNamed = (verb: string, name: string) =>
  region().getByRole("button", { name: new RegExp(`^${verb}\\s?the ${name}$`, "u") });

const downloadOf = (name: string) => buttonNamed("Download", name);

const readyToDownload = async (name: string) => {
  const button = await waitFor(() => downloadOf(name));
  await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("false"));
  return button;
};

const whatTheAlertSays = (): string =>
  region()
    .getAllByRole("alert", { hidden: true })
    .map((alert) => alert.textContent)
    .join("");

const theCount = () => region().getAllByRole("status", { hidden: true })[0]?.textContent ?? "";

const theStatusEmptyOnArrival = () =>
  theOneEmptyStatus(region().getAllByRole("status", { hidden: true }));

const guideRow = () => region().getByRole("listitem", { name: GUIDE });

const asked = (procedure: string) => server.asks.filter((ask) => ask.procedure === procedure);

const theOneSaved = async (): Promise<SavedFile> => {
  await waitFor(() => expect(saved).toHaveLength(1));
  const [file] = saved;
  assert(file !== undefined, "no file was saved");
  return file;
};

const confirmedInTheDialog = async () => {
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(await within(dialog).findByRole("textbox", { name: "Authenticator Code" }), {
    target: { value: "123456" },
  });
};

describe("the Exports page", () => {
  it("lists three exports, each with its own download", async () => {
    await openAt(PAGE, anAdminOffering());

    await readyToDownload(GUIDE);
    expect(
      region()
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual([KNOWLEDGE_BASE, RECORDS, GUIDE]);
    expect(region().getAllByRole("listitem")).toHaveLength(3);
    expect(theCount()).toMatch(/^3\b/u);
    expect(downloadOf(KNOWLEDGE_BASE).getAttribute("aria-keyshortcuts")).toBe("k");
    expect(downloadOf(RECORDS).getAttribute("aria-keyshortcuts")).toBe("r");
    expect(downloadOf(GUIDE).getAttribute("aria-keyshortcuts")).toBe("g");
  });

  it("saves the knowledge base zip under the answer's name", async () => {
    await openAt(PAGE, anAdminOffering());
    const button = await readyToDownload(KNOWLEDGE_BASE);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.click(button);

    const file = await theOneSaved();
    expect(file.name).toBe(KNOWLEDGE_BASE_ANSWER.name);
    expect(file.type).toBe("application/zip");
    expect([...(await file.bytes())]).toEqual([...ZIP_BYTES]);
    expect(outcome.textContent, "the outcome does not name the saved file").toContain(file.name);
    expect(outcome.textContent, "the outcome does not count the files").toMatch(/\b5\b/u);
  });

  it("saves the records as a zip and counts its spreadsheets", async () => {
    await openAt(PAGE, anAdminOffering());
    const button = await readyToDownload(RECORDS);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.click(button);

    const file = await theOneSaved();
    expect(file.name).toBe(RECORDS_ANSWER.name);
    expect(file.type).toBe("application/zip");
    expect([...(await file.bytes())]).toEqual([...ZIP_BYTES]);
    expect(outcome.textContent, "the outcome does not name the saved file").toContain(file.name);
    expect(outcome.textContent, "the outcome does not count the spreadsheets").toMatch(/\b3\b/u);
  });

  it("saves the chosen guide as markdown under the answer's name", async () => {
    await openAt(PAGE, anAdminOffering([aGuideSummary(), OTHER_GUIDE]));

    const picker = await region().findByRole("combobox", { name: "Guide" });
    const outcome = theStatusEmptyOnArrival();
    expect(
      within(picker)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Northgate Ltd (Bid library)", "southgate (Tender pack)"]);
    fireEvent.change(picker, { target: { value: OTHER_GUIDE.guideId } });
    fireEvent.click(await readyToDownload(GUIDE));

    const file = await theOneSaved();
    expect(asked(EXPORT_GUIDE).map((ask) => ask.input)).toEqual([{ guideId: OTHER_GUIDE.guideId }]);
    expect(file.name).toBe(GUIDE_ANSWER.name);
    expect(file.type).toBe("text/markdown;charset=utf-8");
    expect(await file.text()).toBe(GUIDE_ANSWER.markdown);
    expect(outcome.textContent, "the outcome does not name the saved file").toContain(file.name);
    expect(outcome.textContent, "the outcome does not count the Briefs").toMatch(/\b8\b/u);
  });

  it("runs each download on its own key", async () => {
    await openAt(PAGE, anAdminOffering());
    await readyToDownload(GUIDE);

    fireEvent.keyDown(document.body, { key: "k" });
    await waitFor(() => expect(saved).toHaveLength(1));
    fireEvent.keyDown(document.body, { key: "r" });
    await waitFor(() => expect(saved).toHaveLength(2));
    fireEvent.keyDown(document.body, { key: "g" });
    await waitFor(() => expect(saved).toHaveLength(3));

    expect(saved.map((file) => file.name)).toEqual([
      KNOWLEDGE_BASE_ANSWER.name,
      RECORDS_ANSWER.name,
      GUIDE_ANSWER.name,
    ]);
  });

  it("does nothing on a second press while one export runs", async () => {
    const api = anAdminOffering();
    await openAt(PAGE, api);
    const running = holdProcedure(api, EXPORT_BUNDLE, read(KNOWLEDGE_BASE_ANSWER));
    const button = await readyToDownload(KNOWLEDGE_BASE);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.click(button);
    await running.asked;
    const preparing = await waitFor(() => buttonNamed("Preparing", KNOWLEDGE_BASE));
    expect(preparing.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(preparing);
    fireEvent.keyDown(document.body, { key: "k" });

    expect(downloadOf(RECORDS).getAttribute("aria-disabled")).toBe("false");
    expect(downloadOf(GUIDE).getAttribute("aria-disabled")).toBe("false");
    expect(outcome.textContent, "the status is silent while the export runs").toMatch(/\S/u);
    running.resolve();
    await theOneSaved();
    expect(running.asks).toBe(1);
    expect(asked(EXPORT_BUNDLE)).toHaveLength(1);
    await readyToDownload(KNOWLEDGE_BASE);
  });

  it("still saves the file when the person leaves the page", async () => {
    const api = anAdminOffering();
    const router = await openAt(PAGE, api);
    const running = holdProcedure(api, EXPORT_BUNDLE, read(KNOWLEDGE_BASE_ANSWER));

    fireEvent.click(await readyToDownload(KNOWLEDGE_BASE));
    await running.asked;
    await router.navigate({ to: "/knowledge/kinds" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/knowledge/kinds"));
    running.resolve();

    const file = await theOneSaved();
    expect(file.name).toBe(KNOWLEDGE_BASE_ANSWER.name);
  });

  it("offers no guide download when there are no guides", async () => {
    await openAt(PAGE, anAdminOffering([]));

    await waitFor(() =>
      expect(within(guideRow()).queryByRole("status"), "the guides are still loading").toBeNull(),
    );
    expect(
      within(guideRow()).queryByRole("alert"),
      "an empty guide list showed as a failure",
    ).toBeNull();
    expect(
      region()
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([`Download the ${KNOWLEDGE_BASE}`, `Download the ${RECORDS}`]);
    expect(region().queryByRole("combobox")).toBeNull();
    fireEvent.keyDown(document.body, { key: "g" });
    expect(asked(EXPORT_GUIDE)).toHaveLength(0);
  });

  it("retries a guide list that failed to load", async () => {
    const api = anAdminOffering();
    api.set("knowledge.guides", () => PAST_ITS_CEILING);
    await openAt(PAGE, api);

    await waitFor(() => expect(whatTheAlertSays()).toMatch(/\b2 minutes\b/u));
    api.set("knowledge.guides", () => read([aGuideSummary()]));
    fireEvent.click(region().getByRole("button", { name: "Retry" }));

    expect(await region().findByRole("combobox", { name: "Guide" })).toBeDefined();
    await readyToDownload(GUIDE);
  });

  it("never shows the word bundle", async () => {
    await openAt(PAGE, anAdminOffering());
    await readyToDownload(GUIDE);
    fireEvent.click(downloadOf(KNOWLEDGE_BASE));
    await theOneSaved();

    expect(screen.queryByText(/bundle/iu)).toBeNull();
    expect(screen.queryByLabelText(/bundle/iu)).toBeNull();
  });

  it("shows Page Not Found to an Editor", async () => {
    const api = anAdminOffering();
    api.set("session.member", () => adaAt("Editor"));
    await openAt(PAGE, api);

    expect(await screen.findByRole("heading", { level: 1, name: "Page Not Found" })).toBeDefined();
    expect(screen.queryByRole("region", { name: "Exports" })).toBeNull();
  });
});

describe("a refused export", () => {
  it.each([
    [
      "a changed role for the knowledge base",
      EXPORT_BUNDLE,
      KNOWLEDGE_BASE,
      "role-forbids",
      "forbidden",
    ],
    ["a changed role for the records", EXPORT_RECORDS, RECORDS, "role-forbids", "forbidden"],
    ["a changed role for the guide", EXPORT_GUIDE, GUIDE, "role-forbids", "forbidden"],
    [
      "a change still being saved",
      EXPORT_BUNDLE,
      KNOWLEDGE_BASE,
      "unrecorded-head",
      "precondition",
    ],
    [
      "a knowledge base with no saved version",
      EXPORT_BUNDLE,
      KNOWLEDGE_BASE,
      "not-found",
      "absent",
    ],
    [
      "a knowledge base too large",
      EXPORT_BUNDLE,
      KNOWLEDGE_BASE,
      "export-too-large",
      "inapplicable",
    ],
    ["records too large", EXPORT_RECORDS, RECORDS, "export-too-large", "inapplicable"],
    ["a guide that is gone", EXPORT_GUIDE, GUIDE, "not-found", "absent"],
  ])("alerts on %s", async (_cause, procedure, name, word, refusalClass) => {
    const api = anAdminOffering();
    api.set(procedure, () => aRefusalAnswer(word, refusalClass, 412));
    await openAt(PAGE, api);
    const button = await readyToDownload(name);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.click(button);

    await waitFor(() => expect(whatTheAlertSays(), "the refusal showed no alert").toMatch(/\S/u));
    expect(whatTheAlertSays()).not.toMatch(/bundle/iu);
    expect(saved).toHaveLength(0);
    expect(outcome.textContent, "the status still says the export is running").toBe("");
    await readyToDownload(name);
  });

  it("says how long to wait after too many requests", async () => {
    const api = anAdminOffering();
    api.set(EXPORT_RECORDS, () => PAST_ITS_CEILING);
    await openAt(PAGE, api);

    fireEvent.click(await readyToDownload(RECORDS));

    await waitFor(() => expect(whatTheAlertSays()).toMatch(/\b2 minutes\b/u));
    expect(saved).toHaveLength(0);
  });

  it("alerts on a failure that gives no reason", async () => {
    const api = anAdminOffering();
    api.set(EXPORT_GUIDE, () => LOST);
    await openAt(PAGE, api);

    fireEvent.click(await readyToDownload(GUIDE));

    await waitFor(() => expect(whatTheAlertSays(), "the failure showed no alert").toMatch(/\S/u));
    expect(saved).toHaveLength(0);
  });

  it("clears the refusal when the next export starts", async () => {
    const api = anAdminOffering();
    api.set(EXPORT_RECORDS, () => LOST);
    await openAt(PAGE, api);
    fireEvent.click(await readyToDownload(RECORDS));
    await waitFor(() => expect(whatTheAlertSays(), "the failure showed no alert").toMatch(/\S/u));

    fireEvent.click(downloadOf(KNOWLEDGE_BASE));

    await waitFor(() => expect(whatTheAlertSays()).toBe(""));
    await theOneSaved();
  });
});

describe("a stale confirmation before an export", () => {
  const staleOnce = (api: Api, procedure: string, answer: unknown) => {
    const answers = [() => aRefusalAnswer(STALE_CONFIRMATION, "precondition", 412), () => answer];
    api.set("person.secondFactor", () => read({ ...BOTH_HELD, passkeys: [] }));
    api.set("/second-factor/confirm/authenticator", () => ({ confirmed: true }));
    api.set(procedure, () => answers.shift()?.());
  };

  it.each([
    ["knowledge base", KNOWLEDGE_BASE, EXPORT_BUNDLE, KNOWLEDGE_BASE_ANSWER, "k"],
    ["records", RECORDS, EXPORT_RECORDS, RECORDS_ANSWER, "r"],
    ["guide", GUIDE, EXPORT_GUIDE, GUIDE_ANSWER, "g"],
  ])("saves the %s once, after the person confirms", async (_of, name, procedure, answer, key) => {
    const api = anAdminOffering();
    staleOnce(api, procedure, read(answer));
    await openAt(PAGE, api);
    await readyToDownload(name);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.keyDown(document.body, { key });
    await screen.findByRole("dialog");
    expect(saved, "saved before the person confirmed").toHaveLength(0);
    expect(whatTheAlertSays(), "the stale confirmation showed as a failure").toBe("");
    await confirmedInTheDialog();

    const file = await theOneSaved();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(file.name).toBe(answer.name);
    expect(asked(procedure)).toHaveLength(2);
    expect(whatTheAlertSays()).toBe("");
    expect(outcome.textContent, "the outcome does not name the saved file").toContain(answer.name);
    expect(document.activeElement, "focus was lost when the dialog closed").toBe(
      await readyToDownload(name),
    );
  });

  it("leaves the page quiet and ready when the person cancels", async () => {
    const api = anAdminOffering();
    staleOnce(api, EXPORT_BUNDLE, read(KNOWLEDGE_BASE_ANSWER));
    await openAt(PAGE, api);
    const button = await readyToDownload(KNOWLEDGE_BASE);
    const outcome = theStatusEmptyOnArrival();

    fireEvent.click(button);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saved).toHaveLength(0);
    expect(asked(EXPORT_BUNDLE)).toHaveLength(1);
    expect(whatTheAlertSays()).toBe("");
    expect(outcome.textContent, "the status still says the export is running").toBe("");
    await readyToDownload(KNOWLEDGE_BASE);
  });

  it("alerts on a refusal after the person confirms", async () => {
    const api = anAdminOffering();
    staleOnce(api, EXPORT_BUNDLE, aRefusalAnswer("unrecorded-head", "precondition", 412));
    await openAt(PAGE, api);

    fireEvent.click(await readyToDownload(KNOWLEDGE_BASE));
    await confirmedInTheDialog();

    await waitFor(() => expect(whatTheAlertSays(), "the refusal showed no alert").toMatch(/\S/u));
    expect(saved).toHaveLength(0);
  });
});
