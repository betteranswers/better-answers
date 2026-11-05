import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import { adaAnAdmin, changeTheTickedToViewer, GRACE, openAt } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

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

const refusalNamingGrace = () =>
  screen
    .queryAllByRole("alert")
    .find((alert) => within(alert).queryAllByRole("listitem").length > 0)
    ?.textContent.includes(GRACE.displayName) ?? false;

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

describe("a member's row that a bulk action refused", () => {
  it("marks the row and names the member in an alert", async () => {
    await graceRefused();

    expect(gracesCell().startsWith(UNMARKED), "the row lost the member's name").toBe(true);
    expect(refusalNamingGrace(), "no alert named the refused member").toBe(true);
  });

  it("clears the mark once another message replaces the refusal", async () => {
    await graceRefused();
    fireEvent.click(tickOfGrace());

    fireEvent.keyDown(document.body, { key: "C", shiftKey: true });

    await waitFor(() => {
      expect(gracesCell()).toBe(UNMARKED);
    });
    expect(refusalNamingGrace(), "the refusal stayed after another message").toBe(false);
  });
});
