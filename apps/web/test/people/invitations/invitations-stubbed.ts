import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { z } from "zod";

import { INVITATION_STATUSES } from "@/features/people/invitations/invitations-address.ts";
import type {
  InvitationStatus,
  ListedInvitation,
  SentInvitation,
} from "@/features/people/invitations/invitations-api.ts";
import { HOMES } from "@/shared/navigation.ts";
import { server } from "@test/stub-server.ts";
import type { Api } from "@test/stubbed-api.ts";
import { ADA, adaAnAdmin, openAt, openTab, read } from "@test/two-workspaces.ts";

export const PRIYA = {
  ...ADA,
  personId: "01JPRIYA00000000000000000A",
  displayName: "Priya Shah",
  address: "priya@example.test",
  role: "Editor",
};

const WAITING_UNTIL = "2026-11-05T09:00:00.000Z";

const LAPSED_ON = "2026-10-21T09:00:00.000Z";

export const addressOf = (who: string): string => `${who}@example.test`;

export const anInvitation = (
  who: string,
  status: InvitationStatus = "waiting",
): ListedInvitation => ({
  invitationId: `invitation-${who}`,
  address: addressOf(who),
  role: "Viewer",
  status,
  invitedAt: "2026-10-14T09:00:00.000Z",
  expiresAt: status === "expired" ? LAPSED_ON : WAITING_UNTIL,
  invitedBy: ADA.displayName,
});

const sentOf = (invitation: ListedInvitation, emailSent: boolean): SentInvitation => ({
  invitationId: invitation.invitationId,
  address: invitation.address,
  role: invitation.role,
  invitedAt: invitation.invitedAt,
  expiresAt: WAITING_UNTIL,
  emailSent,
});

const askedOf = (procedure: string): unknown =>
  server.asks.findLast((ask) => ask.procedure === procedure)?.input;

export const asksOf = (procedure: string): readonly unknown[] =>
  server.asks.filter((ask) => ask.procedure === procedure).map((ask) => ask.input);

const STATUS_ASKED = z.object({ status: z.enum(INVITATION_STATUSES) });

const INVITE_ASKED = z.object({ addresses: z.array(z.string()), role: z.string() });

const ONE_ASKED = z.object({ invitationId: z.string() });

const SET_ASKED = z.object({ invitationIds: z.array(z.string()) });

export const holdingInvitations = (
  rows: readonly ListedInvitation[],
  unreachable: readonly string[] = [],
) => {
  const held = [...rows];
  const down = new Set(unreachable);
  const api: Api = adaAnAdmin();
  let reads = 0;

  const moveTo = (invitationId: string, status: InvitationStatus) => {
    const at = held.findIndex((row) => row.invitationId === invitationId);
    const row = held[at];
    if (row !== undefined) held[at] = { ...row, status, expiresAt: WAITING_UNTIL };
    return row;
  };

  const resent = (invitationId: string): SentInvitation | undefined => {
    const row = moveTo(invitationId, "waiting");
    return row === undefined ? undefined : sentOf(row, !down.has(row.address));
  };

  const cancelledOnce = (invitationId: string): boolean => {
    const row = held.find((each) => each.invitationId === invitationId);
    if (row === undefined || row.status === "cancelled") return false;
    moveTo(invitationId, "cancelled");
    return true;
  };

  api.set("members.list", () => read([ADA, PRIYA]));
  api.set("members.requests", () => read([]));
  api.set("members.invitations", () => {
    const asked = server.asks.filter(({ procedure }) => procedure === "members.invitations")[reads];
    reads += 1;
    const { status } = STATUS_ASKED.parse(asked?.input);
    return read(held.filter((row) => row.status === status));
  });
  api.set("members.invitationCounts", () =>
    read(
      Object.fromEntries(
        INVITATION_STATUSES.map((status) => [
          status,
          held.filter((row) => row.status === status).length,
        ]),
      ),
    ),
  );
  api.set("members.invite", () => {
    const { addresses } = INVITE_ASKED.parse(askedOf("members.invite"));
    return read({
      invitations: addresses.map((address) => {
        const waiting = held.find((row) => row.address === address && row.status === "waiting");
        if (waiting !== undefined) moveTo(waiting.invitationId, "cancelled");
        const minted = {
          ...anInvitation(address),
          invitationId: `invitation-${address}-${String(held.length)}`,
          address,
        };
        held.push(minted);
        return {
          ...sentOf(minted, !down.has(address)),
          replaced: waiting !== undefined,
        };
      }),
    });
  });
  api.set("members.resendInvitation", () =>
    read(resent(ONE_ASKED.parse(askedOf("members.resendInvitation")).invitationId)),
  );
  api.set("members.bulkResendInvitations", () =>
    read({
      invitations: SET_ASKED.parse(askedOf("members.bulkResendInvitations")).invitationIds.map(
        (invitationId) => resent(invitationId),
      ),
    }),
  );
  api.set("members.cancelInvitation", () => {
    const { invitationId } = ONE_ASKED.parse(askedOf("members.cancelInvitation"));
    cancelledOnce(invitationId);
    return read({ invitationId });
  });
  api.set("members.bulkCancelInvitations", () => {
    const { invitationIds } = SET_ASKED.parse(askedOf("members.bulkCancelInvitations"));
    const changed = invitationIds.filter((invitationId) => cancelledOnce(invitationId));
    return read({ changed, skipped: invitationIds.length - changed.length });
  });

  return { api, held, moveTo, reachable: (address: string) => down.delete(address) };
};

