import { describe, expect, it } from "vitest";

import {
  briefReducer,
  CLOSED,
  hasUnsaved,
  isLocked,
  openedWith,
  placedIn,
  savedAs,
  type BriefEvent,
  type BriefState,
} from "@/features/knowledge/guides/brief-editing.ts";

const OPEN = openedWith(2, "Pallets are racked.", undefined);

const editing: BriefState = { stage: "editing", open: OPEN };

const saving: BriefState = { stage: "saving", open: OPEN };

const stale: BriefState = { stage: "stale", open: OPEN };

const after = (state: BriefState, ...events: readonly BriefEvent[]): BriefState =>
  events.reduce(briefReducer, state);

describe("the Brief editor's stages", () => {
  it("opens only from closed", () => {
    expect(after(CLOSED, { type: "open", open: OPEN })).toEqual(editing);
    expect(after(saving, { type: "open", open: OPEN })).toBe(saving);
  });

  it("keeps the draft as it is edited", () => {
    const edited = after(editing, { type: "edit", markdown: "Pallets are stacked." });

    expect(edited).toEqual({
      stage: "editing",
      open: { base: 2, original: "Pallets are racked.", markdown: "Pallets are stacked." },
    });
  });

  it("locks the text while saving and when stale", () => {
    expect(after(saving, { type: "edit", markdown: "More" })).toBe(saving);
    expect(after(stale, { type: "edit", markdown: "More" })).toBe(stale);
    expect([isLocked(editing), isLocked(saving), isLocked(stale)]).toEqual([false, true, true]);
  });

  it("saves only from editing", () => {
    expect(after(editing, { type: "save" })).toEqual(saving);
    expect(after(stale, { type: "save" })).toBe(stale);
    expect(after(CLOSED, { type: "save" })).toBe(CLOSED);
  });

  it("closes after a save that wrote a version", () => {
    expect(after(saving, { type: "saved", changed: true })).toBe(CLOSED);
  });

  it("stays open after a save that changed nothing", () => {
    expect(after(saving, { type: "saved", changed: false })).toEqual(editing);
  });

  it("answers a result only while saving", () => {
    expect(after(editing, { type: "saved", changed: true })).toBe(editing);
    expect(after(editing, { type: "stale" })).toBe(editing);
    expect(after(editing, { type: "refused" })).toBe(editing);
  });

  it("returns to editing when a save is refused", () => {
    expect(after(saving, { type: "refused" })).toEqual(editing);
  });

  it("keeps the draft when the save is stale", () => {
    const drafted = after(
      editing,
      { type: "edit", markdown: "Pallets are stacked." },
      { type: "save" },
      { type: "stale" },
    );

    expect(drafted).toEqual({
      stage: "stale",
      open: { base: 2, original: "Pallets are racked.", markdown: "Pallets are stacked." },
    });
  });

  it("reloads onto the latest version only from stale", () => {
    const latest = openedWith(3, "Pallets are binned.", undefined);

    expect(after(stale, { type: "reload", open: latest })).toEqual({
      stage: "editing",
      open: latest,
    });
    expect(after(editing, { type: "reload", open: latest })).toBe(editing);
  });

  it("keeps an unsaved draft beside the reloaded Brief", () => {
    const latest = openedWith(3, "Pallets are binned.", undefined);
    const drafted = after(
      editing,
      { type: "edit", markdown: "Pallets are stacked." },
      { type: "save" },
      { type: "stale" },
    );

    expect(after(drafted, { type: "reload", open: latest })).toStrictEqual({
      stage: "editing",
      open: { ...latest, earlier: "Pallets are stacked." },
    });
  });

  it("keeps no earlier draft when the draft was never changed", () => {
    const latest = openedWith(3, "Pallets are binned.", undefined);

    expect(after(stale, { type: "reload", open: latest })).toStrictEqual({
      stage: "editing",
      open: latest,
    });
  });

  it("keeps the earlier draft through a reload with nothing new", () => {
    const latest = openedWith(3, "Pallets are binned.", undefined);
    const reloaded = after(
      editing,
      { type: "edit", markdown: "Pallets are stacked." },
      { type: "save" },
      { type: "stale" },
      { type: "reload", open: latest },
      { type: "save" },
      { type: "stale" },
      { type: "reload", open: openedWith(4, "Pallets are stored.", undefined) },
    );

    expect(reloaded).toStrictEqual({
      stage: "editing",
      open: { ...openedWith(4, "Pallets are stored.", undefined), earlier: "Pallets are stacked." },
    });
  });

  it("drops the earlier draft on request, while editing or stale", () => {
    const latest = openedWith(3, "Pallets are binned.", undefined);
    const kept: BriefState = { stage: "editing", open: { ...latest, earlier: "Old words" } };
    const keptStale: BriefState = { stage: "stale", open: { ...latest, earlier: "Old words" } };

    expect(after(kept, { type: "discard" })).toStrictEqual({ stage: "editing", open: latest });
    expect(after(keptStale, { type: "discard" })).toStrictEqual({ stage: "stale", open: latest });
    expect(after(editing, { type: "discard" })).toBe(editing);
    expect(after({ stage: "saving", open: kept.open }, { type: "discard" })).toStrictEqual({
      stage: "saving",
      open: kept.open,
    });
  });

  it("does not close while saving", () => {
    expect(after(saving, { type: "close" })).toBe(saving);
    expect(after(editing, { type: "close" })).toBe(CLOSED);
    expect(after(stale, { type: "close" })).toBe(CLOSED);
  });
});

describe("the draft", () => {
  it("opens on a kept draft when there is one", () => {
    expect(
      openedWith(2, "Pallets are racked.", { markdown: "Kept words", earlier: undefined }),
    ).toStrictEqual({
      base: 2,
      original: "Pallets are racked.",
      markdown: "Kept words",
      earlier: undefined,
    });
  });

  it("opens on the earlier draft kept beside the Brief", () => {
    expect(
      openedWith(3, "Pallets are binned.", {
        markdown: "Pallets are binned.",
        earlier: "Old words",
      }),
    ).toStrictEqual({
      base: 3,
      original: "Pallets are binned.",
      markdown: "Pallets are binned.",
      earlier: "Old words",
    });
  });

  it("counts as unsaved only when it differs", () => {
    const edited = after(editing, { type: "edit", markdown: "Changed" });
    const restored = after(editing, { type: "edit", markdown: OPEN.original });

    expect([hasUnsaved(CLOSED), hasUnsaved(editing), hasUnsaved(edited)]).toEqual([
      false,
      false,
      true,
    ]);
    expect(hasUnsaved(restored)).toBe(false);
  });

  it("counts an earlier draft kept beside the Brief as unsaved", () => {
    const kept: BriefState = { stage: "editing", open: { ...OPEN, earlier: "Old words" } };

    expect(hasUnsaved(kept)).toBe(true);
    expect(hasUnsaved(after(kept, { type: "discard" }))).toBe(false);
  });

  it("saves against the version it opened with", () => {
    const edited = openedWith(2, "Pallets are racked.", {
      markdown: "Changed",
      earlier: undefined,
    });

    expect(savedAs("write-up", edited)).toEqual({
      writeUpId: "write-up",
      markdown: "Changed",
      base: 2,
    });
  });

  it("names the footnotes already placed in the draft", () => {
    const placed = placedIn(
      "Pallets[^a1] are racked[^b-2] by row[^a1]. A note[^c]: is one.\n\n[^d]: is not.",
    );

    expect([...placed]).toEqual(["a1", "b-2", "c"]);
  });
});
