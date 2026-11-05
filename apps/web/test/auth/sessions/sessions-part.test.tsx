import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { NOTHING_HELD, sessionStanding } from "@test/second-factor-api.ts";
import { server } from "@test/stub-server.ts";
import { holdProcedure, type Api } from "@test/stubbed-api.ts";
import { ADA, aRefusalAnswer, openPageOutsideShell, read } from "@test/two-workspaces.ts";

await vi.hoisted(() => import("@test/stub-server.ts"));

afterEach(cleanup);

const SIGNED_IN_WITH_NONE_OPEN = {
  session: { id: "s" },
  user: { id: ADA.personId, name: ADA.displayName, email: ADA.address },
};

const NOTHING_TO_SET_UP = {
  ...NOTHING_HELD,
  mustHoldOne: false,
  thisSession: sessionStanding("not-required"),
};

const ACTIVE_AT = "2026-10-02T09:41:00.000Z";

const THIS_DEVICE = {
  id: "s-here",
  device: "Chrome on Linux",
  lastActiveAt: ACTIVE_AT,
  current: true,
};

const EDGE = { id: "s-edge", device: "Edge on Windows", lastActiveAt: ACTIVE_AT, current: false };

const SAFARI = { id: "s-safari", device: "Safari on iOS", lastActiveAt: ACTIVE_AT, current: false };

type Held = typeof THIS_DEVICE;

const endedBy = z.object({ sessionId: z.string() });

const lastAsked = (procedure: string): unknown =>
  server.asks.filter((ask) => ask.procedure === procedure).at(-1)?.input;

const askedToSignOut = (): readonly string[] =>
  server.asks
    .filter((ask) => ask.procedure === "person.signOutSession")
    .map((ask) => endedBy.parse(ask.input).sessionId);

const signedInHolding = (sessions: readonly Held[]): Api => {
  let left = sessions;
  return new Map<string, () => unknown>([
    ["/get-session", () => SIGNED_IN_WITH_NONE_OPEN],
    ["person.secondFactor", () => read(NOTHING_TO_SET_UP)],
    ["person.sessions", () => read(left)],
    [
      "person.signOutSession",
      () => {
        const { sessionId } = endedBy.parse(lastAsked("person.signOutSession"));
        left = left.filter((session) => session.id !== sessionId);
        return read({ ended: 1 });
      },
    ],
    [
      "person.signOutOtherSessions",
      () => {
        const ended = left.filter((session) => !session.current).length;
        left = left.filter((session) => session.current);
        return read({ ended });
      },
    ],
  ]);
};

const sessionsRegion = () => screen.findByRole("region", { name: "Sessions" });

const rowNamed = (region: HTMLElement, device: string) =>
  within(region).queryByRole("listitem", { name: `A session on ${device}` });

const signOutButton = (region: HTMLElement, device: string) =>
  within(region).getByRole("button", { name: `Sign Out of ${device}` });

const said = (region: HTMLElement): string =>
  within(region)
    .getAllByRole("status")
    .map((status) => status.textContent)
    .join("");

const alertsIn = (region: HTMLElement): readonly string[] =>
  within(region)
    .queryAllByRole("alert")
    .map((alert) => alert.textContent)
    .filter((words) => words !== "");

const headingOf = (region: HTMLElement) =>
  within(region).getByRole("heading", { name: "Sessions" });

it("a sign-out removes its row and focuses the next", async () => {
  await openPageOutsideShell("/account", signedInHolding([THIS_DEVICE, EDGE, SAFARI]));
  const region = await sessionsRegion();
  await within(region).findByRole("listitem", { name: "A session on Edge on Windows" });

  fireEvent.click(signOutButton(region, "Edge on Windows"));

  await waitFor(() => {
    expect(said(region)).toContain("Edge on Windows");
  });
  expect(rowNamed(region, "Edge on Windows")).toBeNull();
  expect(askedToSignOut()).toEqual([EDGE.id]);
  await waitFor(() => {
    expect(document.activeElement).toBe(signOutButton(region, "Safari on iOS"));
  });

  fireEvent.click(signOutButton(region, "Safari on iOS"));

  await waitFor(() => {
    expect(said(region)).toContain("Safari on iOS");
  });
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  expect(askedToSignOut()).toEqual([EDGE.id, SAFARI.id]);
  await waitFor(() => {
    expect(document.activeElement).toBe(headingOf(region));
  });
});

it("a refused sign-out puts the row back with an alert", async () => {
  const api = signedInHolding([THIS_DEVICE, SAFARI]);
  const answer = holdProcedure(api, "person.signOutSession");
  const router = await openPageOutsideShell("/account", api);
  const region = await sessionsRegion();
  await within(region).findByRole("listitem", { name: "A session on Safari on iOS" });
  const signOut = signOutButton(region, "Safari on iOS");

  fireEvent.click(signOut);
  await answer.asked;

  await waitFor(() => {
    expect(rowNamed(region, "Safari on iOS")).toBeNull();
  });
  expect(alertsIn(region)).toEqual([]);

  answer.reject(aRefusalAnswer("session-gone", "unauthenticated", 401));

  const row = await within(region).findByRole("listitem", { name: "A session on Safari on iOS" });
  await waitFor(() => {
    expect(alertsIn(region)).toHaveLength(1);
  });
  expect(document.activeElement).toBe(
    within(row).getByRole("button", { name: "Sign Out of Safari on iOS" }),
  );
  expect(said(region)).toBe("");
  expect(router.state.location.pathname).toBe("/account");
});

it("Sign Out Everywhere Else confirms first, then signs out others", async () => {
  const api = signedInHolding([THIS_DEVICE, SAFARI]);
  const router = await openPageOutsideShell("/account", api);
  const region = await sessionsRegion();
  await within(region).findByRole("listitem", { name: "A session on Safari on iOS" });
  expect(within(region).getAllByRole("listitem")).toHaveLength(2);

  fireEvent.click(within(region).getByRole("button", { name: "Sign Out Everywhere Else" }));

  const dialog = await screen.findByRole("dialog", {
    name: "Sign Out of 1 Other Session",
    description: /\S/u,
  });
  expect(server.asks.map((ask) => ask.procedure)).not.toContain("person.signOutOtherSessions");

  fireEvent.click(within(dialog).getByRole("button", { name: "Sign Out 1 Session" }));

  await waitFor(() => {
    expect(said(region)).toMatch(/\b1\b/u);
  });
  expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  expect(server.asks.map((ask) => ask.procedure)).toContain("person.signOutOtherSessions");
  await waitFor(() => {
    expect(document.activeElement).toBe(headingOf(region));
  });
  expect(router.state.location.pathname).toBe("/account");
});
