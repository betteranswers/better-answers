import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecoveryCodes } from "@/features/auth/recovery-codes.tsx";
import { CODES_NOT_TICKED } from "@/features/auth/refusal-words.ts";
import { sentenceOf } from "@/shared/refusal-words.ts";

import { clipboardAnswering } from "./clipboard-stand-in.ts";

afterEach(cleanup);

const CODES = [
  "abcd-efgh-jkmn-pqrs",
  "tvwx-yz01-2345-6789",
  "a1b2-c3d4-e5f6-g7h8",
  "j9k0-m1n2-p3q4-r5s6",
  "t7v8-w9x0-y1z2-a3b4",
  "c5d6-e7f8-g9h0-j1k2",
  "m3n4-p5q6-r7s8-t9v0",
  "w1x2-y3z4-a5b6-c7d8",
  "e9f0-g1h2-j3k4-m5n6",
  "p7q8-r9s0-t1v2-w3x4",
];

const ADDRESS = "ada@example.test";

/** Mid-morning in UTC, so it is 2 October in UTC and every European zone. */
const MADE_AT = "2026-10-02T09:41:00.000Z";

const drawn = (onDone: (madeAt: string) => void = () => {}) =>
  render(
    <RecoveryCodes
      inHand={{ codes: CODES, replacing: false, madeAt: MADE_AT }}
      address={ADDRESS}
      acknowledging={false}
      failure={undefined}
      onDone={onDone}
    />,
  );

const doneButton = () => screen.getByRole("button", { name: "Done" });

const savedBox = () => screen.getByRole("checkbox", { name: "I have saved these codes" });

describe("the recovery codes block", () => {
  it("reads as a list of the ten codes", () => {
    drawn();

    const list = screen.getByRole("list", { name: "Recovery codes" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(CODES);
  });

  it("refuses an unticked Done and moves focus to the box", () => {
    let doneCalls = 0;
    drawn(() => {
      doneCalls += 1;
    });

    expect(doneButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(doneButton());

    expect(screen.getByRole("alert").textContent).toBe(sentenceOf(CODES_NOT_TICKED));
    expect(document.activeElement).toBe(savedBox());
    expect(doneCalls).toBe(0);
  });

  it("finishes once the box is ticked, naming the set shown", () => {
    const done: string[] = [];
    drawn((madeAt) => {
      done.push(madeAt);
    });

    fireEvent.click(savedBox());
    expect(doneButton().getAttribute("aria-disabled")).toBe("false");
    fireEvent.click(doneButton());

    expect(done).toEqual(["2026-10-02T09:41:00.000Z"]);
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("copies the ten codes, one per line", async () => {
    const written = clipboardAnswering(() => Promise.resolve());
    drawn();

    fireEvent.click(screen.getByRole("button", { name: "Copy codes" }));

    expect(await screen.findByText("Codes copied.")).toBeDefined();
    expect(written).toEqual([CODES.join("\n")]);
  });

  it("downloads the codes with the address and the day made", () => {
    drawn();

    const download = screen.getByRole("link", { name: "Download" });
    const href = download.getAttribute("href") ?? "";
    const [kind, text = ""] = href.split(",", 2);

    expect(kind).toBe("data:text/plain;charset=utf-8");
    expect(download.getAttribute("download")).toBe("better-answers-recovery-codes.txt");
    expect(decodeURIComponent(text)).toBe(
      [
        "better-answers recovery codes for ada@example.test",
        "Made 2 October 2026",
        "",
        ...CODES,
        "",
        "Each code signs you in once.",
        "",
      ].join("\n"),
    );
  });
});
