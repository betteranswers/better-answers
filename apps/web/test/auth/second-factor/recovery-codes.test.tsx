import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, assert, describe, expect, it } from "vitest";

import { RecoveryCodes } from "@/features/auth/second-factor/recovery-codes.tsx";
import { clipboardAnswering } from "@test/clipboard-stand-in.ts";

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

describe("the recovery codes section", () => {
  it("lists the ten codes", () => {
    drawn();

    const list = screen.getByRole("list", { name: "Recovery Codes" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(CODES);
  });

  it("Done without the checkbox shows an alert and focuses it", () => {
    let doneCalls = 0;
    drawn(() => {
      doneCalls += 1;
    });

    expect(doneButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(doneButton());

    expect(screen.getByRole("alert").textContent).toMatch(/\S/u);
    expect(document.activeElement).toBe(savedBox());
    expect(doneCalls).toBe(0);
  });

  it("Done reports the set's date once the checkbox is ticked", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Copy Codes" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/\S/u);
    });
    expect(written).toEqual([CODES.join("\n")]);
  });

  it("downloads the codes with the address and the date", () => {
    drawn();

    const download = screen.getByRole("link", { name: "Download" });
    const href = download.getAttribute("href");
    assert(href !== null, "the Download link has no href");
    const [kind, text = ""] = href.split(",", 2);

    expect(kind).toBe("data:text/plain;charset=utf-8");
    expect(download.getAttribute("download")).toBe("better-answers-recovery-codes.txt");
    const held = decodeURIComponent(text);
    expect(held).toContain(ADDRESS);
    expect(held).toContain("2 October 2026");
    expect(held.split("\n").filter((line) => CODES.includes(line))).toEqual(CODES);
  });
});
