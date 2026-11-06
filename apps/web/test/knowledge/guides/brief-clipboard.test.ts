import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { copyBrief, copyingWords } from "@/features/knowledge/guides/brief-clipboard.ts";
import type { BriefCopied } from "@/features/knowledge/knowledge-api.ts";
import { clipboardTaking, partOf } from "@test/clipboard-stand-in.ts";
import { asksOf } from "@test/knowledge/concept-editing-answers.ts";
import {
  A_GUIDE_PAGE,
  A_WRITE_UP_ID,
  aBrief,
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

  it("words an unrecorded copy apart from a recorded one", async () => {
    clipboardTaking();

    const copying = await copyBrief(
      () => Promise.resolve(COPIED),
      () => Promise.reject(new Error("down")),
    );

    expect(copying).toEqual({ kind: "copied", copy: COPIED, recorded: false });
    expect(copyingWords("3", copying)).not.toBe(
      copyingWords("3", { kind: "copied", copy: COPIED, recorded: true }),
    );
  });
});

const openGuide = async (
  copy: "offered" | "below-action-threshold" = "offered",
  markdown?: string,
) => {
  const brief =
    markdown === undefined ? aBrief() : aBrief({ rendered: { markdown, footnotes: [] } });
  const api = aGuideApi("Editor", aGuide({ sections: [aSection({ copy, brief })] }));
  api.set(BRIEF_COPY, () => read(COPIED));
  api.set(RECORD_COPY, () => read({ id: "01JUSAGE0000000000000000A" }));
  await openAt(A_GUIDE_PAGE, api);
  await screen.findByRole("heading", { level: 2, name: "Northgate Ltd" });
  return api;
};

const copyButton = () => screen.getByRole("button", { name: "Copy" });

const pressCOnTheFirstSection = () => {
  const heading = screen.getByRole("heading", { name: "1. Warehouse racking" });
  heading.focus();
  fireEvent.keyDown(heading, { key: "c" });
};

const status = () => within(screen.getByRole("article")).getByRole("status");

const alert = () => within(screen.getByRole("article")).getByRole("alert");

const saysSomethingNew = async (before: string) => {
  await waitFor(() => {
    expect(status().textContent, "the status did not change").not.toBe(before);
  });
  expect(status().textContent).toMatch(/\S/u);
};

describe("copying a section on the guide page", () => {
  it("announces the copy at once, then what was copied", async () => {
    const taken = clipboardTaking();
    await openGuide();

    fireEvent.click(copyButton());

    const whileCopying = status().textContent;
    expect(whileCopying, "the copy was not announced at once").toMatch(/\S/u);
    await saysSomethingNew(whileCopying);
    expect(await partOf(taken[0], "text/plain")).toBe(COPIED.text);
    expect(asksOf(RECORD_COPY)).toEqual([{ writeUpId: A_WRITE_UP_ID, version: 2 }]);
  });

  it("announces a refused clipboard and records nothing", async () => {
    clipboardTaking(refusedClipboard);
    await openGuide();

    fireEvent.click(copyButton());

    await saysSomethingNew(status().textContent);
    await waitFor(() => {
      expect(copyButton().getAttribute("aria-disabled")).not.toBe("true");
    });
    expect(asksOf(RECORD_COPY)).toEqual([]);
  });

  it("copies on c for the section in focus", async () => {
    clipboardTaking();
    await openGuide();

    copyButton().focus();
    fireEvent.keyDown(copyButton(), { key: "c" });

    await waitFor(() => {
      expect(asksOf(RECORD_COPY)).toEqual([{ writeUpId: A_WRITE_UP_ID, version: 2 }]);
    });
  });

  it("offers no Copy below the role's threshold", async () => {
    await openGuide("below-action-threshold");

    const section = within(screen.getByRole("region", { name: "1. Warehouse racking" }));
    expect(section.queryByRole("button", { name: "Copy" })).toBeNull();
    expect(section.getByRole("button", { name: "Show Detail" })).toBeDefined();
  });

  it("alerts when the server refuses the copy", async () => {
    clipboardTaking();
    const api = await openGuide();
    api.set(BRIEF_COPY, () => aRefusalAnswer("below-action-threshold", "precondition", 412));

    fireEvent.click(copyButton());

    await waitFor(() => {
      expect(alert().textContent, "the refused copy raised no alert").toMatch(/\S/u);
    });
    expect(asksOf(RECORD_COPY)).toEqual([]);
  });

  it("asks to close an open editor before copying", async () => {
    clipboardTaking();
    await openGuide();
    fireEvent.click(screen.getByRole("button", { name: "Edit Brief" }));
    await screen.findByRole("textbox", { name: "Brief of section 1" });

    fireEvent.click(copyButton());

    await waitFor(() => {
      expect(status().textContent, "Copy with the editor open said nothing").toMatch(/\S/u);
    });
    expect(asksOf(BRIEF_COPY)).toEqual([]);
    expect(screen.getByRole("textbox", { name: "Brief of section 1" })).toBeDefined();
  });

  it("says why c copies nothing below the role's threshold", async () => {
    await openGuide("below-action-threshold");

    pressCOnTheFirstSection();

    await waitFor(() => {
      expect(status().textContent).toBe(
        "You can’t copy this section yet. Some of its concepts aren’t verified enough for your role.",
      );
    });
    expect(asksOf(BRIEF_COPY)).toEqual([]);
  });

  it("says c has nothing to copy in an empty Brief", async () => {
    await openGuide("offered", "");

    pressCOnTheFirstSection();

    await waitFor(() => {
      expect(status().textContent).toBe("Copy isn’t available for this section.");
    });
    expect(asksOf(BRIEF_COPY)).toEqual([]);
  });
});
