import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PEOPLE_KEYSTROKES, PEOPLE_SELECT_FIRST } from "@/features/people/people-state.ts";
import { HOMES } from "@/shared/navigation.ts";
import { placedWithoutMeasuring } from "@test/measuring.ts";
import {
  actionBesideKey,
  addressField,
  addressOf,
  anInvitation,
  blurred,
  dialogClosed,
  focused,
  found,
  holdingInvitations,
  inviteAction,
  invitationRows,
  invitationsRegion,
  menuOf,
  openInvitations,
  openPeople,
  outcomeIn,
  pressedOn,
  rowsOf,
  shownUnder,
  statusChoice,
  tickOf,
} from "@test/people/invitations-stubbed.ts";
import { adaAnAdmin, adaAt, openAt, openTab } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

placedWithoutMeasuring();

const A_ROLE = { Editor: "an Editor", Viewer: "a Viewer" } as const;

const keystrokesButton = () => screen.getByRole("button", { name: "Keyboard Shortcuts" });

const keystrokesListed = () => {
  pressedOn("?");
  return screen.findByRole("dialog", { name: "Keyboard Shortcuts on Members" });
};

const inOrder = (...elements: readonly Element[]): boolean =>
  elements.every(
    (element, at) =>
      at === 0 ||
      elements[at - 1]?.compareDocumentPosition(element) === Node.DOCUMENT_POSITION_FOLLOWING,
  );

