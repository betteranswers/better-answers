import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SIGN_IN_WORDS } from "@/features/auth/sign-in/sign-in-words.ts";
import {
  INVITATION_ACTIONS,
  INVITATION_WORDS,
} from "@/features/auth/workspace/invitation-words.ts";
import { PICKER_WORDS } from "@/features/auth/workspace/workspace-words.ts";
import { DISPLAY_NAME_WORDS } from "@/shared/member/display-name-words.ts";
import { aPersonNamedWithNoWorkspace, signedInAs } from "@test/auth/signed-in-without-workspace.ts";
import { server, type Asked } from "@test/stub-server.ts";
import { addressOf, type Api } from "@test/stubbed-api.ts";
import { aRefusalAnswer, openPageOutsideShell, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const INVITATION_ID = "01JINVITATION00000000000000";

const THE_LINK = `/invitations/${INVITATION_ID}`;

const SIGN_OUT = "/sign-out";

const inviteeNamed = (name: string): Api => {
  const api = aPersonNamedWithNoWorkspace(name);
  api.set(SIGN_OUT, () => ({ success: true }));
  return api;
};

const invitedTo = (workspaceName: string) =>
  read({ workspaceName, invitedBy: "Morgan Reid", role: "Editor" });

const askedOf = (...procedures: readonly string[]) =>
  server.asks.filter((ask) => procedures.includes(ask.procedure));

const joinButton = () => screen.queryByRole("button", { name: INVITATION_WORDS.join });

it("keeps the entered name when joining is refused", async () => {
  const api = inviteeNamed("");
  api.set("person.invitation", () => invitedTo("Ashby Survey"));
  api.set("person.setDisplayName", () => {
    api.set("/get-session", () => signedInAs("Ines Moreau"));
    return read({});
  });
  api.set("person.acceptInvitation", () => aRefusalAnswer("already-a-member", "conflict", 409));
  const router = await openPageOutsideShell(THE_LINK, api);

  fireEvent.change(await screen.findByLabelText(DISPLAY_NAME_WORDS.label), {
    target: { value: "Ines Moreau" },
  });
  fireEvent.click(screen.getByRole("button", { name: INVITATION_WORDS.join }));

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/\S/u);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "already-a-member",
  );
  expect(askedOf("person.setDisplayName", "person.acceptInvitation")).toEqual([
    { procedure: "person.setDisplayName", input: { displayName: "Ines Moreau" } },
    { procedure: "person.acceptInvitation", input: { invitationId: INVITATION_ID } },
  ]);

  fireEvent.click(screen.getByRole("button", { name: INVITATION_ACTIONS.yourWorkspaces }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/choose-workspace"));
  expect(
    await screen.findByRole("heading", { level: 1, name: PICKER_WORDS.heading }),
  ).toBeDefined();
});

it("offers sign-in with the invited address to someone else", async () => {
  const api = inviteeNamed("Theo Other");
  api.set("person.invitation", () => invitedTo("Brightwater Estimating"));
  await openPageOutsideShell(THE_LINK, api);
  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: INVITATION_WORDS.heading("Brightwater Estimating"),
    }),
  ).toBeDefined();
  expect(joinButton(), "a readable invitation has no Join Workspace button").not.toBeNull();
  cleanup();

  api.set("person.invitation", () =>
    aRefusalAnswer("invitation-for-another-address", "forbidden", 403),
  );
  const askedPaths: string[] = [];
  const watching = (asked: Asked) => {
    askedPaths.push(addressOf(asked).pathname);
  };
  const router = await openPageOutsideShell(THE_LINK, api, watching);

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/\S/u);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "invitation-for-another-address",
  );
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(INVITATION_WORDS.untitled);
  expect(joinButton(), "a refused invitation still shows Join Workspace").toBeNull();
  expect(askedPaths, "the person was signed out before choosing").not.toContain(SIGN_OUT);

  fireEvent.click(screen.getByRole("button", { name: INVITATION_ACTIONS.anotherAddress }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  expect(
    await screen.findByRole("heading", { level: 1, name: SIGN_IN_WORDS.emailStep.nothing.title }),
  ).toBeDefined();
  expect(router.state.location.href, "the sign-in address does not carry the invitation").toContain(
    encodeURIComponent(THE_LINK),
  );
  expect(askedPaths.filter((path) => path === SIGN_OUT)).toHaveLength(1);
});

it("shows an alert for a link with no invitation", async () => {
  const api = inviteeNamed("Una Price");
  api.set("person.invitation", () => invitedTo("Selby Roofing"));
  await openPageOutsideShell(THE_LINK, api);
  expect(await screen.findByRole("button", { name: INVITATION_WORDS.join })).toBeDefined();
  cleanup();

  api.set("person.invitation", () => aRefusalAnswer("no-such-invitation", "absent", 404));
  await openPageOutsideShell(THE_LINK, api);

  const refusal = await screen.findByRole("alert");
  expect(refusal.textContent).toMatch(/\S/u);
  expect(document.body.textContent, "the page shows the refusal's word").not.toContain(
    "no-such-invitation",
  );
  expect(screen.queryByRole("button", { name: /^Join/ })).toBeNull();
});
