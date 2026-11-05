import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeRefused } from "@/features/auth/auth-hooks.ts";
import { STALE_CONFIRMATION } from "@/features/auth/refusal-words.ts";
import {
  cancelTheRefusedAct,
  reconfirmAfter,
  useTheRefusedAct,
} from "@/features/auth/second-factor/reconfirm-dialog.tsx";
import { refusalSentence } from "@/shared/refusal-words.ts";
import { carrying } from "@test/stubbed-api.ts";

const stale = (): Error =>
  carrying({ refusal: { word: STALE_CONFIRMATION, class: "precondition" } });

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

describe("an action refused for an old confirmation", () => {
  it("opens the dialog only for that refusal with a retry", () => {
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

  it("opens for the same refusal from an auth route", () => {
    const refusedByARoute = new CodeRefused(412, undefined, undefined, STALE_CONFIRMATION);

    expect(reconfirmAfter(refusedByARoute, { retry: vi.fn<() => void>() })).toBe(true);
  });

  it("cancelling drops the action without running it", async () => {
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

  it("gives an old confirmation its own message", () => {
    expect(refusalSentence({}, STALE_CONFIRMATION, "precondition")).not.toBe(
      refusalSentence({}, "spending-limit-met", "precondition"),
    );
  });

  it("retries the refused action", async () => {
    const retry = vi.fn<() => void>();
    reconfirmAfter(stale(), { retry });
    const opened = render(<Probe />);

    act(() => {
      opened.getByRole("button", { name: "retry" }).click();
    });

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