export const refusalNaming = (
  word: string,
  refusalClass: string,
  httpStatus: number,
  items: Readonly<Record<string, string>>,
) => ({
  error: {
    message: word,
    code: -32_001,
    data: { code: "REFUSED", httpStatus, refusal: { word, class: refusalClass, items } },
  },
});

export const tooManyAttempts = (retryAfterSeconds: number) => ({
  error: {
    message: "too many",
    code: -32_029,
    data: { code: "TOO_MANY_REQUESTS", httpStatus: 429, retryAfterSeconds },
  },
});

/** jsdom runs no default action for a key, so the one Enter has on a field or a button is run here. */
export const pressEnter = (element: HTMLElement) => {
  if (!fireEvent.keyDown(element, { key: "Enter" })) return;
  if (element instanceof HTMLInputElement) element.form?.requestSubmit();
  else fireEvent.click(element);
};

export const found = <Item>(item: Item | undefined): Item => {
  if (item === undefined) throw new Error("the page drew one thing fewer");
  return item;
};

export const firstAlertIn = (where: HTMLElement): HTMLElement =>
  found(within(where).getAllByRole("alert")[0]);

export const blurred = () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};

export const actionBesideKey = (list: HTMLElement, key: string): string =>
  within(list)
    .getAllByRole("term")
    .find((term) => term.textContent === key)?.nextElementSibling?.textContent ?? "";

export const pressedOn = (key: string, shiftKey = false) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, shiftKey });
};

export const focused = (element: HTMLElement) =>
  waitFor(() => {
    if (document.activeElement !== element) throw new Error("focus is elsewhere");
  });

export const openPeople = async (api: Api, tab: "Members" | "Invitations" | "Requests") => {
  const router = await openAt(HOMES.Admin.path, api);
  openTab(tab);
  await screen.findByRole("region", { name: tab });
  return router;
};

export const openInvitations = (api: Api) => openPeople(api, "Invitations");

export const invitationsRegion = () => screen.getByRole("region", { name: "Invitations" });

export const invitationRows = (): HTMLElement[] =>
  within(invitationsRegion())
    .queryAllByRole("row")
    .filter((row) => row.textContent.includes("@"));

export const rowsOf = (address: string): HTMLElement[] =>
  invitationRows().filter((row) => row.textContent.includes(address));

export const statusChoice = (status: string, count?: number) =>
  within(invitationsRegion()).findByRole("radio", {
    name: count === undefined ? new RegExp(`^${status}\\b`) : `${status} ${String(count)}`,
  });

export const shownUnder = async (status: string) => {
  const choice = await statusChoice(status);
  fireEvent.click(choice);
  await waitFor(() => {
    expect(choice.getAttribute("aria-checked")).toBe("true");
  });
};

export const tickOf = (address: string) =>
  within(invitationsRegion()).queryByRole("checkbox", { name: `Select ${address}` });

export const ticked = async (address: string) => {
  const tick = await within(invitationsRegion()).findByRole("checkbox", {
    name: `Select ${address}`,
  });
  fireEvent.click(tick);
  return tick;
};

export const menuOf = (address: string) =>
  within(invitationsRegion()).queryByRole("button", { name: `Actions for ${address}` });

export const menuItemChosen = async (address: string, item: string) => {
  const menu = await within(invitationsRegion()).findByRole("button", {
    name: `Actions for ${address}`,
  });
  fireEvent.keyDown(menu, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
};

const selectionBar = () => screen.getByRole("toolbar", { name: "Selected Invitations" });

export const selectionAction = (name: string) =>
  within(selectionBar()).getByRole("button", { name });

export const selectionSaid = () => within(selectionBar()).getByRole("status").textContent;

export const outcomeIn = () => within(invitationsRegion()).getAllByRole("status")[1];

export const INVITE = "Invite a Person";

export const inviteAction = () => screen.getByRole("button", { name: INVITE });

export const inviteDialog = () => screen.getByRole("dialog", { name: INVITE });

export const addressField = (): HTMLInputElement => {
  const field = within(inviteDialog()).getByLabelText("Email Addresses");
  if (!(field instanceof HTMLInputElement)) throw new Error("the address field is not an input");
  return field;
};

export const typed = (text: string) => {
  fireEvent.change(addressField(), { target: { value: text } });
};

export const sendButton = () => within(inviteDialog()).getByRole("button", { name: /^Send/ });

export const doneButton = () => within(inviteDialog()).getByRole("button", { name: "Done" });

export const heldAddresses = (): HTMLElement[] => {
  const list = within(inviteDialog()).queryByRole("list", { name: "Addresses to Invite" });
  return list === null ? [] : within(list).getAllByRole("listitem");
};

export const removeOf = (address: string, description?: string) =>
  within(inviteDialog()).getByRole("button", {
    name: `Remove ${address}`,
    ...(description === undefined ? {} : { description }),
  });

export const dialogOpened = async () => {
  fireEvent.click(inviteAction());
  await screen.findByRole("dialog", { name: INVITE });
  await focused(addressField());
};

export const dialogClosed = async () => {
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
};

export const openedWith = async (
  rows: readonly ListedInvitation[] = [],
  unreachable: readonly string[] = [],
) => {
  const stub = holdingInvitations(rows, unreachable);
  await openInvitations(stub.api);
  return stub;
};

export const sentTyped = async (text: string) => {
  await dialogOpened();
  typed(text);
  fireEvent.click(sendButton());
};
