import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { ASK_TO_JOIN_WORDS } from "@/features/auth/workspace/ask-to-join-words.ts";
import { NO_WORKSPACE_HEADING } from "@/features/auth/workspace/workspace-words.ts";
import { server } from "@test/stub-server.ts";
import type { Api } from "@test/stubbed-api.ts";
import {
  aCeilingMet,
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
  await userEvent.type(region.getByLabelText(ASK_TO_JOIN_WORDS.reason), reason);
  await userEvent.click(region.getByRole("button", { name: ASK_TO_JOIN_WORDS.ask }));
  return region;
};

it("offers one way on to a person in no workspace", async () => {
  const api = signedInWithNoWorkspace();
  api.set("/sign-out", () => ({ success: true }));
  await openOutsideTheShellAt("/no-workspace", api);

  expect(await screen.findByRole("region", { name: ASK_TO_JOIN_WORDS.heading })).toBeDefined();

  expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
  expect(screen.queryByRole("link", { name: /create/i })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

  expect(await screen.findByRole("heading", { level: 1, name: "Sign In" })).toBeDefined();
});

it("refuses a blank reason, saying what to send", async () => {
  const api = signedInWithNoWorkspace();
  api.set("person.requestAccess", () => aRefusalAnswer("malformed", "malformed", 400));
  await openOutsideTheShellAt("/no-workspace", api);
  const region = await askRegion();
  const standing = region.getByRole("alert");
  expect(standing.textContent, "the refusal region stands empty before an ask").toBe("");

  await askToJoin(A_SHORT_NAME, "   ");

  await vi.waitFor(() => expect(standing.textContent).toMatch(/enter a reason/i));
  expect(region.getByRole("alert"), "the refusal came in the region that stood").toBe(standing);
  const reason = region.getByLabelText(ASK_TO_JOIN_WORDS.reason);
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
  const router = await openOutsideTheShellAt("/no-workspace", api);
  const region = await askRegion();
  const refusal = region.getByRole("alert");
  expect(region.queryByRole("button", { name: "Sign In Again" })).toBeNull();

  await askToJoin(A_SHORT_NAME, A_REASON);

  await vi.waitFor(() => expect(refusal.textContent).toMatch(/session has expired/i));
  await userEvent.click(await region.findByRole("button", { name: "Sign In Again" }));

  expect(await screen.findByRole("heading", { level: 1, name: "Sign In" })).toBeDefined();
  expect(router.state.location.pathname).toBe("/sign-in");
});

it("keeps an operator connecting Claude on the no-workspace page", async () => {
  const api = signedInWithNoWorkspace();
  api.set("session.operator", () => read({ operator: true, name: ADA.displayName }));
  globalThis.history.replaceState(null, "", `/no-workspace${CLAUDES_REQUEST}`);

  const router = await openOutsideTheShellAt(`/no-workspace${CLAUDES_REQUEST}`, api);

  expect(router.state.location.pathname).toBe("/no-workspace");
  expect(
    await screen.findByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING }),
  ).toBeDefined();
  expect(within(screen.getByRole("main")).getByText(/\bClaude\b/)).toBeDefined();
});

it("a refused sign-out off the shell says the wait", async () => {
  const api = signedInWithNoWorkspace();
  api.set("/sign-out", () => aCeilingMet(WAIT_SECONDS));
  await openOutsideTheShellAt("/no-workspace", api);
  const signOut = await screen.findByRole("button", { name: "Sign Out" });

  await userEvent.click(signOut);

  const said = () =>
    within(screen.getByRole("main"))
      .getAllByRole("alert")
      .map((alert) => alert.textContent)
      .filter((words) => words !== "");
  await vi.waitFor(() => expect(said()).toHaveLength(1));
  expect(said()[0]).toMatch(/\b2 minutes\b/);
  expect(screen.getByRole("heading", { level: 1, name: NO_WORKSPACE_HEADING })).toBeDefined();
  expect(document.activeElement, "a refused sign-out dropped the focus").toBe(signOut);
});
