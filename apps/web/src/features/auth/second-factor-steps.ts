import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

import { backTo, carriedFlow, nextAfterSignIn } from "./carried-flow.ts";
import { rememberTheSession } from "./session-memory.ts";

export const CONFIRM_STEP = "/confirm";

export const RECOVERY_STEP = "/recovery";

export const SETUP_STEP = "/setup";

export const CODES_STEP = "/recovery-codes";

const DISPLAY_NAME_STEP = "/display-name";

type Standing = "not-required" | "confirmed" | "confirm" | "setup";

type Held = {
  readonly mustHoldOne?: boolean;
  readonly codesAcknowledged: boolean;
  readonly recoveryCodes?: unknown;
  readonly thisSession?: { readonly standing: Standing } | undefined;
};

/** Hashed codes are never shown twice, so an unticked set comes anew; one owing a factor but holding none gets a first set. */
const codesUnseen = (held: Held | undefined): boolean => {
  if (held === undefined) return false;
  if (held.recoveryCodes === undefined) return held.mustHoldOne === true;
  return !held.codesAcknowledged;
};

/** The page a pending session confirms or sets up on; undefined for a session not pending. */
const pendingStepOf = (held: Held | undefined): string | undefined => {
  const standing = held?.thisSession?.standing;
  if (standing === "confirm") return CONFIRM_STEP;
  return standing === "setup" ? SETUP_STEP : undefined;
};

/**
 * The last read of the standing says how a session that ends was left: a pending one is told it
 * ended unconfirmed.
 */
export const rememberTheStanding = (held: Held | undefined): void => {
  if (held?.thisSession === undefined) return;
  rememberTheSession(pendingStepOf(held) === undefined ? "held" : "pending");
};

/** The display-name step's own read sends a named person on, so it is always the next one. */
export const stepAfterTheCodes = (query: string): string => `${DISPLAY_NAME_STEP}${query}`;

export const stepAfterTheFactors = (held: Held, query: string): string =>
  codesUnseen(held) ? `${CODES_STEP}${query}` : stepAfterTheCodes(query);

/** Never retried: an unread second factor holds nothing back. A stale held read is caught later. */
const secondFactorOrUnread = async (queryClient: QueryClient, api: ApiProxy, fresh = true) => {
  const asked = { ...api.person.secondFactor.queryOptions(), retry: false };
  const held = await (
    fresh ? queryClient.fetchQuery(asked) : queryClient.ensureQueryData(asked)
  ).catch(() => undefined);
  rememberTheStanding(held);
  return held;
};

/** Where a page was, as the router names it and as the address bar holds a signed query. */
export type LeftFrom = { readonly href: string; readonly query: string };

/** A signed flow keeps its whole query; anything else comes back to the address it left. */
export const detourTo = (step: string, from: LeftFrom): string =>
  carriedFlow(from.query) === "" ? backTo(step, from.href) : `${step}${from.query}`;

/** Undefined: the session is not pending, or its standing went unread, and the page draws. */
export const pendingDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  from: LeftFrom,
  fresh = false,
): Promise<string | undefined> => {
  const step = pendingStepOf(await secondFactorOrUnread(queryClient, api, fresh));
  return step === undefined ? undefined : detourTo(step, from);
};

/** Confirm or setup, then unseen codes: the step due before any later one. Undefined: none is. */
const stepDue = (held: Held | undefined, query: string): string | undefined => {
  const pending = pendingStepOf(held);
  if (pending !== undefined) return `${pending}${query}`;
  return codesUnseen(held) ? `${CODES_STEP}${query}` : undefined;
};

export const factorStepDue = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
): Promise<string | undefined> => stepDue(await secondFactorOrUnread(queryClient, api), query);

/** The factor steps first, then the display name, or on if one is given. */
const stepAfterSignIn = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
  displayNameGiven: boolean,
): Promise<string> =>
  (await factorStepDue(queryClient, api, query)) ??
  (displayNameGiven ? nextAfterSignIn(query) : stepAfterTheCodes(query));

/** Read after the sign-in has cleared the cache, so the second factor read is the new session's. */
export const useStepAfterSignIn = () => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  return (query: string, displayNameGiven: boolean) =>
    stepAfterSignIn(queryClient, api, query, displayNameGiven);
};

/** The codes step draws only for unseen codes, once the session is confirmed. Undefined: it draws. */
export const codesDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
): Promise<string | undefined> => {
  const held = await secondFactorOrUnread(queryClient, api);
  if (codesUnseen(held) && pendingStepOf(held) === undefined) return undefined;
  return stepDue(held, query) ?? stepAfterTheCodes(query);
};
