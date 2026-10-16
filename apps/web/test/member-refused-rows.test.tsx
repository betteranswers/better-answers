import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SAID_OF_TICKED_MEMBERS } from "@/features/people/refusal-words.ts";
import { HOMES } from "@/shared/navigation.ts";

import { placedWithoutMeasuring } from "./measuring.ts";
import { adaAnAdmin, changeTheTickedToViewer, GRACE, openAt } from "./two-workspaces.ts";

await vi.hoisted(() => import("./stub-server.ts"));

placedWithoutMeasuring();

const REFUSED_FOR_GRACE = {
  error: {
    message: "last-admin",
    code: -32_001,
    data: {
      code: "REFUSED",
      httpStatus: 412,
      refusal: {
        word: "last-admin",
        class: "precondition",
        items: { [GRACE.personId]: "last-admin" },
      },
    },
  },
};

const UNMARKED = `${GRACE.displayName}${GRACE.address}`;

const tickOfGrace = () => screen.getByRole("checkbox", { name: `Select ${GRACE.displayName}` });

const gracesCell = (): string =>
  screen.getByRole("link", { name: GRACE.displayName }).parentElement?.textContent ?? "";

const graceRefused = async () => {
  const api = adaAnAdmin();
  api.set("members.bulkChangeRole", () => REFUSED_FOR_GRACE);
  await openAt(HOMES.Admin.path, api);
  fireEvent.click(await screen.findByRole("checkbox", { name: `Select ${GRACE.displayName}` }));
  await changeTheTickedToViewer();
  await waitFor(() => {
    expect(gracesCell()).not.toBe(UNMARKED);
  });
};

describe("a member's row a bulk action refused", () => {
  it("holds the Refused pill and no reason", async () => {
    await graceRefused();

    expect(gracesCell()).toBe(`${UNMARKED}Refused`);
    expect(screen.getByRole("main").textContent).toContain(SAID_OF_TICKED_MEMBERS["last-admin"]);
  });

  it("loses the pill once another line replaces the refusal", async () => {
    await graceRefused();
    fireEvent.click(tickOfGrace());

    fireEvent.keyDown(document.body, { key: "C", shiftKey: true });

    await waitFor(() => {
      expect(gracesCell()).toBe(UNMARKED);
    });
    expect(screen.getByRole("main").textContent).not.toContain(
      SAID_OF_TICKED_MEMBERS["last-admin"],
    );
  });
});
