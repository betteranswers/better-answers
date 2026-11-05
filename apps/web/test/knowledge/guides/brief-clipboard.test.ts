import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { copyBrief, copyingWords } from "@/features/knowledge/guides/brief-clipboard.ts";
import { GUIDE_WORDS } from "@/features/knowledge/guides/guide-words.ts";
import type { BriefCopied } from "@/features/knowledge/knowledge-api.ts";
import { clipboardTaking, partOf } from "@test/clipboard-stand-in.ts";
import { asksOf } from "@test/knowledge/concept-editing-answers.ts";
import {
  A_GUIDE_PAGE,
  A_WRITE_UP_ID,
  aBriefCopy,
  aGuide,
  aGuideApi,
  aSection,
  BRIEF_COPY,
  RECORD_COPY,
} from "@test/knowledge/guide-answers.ts";
import "@test/jsdom/layout.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { aRefusalAnswer, openAt, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

await import("@/features/knowledge/guides/brief-editor.tsx");

placedWithoutMeasuring();

const COPIED: BriefCopied = aBriefCopy();

const refusedClipboard = () => Promise.reject(new Error("NotAllowedError"));

describe("copying a Brief to the clipboard", () => {
  it("a refused clipboard records no usage", async () => {
    clipboardTaking(refusedClipboard);
    const record = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const copying = await copyBrief(() => Promise.resolve(COPIED), record);

    expect(copying).toEqual({ kind: "not-allowed" });
    expect(record).not.toHaveBeenCalled();
  });

  it("records the copied version once the write resolves", async () => {
    const order: string[] = [];
    clipboardTaking(() => {
      order.push("written");
      return Promise.resolve();
    });

    const copying = await copyBrief(
      () => Promise.resolve(COPIED),
      (copy) => {
        order.push(`recorded ${String(copy.version)}`);
        return Promise.resolve();
      },
    );

    expect(order).toEqual(["written", "recorded 2"]);
    expect(copying).toEqual({ kind: "copied", copy: COPIED, recorded: true });
  });

  it("writes the rich and the plain text of one read", async () => {
    const taken = clipboardTaking();
    const reading = vi.fn<() => Promise<BriefCopied>>(() => Promise.resolve(COPIED));

    await copyBrief(reading, () => Promise.resolve());

    expect(reading).toHaveBeenCalledOnce();
    expect(taken).toHaveLength(1);
    expect(await partOf(taken[0], "text/html")).toBe(COPIED.html);
    expect(await partOf(taken[0], "text/plain")).toBe(COPIED.text);
  });

  it("starts the write before the read answers", () => {
    const taken = clipboardTaking();

    void copyBrief(
      () => new Promise<BriefCopied>(() => undefined),
      () => Promise.resolve(),
    );

    expect(taken).toHaveLength(1);
  });

  it("surfaces a refused read and records nothing", async () => {
    clipboardTaking(refusedClipboard);
    const record = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const copying = copyBrief(() => Promise.reject(new Error("below-action-threshold")), record);

    await expect(copying).rejects.toThrow("below-action-threshold");
    expect(record).not.toHaveBeenCalled();
  });

  it("says a copy that was not recorded", async () => {
    clipboardTaking();

    const copying = await copyBrief(
      () => Promise.resolve(COPIED),
      () => Promise.reject(new Error("down")),
    );

    expect(copyingWords("3", copying)).toBe(
      "Copied section 3 with 1 footnote. Numbers start at 1 in each copy. The copy was not recorded.",
    );
  });
});

const openGuide = async (copy: "offered" | "below-action-threshold" = "offered") => {
  const api = aGuideApi("Editor", aGuide({ sections: [aSection({ copy })] }));
  api.set(BRIEF_COPY, () => read(COPIED));
  api.set(RECORD_COPY, () => read({ id: "01JUSAGE0000000000000000A" }));
  await openAt(A_GUIDE_PAGE, api);
  await screen.findByRole("heading", { level: 2, name: "Northgate Ltd" });
  return api;
};

const copyButton = () => screen.getByRole("button", { name: "Copy" });

describe("copying a section on the guide page", () => {
  it("announces the copy at once, then what was copied", async () => {
    const taken = clipboardTaking();
    await openGuide();

    fireEvent.click(copyButton());

    expect(screen.getByText("Copying section 1.")).toBeDefined();
    expect(
      await screen.findByText("Copied section 1 with 1 footnote. Numbers start at 1 in each copy."),
    ).toBeDefined();
    expect(await partOf(taken[0], "text/plain")).toBe(COPIED.text);
    expect(asksOf(RECORD_COPY)).toEqual([{ writeUpId: A_WRITE_UP_ID, version: 2 }]);
  });

  it("says a browser that refused, and records nothing", async () => {
    clipboardTaking(refusedClipboard);
    await openGuide();

    fireEvent.click(copyButton());

    expect(
      await screen.findByText("Your browser did not allow copying. Nothing was copied."),
    ).toBeDefined();
    expect(asksOf(RECORD_COPY)).toEqual([]);
  });

  it("copies on c for the section in focus", async () => {
    clipboardTaking();
    await openGuide();

    copyButton().focus();
    fireEvent.keyDown(copyButton(), { key: "c" });

    expect(await screen.findByText(/^Copied section 1 with 1 footnote/u)).toBeDefined();
  });

  it("says why instead of offering Copy below the role's threshold", async () => {
    await openGuide("below-action-threshold");

    const section = within(screen.getByRole("region", { name: "1. Warehouse racking" }));
    expect(section.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(section.getByText(/You can’t copy this section yet/u)).toBeDefined();
  });

  it("says in words a copy the server then refused", async () => {
    clipboardTaking();
    const api = await openGuide();
    api.set(BRIEF_COPY, () => aRefusalAnswer("below-action-threshold", "precondition", 412));

    fireEvent.click(copyButton());

    expect(await screen.findByText(/You can’t copy this section yet/u)).toBeDefined();
    expect(asksOf(RECORD_COPY)).toEqual([]);
  });

  it("asks to close an open editor before copying", async () => {
    clipboardTaking();
    await openGuide();
    fireEvent.click(screen.getByRole("button", { name: "Edit Brief" }));
    await screen.findByRole("textbox", { name: "Brief of section 1" });

    fireEvent.click(copyButton());

    expect(await screen.findByText(GUIDE_WORDS.closeToCopy)).toBeDefined();
    expect(asksOf(BRIEF_COPY)).toEqual([]);
  });

  it("says nothing is copyable where no Copy is drawn", async () => {
    await openGuide("below-action-threshold");

    const heading = screen.getByRole("heading", { name: "1. Warehouse racking" });
    heading.focus();
    fireEvent.keyDown(heading, { key: "c" });

    expect(await screen.findByText("Copy isn’t available for this section.")).toBeDefined();
  });
});
