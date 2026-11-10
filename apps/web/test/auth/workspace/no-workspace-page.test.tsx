import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { UNKNOWN_PAGE } from "@/app/words.ts";
import { ASK_TO_JOIN_WORDS } from "@/features/auth/workspace/ask-to-join-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace/workspace-words.ts";
import { SIGN_IN_AGAIN } from "@/shared/refusal-words.ts";
import { SIGN_OUT } from "@/shared/words.ts";
import { server } from "@test/stub-server.ts";
import type { Api } from "@test/stubbed-api.ts";
import {
  rateLimitedResponse,
  ADA,
  adaAnAdmin,
  aRefusalAnswer,
  openPageOutsideShell,
  read,
} from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(() => {
  cleanup();
  localStorage.clear();
  globalThis.history.replaceState(null, "", "/");
});

const SIGNED_IN_WITH_NONE_OPEN = {
  session: { id: "s" },
  user: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
};

const A_SHORT_NAME = "acme-joinery";

const A_REASON = "I run the estimating desk and need the tender library.";

const WAIT_SECONDS = 120;

const CLAUDES_REQUEST = "?client_id=claude&sig=abc&exp=1791000000";

const signedInWithNoWorkspace = (): Api => {
  const api = adaAnAdmin();
  api.set("/get-session", () => SIGNED_IN_WITH_NONE_OPEN);
  api.set("person.invitations", () => read([]));
  return api;
};

const askRegion = async () =>
  within(await screen.findByRole("region", { name: ASK_TO_JOIN_WORDS.heading }));

const askToJoin = async (shortName: string, reason: string) => {
  const region = await askRegion();
  await userEvent.type(region.getByLabelText(ASK_TO_JOIN_WORDS.shortName), shortName);
  await userEvent.type(region.getByLabelText("Reason"), reason);
  await userEvent.click(region.getByRole("button", { name: ASK_TO_JOIN_WORDS.ask }));
  return region;
};

it("offers Ask to Join but no Create Workspace", async () => {
  const api = signedInWithNoWorkspace();
  api.set("/sign-out", () => ({ success: true }));
  await openPageOutsideShell("/no-workspace", api);

  expect(await screen.findByRole("region", { name: ASK_TO_JOIN_WORDS.heading })).toBeDefined();

  expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  expect(screen.queryByRole("link", { name: /create/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: SIGN_OUT }));

  expect(await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.signIn })).toBeDefined();
});

it("refuses a blank reason and focuses the Reason field", async () => {
  const api = signedInWithNoWorkspace();
  api.set("person.requestAccess", () => aRefusalAnswer("malformed", "malformed", 400));
  await openPageOutsideShell("/no-workspace", api);
  const region = await askRegion();
  const alertBefore = region.getByRole("alert");
  expect(alertBefore.textContent, "the alert region holds words before asking").toBe("");

  await askToJoin(A_SHORT_NAME, "   ");

  await vi.waitFor(() => expect(alertBefore.textContent).toMatch(/\S/u));
  expect(region.getByRole("alert"), "the refusal appeared in a new alert region").toBe(alertBefore);
  const reason = region.getByLabelText("Reason");
  expect(reason.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(reason);
  expect(screen.queryByRole("alert", { name: ASK_TO_JOIN_WORDS.sent })).toBeNull();
  expect(server.asks).toContainEqual({
    procedure: "person.requestAccess",
    input: { shortName: A_SHORT_NAME, reason: "   " },
  });

  api.set("person.requestAccess", () => read(null));
  await userEvent.type(reason, "tender library");
  await userEvent.click(region.getByRole("button", { name: ASK_TO_JOIN_WORDS.ask }));
  expect(await screen.findByRole("alert", { name: ASK_TO_JOIN_WORDS.sent })).toBeDefined();
});

it("sends a person whose session ended back to sign in", async () => {
  const api = signedInWithNoWorkspace();
  api.set("person.requestAccess", () => aRefusalAnswer("no-session", "unauthenticated", 401));
  const router = await openPageOutsideShell("/no-workspace", api);
  const region = await askRegion();
  const refusal = region.getByRole("alert");
  expect(region.queryByRole("button", { name: SIGN_IN_AGAIN })).toBeNull();

  await askToJoin(A_SHORT_NAME, A_REASON);

  await vi.waitFor(() => expect(refusal.textContent).toMatch(/\S/u));
  await userEvent.click(await region.findByRole("button", { name: SIGN_IN_AGAIN }));

  expect(await screen.findByRole("heading", { level: 1, name: UNKNOWN_PAGE.signIn })).toBeDefined();
  expect(router.state.location.pathname).toBe("/sign-in");
});

it("keeps an operator connecting Claude on the no-workspace page", async () => {
  const api = signedInWithNoWorkspace();
  api.set("session.operator", () => read({ operator: true, name: ADA.displayName }));
  globalThis.history.replaceState(null, "", `/no-workspace${CLAUDES_REQUEST}`);

  const router = await openPageOutsideShell(`/no-workspace${CLAUDES_REQUEST}`, api);

  expect(router.state.location.pathname).toBe("/no-workspace");
  expect(
    await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
  ).toBeDefined();
  expect(within(screen.getByRole("main")).getByText(/\bClaude\b/)).toBeDefined();
});

it("a rate-limited sign-out names the wait", async () => {
  const api = signedInWithNoWorkspace();
  api.set("/sign-out", () => rateLimitedResponse(WAIT_SECONDS));
  await openPageOutsideShell("/no-workspace", api);
  const signOut = await screen.findByRole("button", { name: SIGN_OUT });

  await userEvent.click(signOut);

  const said = () =>
    within(screen.getByRole("main"))
      .getAllByRole("alert")
      .map((alert) => alert.textContent)
      .filter((words) => words !== "");
  await vi.waitFor(() => expect(said()).toHaveLength(1));
  expect(said()[0]).toMatch(/\b2 minutes\b/);
  expect(screen.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeDefined();
  expect(document.activeElement, "the Sign Out button lost focus after the refusal").toBe(signOut);
});
