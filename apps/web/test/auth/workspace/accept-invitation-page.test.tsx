import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { server, type Asked } from "@test/stub-server.ts";
import { addressOf, type Api } from "@test/stubbed-api.ts";
import {
  ADA,
  adaAnAdmin,
  aRefusalAnswer,
  openOutsideTheShellAt,
  read,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const INVITATION_ID = "01JINVITATION00000000000000";

const THE_LINK = `/invitations/${INVITATION_ID}`;

const SIGN_OUT = "/sign-out";

const NEEDS_A_PICK = aRefusalAnswer("no-active-workspace", "unauthenticated", 401);

const signedInAs = (name: string) => ({
  session: { id: "s" },
  user: { id: ADA.personId, name, email: ADA.address },
});

const inviteeNamed = (name: string): Api => {
  const api = adaAnAdmin();
  api.set("/get-session", () => signedInAs(name));
  api.set("session.member", () => NEEDS_A_PICK);
  api.set("person.invitations", () => read([]));
  api.set(SIGN_OUT, () => ({ success: true }));
  return api;
};

const invitedTo = (workspaceName: string) =>
  read({ workspaceName, invitedBy: "Morgan Reid", role: "Editor" });

const askedOf = (...procedures: readonly string[]) =>
  server.asks.filter((ask) => procedures.includes(ask.procedure));

const joinButton = () => screen.queryByRole("button", { name: "Join Workspace" });

it("keeps a given name when the join is then refused", async () => {
  const api = inviteeNamed("");
  api.set("person.invitation", () => invitedTo("Ashby Survey"));
  api.set("person.setDisplayName", () => {
    api.set("/get-session", () => signedInAs("Ines Moreau"));
    return read({});
  });
  api.set("person.acceptInvitation", () => aRefusalAnswer("already-a-member", "conflict", 409));
  const router = await openOutsideTheShellAt(THE_LINK, api);

  fireEvent.change(await screen.findByLabelText("Display Name"), {
    target: { value: "Ines Moreau" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Join Workspace" }));

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/already a member/i);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "already-a-member",
  );
  expect(askedOf("person.setDisplayName", "person.acceptInvitation")).toEqual([
    { procedure: "person.setDisplayName", input: { displayName: "Ines Moreau" } },
    { procedure: "person.acceptInvitation", input: { invitationId: INVITATION_ID } },
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Go to Your Workspaces" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/choose-workspace"));
  expect(await screen.findByRole("heading", { level: 1, name: "Your Workspaces" })).toBeDefined();
});

it("refuses a person at another address, offering the invited one", async () => {
  const api = inviteeNamed("Theo Other");
  api.set("person.invitation", () => invitedTo("Brightwater Estimating"));
  await openOutsideTheShellAt(THE_LINK, api);
  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Your Invitation to Brightwater Estimating",
    }),
  ).toBeDefined();
  expect(joinButton(), "a readable invitation offers no join").not.toBeNull();
  cleanup();

  api.set("person.invitation", () =>
    aRefusalAnswer("invitation-for-another-address", "forbidden", 403),
  );
  const askedPaths: string[] = [];
  const watching = (asked: Asked) => {
    askedPaths.push(addressOf(asked).pathname);
  };
  const router = await openOutsideTheShellAt(THE_LINK, api, watching);

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/different email address/i);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "invitation-for-another-address",
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Your Invitation");
  expect(joinButton(), "a refused invitation offers a join").toBeNull();
  expect(askedPaths, "the person was signed out before choosing").not.toContain(SIGN_OUT);

  fireEvent.click(screen.getByRole("button", { name: "Sign In with Another Address" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  expect(await screen.findByRole("heading", { level: 1, name: /^Sign In/ })).toBeDefined();
  expect(askedPaths.filter((path) => path === SIGN_OUT)).toHaveLength(1);
});

it("tells a named person a stray link names no invitation", async () => {
  const api = inviteeNamed("Una Price");
  api.set("person.invitation", () => invitedTo("Selby Roofing"));
  await openOutsideTheShellAt(THE_LINK, api);
  expect(await screen.findByRole("button", { name: "Join Workspace" })).toBeDefined();
  cleanup();

  api.set("person.invitation", () => aRefusalAnswer("no-such-invitation", "absent", 404));
  await openOutsideTheShellAt(THE_LINK, api);

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/link isn't valid/i);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "no-such-invitation",
  );
  expect(screen.queryByRole("button", { name: /^Join/ })).toBeNull();
});
