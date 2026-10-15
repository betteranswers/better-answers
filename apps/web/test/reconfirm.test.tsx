import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeRefused } from "@/features/auth/auth-hooks.ts";
import {
  cancelTheRefusedAct,
  reconfirmAfter,
  useTheRefusedAct,
} from "@/features/auth/reconfirm-dialog.tsx";
import { STALE_CONFIRMATION } from "@/features/auth/refusal-words.ts";
import { refusalSentence } from "@/shared/refusal-words.ts";

import { carrying } from "./stubbed-api.ts";

const stale = (): Error =>
  carrying({ refusal: { word: STALE_CONFIRMATION, class: "precondition" } });

/** Reads the store the dialog reads, so a test asserts what the dialog would draw. */
function Probe() {
  const refused = useTheRefusedAct();
  return refused === undefined ? (
    <p>none refused</p>
  ) : (
    <button onClick={refused.retry}>retry</button>
  );
}

afterEach(() => {
  cleanup();
  cancelTheRefusedAct();
});

describe("a stale confirmation's refused act", () => {
  it("opens only for the stale word, with an act", () => {
    const retry = vi.fn<() => void>();

    expect(reconfirmAfter(stale(), { retry })).toBe(true);
    expect(reconfirmAfter(stale(), undefined)).toBe(false);
    expect(
      reconfirmAfter(carrying({ refusal: { word: "last-admin", class: "precondition" } }), {
        retry,
      }),
    ).toBe(false);
    expect(retry).not.toHaveBeenCalled();
  });

  it("opens for the word our own routes answer too", () => {
    const refusedByARoute = new CodeRefused(412, undefined, undefined, STALE_CONFIRMATION);

    expect(reconfirmAfter(refusedByARoute, { retry: vi.fn<() => void>() })).toBe(true);
  });

  it("keeps the act, and cancels it without running", async () => {
    const retry = vi.fn<() => void>();
    reconfirmAfter(stale(), { retry });
    const opened = render(<Probe />);
    expect(opened.getByRole("button", { name: "retry" })).toBeDefined();

    act(() => {
      cancelTheRefusedAct();
    });

    expect(opened.getByText("none refused")).toBeDefined();
    expect(retry).not.toHaveBeenCalled();
  });

  it("says one sentence wherever the act was refused", () => {
    expect(refusalSentence({}, STALE_CONFIRMATION, "precondition")).toBe(
      "It's been over an hour since you confirmed your second factor. Please confirm it again.",
    );
  });

  it("hands the refused act back to run again", async () => {
    const retry = vi.fn<() => void>();
    reconfirmAfter(stale(), { retry });
    const opened = render(<Probe />);

    act(() => {
      opened.getByRole("button", { name: "retry" }).click();
    });

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