describe("the People page's Invitations tab", () => {
  it("each tab invites by keystroke, giving d its own action", async () => {
    const { api } = holdingInvitations([]);
    await openPeople(api, "Members");
    const besideTheSharedKey: string[] = [];

    for (const name of ["Members", "Invitations", "Requests"]) {
      openTab(name);
      await waitFor(() => {
        expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true");
      });
      expect(inviteAction()).toBeDefined();
      blurred();

      pressedOn(PEOPLE_KEYSTROKES.invite.key);
      await focused(addressField());
      pressedOn("Escape");
      await dialogClosed();
      await focused(inviteAction());

      const keystrokes = await keystrokesListed();
      const action = actionBesideKey(keystrokes, PEOPLE_KEYSTROKES.remove.key);
      expect(action, `${name} lists no action beside the key`).not.toBe("");
      besideTheSharedKey.push(action);
      pressedOn("Escape");
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      await focused(keystrokesButton());
    }

    expect(new Set(besideTheSharedKey).size, "two tabs list one action beside the shared key").toBe(
      3,
    );
  });

  it("an empty tab says so in one line, inviting once", async () => {
    const { api } = holdingInvitations([]);
    await openInvitations(api);
    await statusChoice("Waiting", 0);
    const inRegion = within(invitationsRegion());

    const heading = inRegion.getByRole("heading", { level: 2, name: "Invitations" });
    const search = inRegion.getByRole("searchbox", { name: "Search by address" });
    const statuses = inRegion.getByRole("radiogroup", { name: "Status" });
    const table = inRegion.getByRole("table");
    expect(inOrder(heading, search, statuses, table)).toBe(true);
    const expected = [
      ["Waiting 0", "true"],
      ["Accepted 0", "false"],
      ["Expired 0", "false"],
      ["Cancelled 0", "false"],
    ] as const;
    const choices = expected.map(([name]) => within(statuses).getByRole("radio", { name }));
    expect(inOrder(...choices)).toBe(true);
    expect(choices.map((choice) => choice.getAttribute("aria-checked"))).toEqual(
      expected.map(([, checked]) => checked),
    );
    const [head, body] = within(table).getAllByRole("rowgroup");
    const selectAll = within(within(found(head)).getByRole("row")).getByRole("columnheader", {
      name: "Select every invitation on this page",
    });
    expect(within(selectAll).getByRole("checkbox")).toHaveProperty("disabled", true);
    expect(within(within(found(body)).getByRole("row")).getByRole("cell").textContent).toMatch(
      /\S/,
    );
    expect(inRegion.getByRole("cell").textContent).toMatch(/\S/);
    expect(invitationRows()).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: /^invite/i }),
      "the head's action is the one way to invite",
    ).toHaveLength(1);
  });

  it("shows an eight-day-old invitation under Expired, not Waiting", async () => {
    const old = addressOf("old");
    const { api } = holdingInvitations([anInvitation("old", "expired")]);
    const router = await openInvitations(api);

    await statusChoice("Waiting", 0);
    await statusChoice("Expired", 1);
    expect(invitationRows()).toHaveLength(0);
    expect(within(invitationsRegion()).getByRole("cell").textContent).toMatch(/\S/);

    await shownUnder("Expired");
    await waitFor(() => {
      expect(rowsOf(old)).toHaveLength(1);
    });
    expect(router.state.location.href).toMatch(/invitations\.status=expired/);
  });

  it("clears a search that matched nothing, keeping its status", async () => {
    const lapsed = addressOf("lapsed");
    const { api } = holdingInvitations([anInvitation("lapsed", "expired")]);
    const router = await openInvitations(api);
    await shownUnder("Expired");
    await waitFor(() => {
      expect(rowsOf(lapsed)).toHaveLength(1);
    });
    const search = within(invitationsRegion()).getByRole("searchbox", {
      name: "Search by address",
    });

    const nobody = "nobody-at-this-address";
    fireEvent.change(search, { target: { value: nobody } });
    await waitFor(() => {
      expect(invitationRows()).toHaveLength(0);
    });
    expect(invitationsRegion().textContent, "the empty list names no search").toContain(nobody);
    const clear = within(invitationsRegion()).getByRole("button", { name: "Clear Search" });
    clear.focus();
    fireEvent.click(clear);

    await waitFor(() => {
      expect(rowsOf(lapsed)).toHaveLength(1);
    });
    expect(within(invitationsRegion()).getByRole("searchbox")).toHaveProperty("value", "");
    await focused(within(invitationsRegion()).getByRole("searchbox"));
    expect(
      within(invitationsRegion())
        .getByRole("radio", { name: /^Expired\b/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(router.state.location.href).toMatch(/invitations\.status=expired/);
  });

  it("accepted and cancelled invitations offer no tick and no actions", async () => {
    const [joined, dropped] = [addressOf("joined"), addressOf("dropped")];
    const { api } = holdingInvitations([
      anInvitation("joined", "accepted"),
      anInvitation("dropped", "cancelled"),
    ]);
    await openInvitations(api);

    await shownUnder("Accepted");
    await waitFor(() => {
      expect(rowsOf(joined)).toHaveLength(1);
    });
    expect(tickOf(joined)).toBeNull();
    expect(menuOf(joined)).toBeNull();
    await shownUnder("Cancelled");
    await waitFor(() => {
      expect(rowsOf(dropped)).toHaveLength(1);
    });
    expect(tickOf(dropped)).toBeNull();
    expect(menuOf(dropped)).toBeNull();
  });

  it("drops the select-first line once a key acts", async () => {
    const held = addressOf("held");
    const { api } = holdingInvitations([anInvitation("held")]);
    await openInvitations(api);
    await waitFor(() => {
      expect(rowsOf(held)).toHaveLength(1);
    });
    keystrokesButton().focus();

    pressedOn(PEOPLE_KEYSTROKES.tickInvitation.key);
    expect(outcomeIn()?.textContent, "x with no invitation in focus said nothing").toBe(
      PEOPLE_SELECT_FIRST.invitation,
    );

    tickOf(held)?.focus();
    pressedOn(PEOPLE_KEYSTROKES.tickInvitation.key);
    await waitFor(() => {
      expect(tickOf(held)?.getAttribute("aria-checked")).toBe("true");
    });
    expect(outcomeIn()?.textContent, "the select-first line outlived the tick").toBe("");
  });

  for (const role of ["Editor", "Viewer"] as const) {
    it(`shows ${A_ROLE[role]} no invitations, Members being hidden`, async () => {
      const api = adaAnAdmin();
      api.set("session.member", () => adaAt(role));

      await openAt(HOMES.Admin.path, api);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Page Not Found" }),
      ).toBeDefined();
      expect(screen.getByRole("link", { name: "Go to New Question" })).toBeDefined();
      expect(screen.queryByRole("tab", { name: "Invitations" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Invitations" })).toBeNull();
    });
  }
});
