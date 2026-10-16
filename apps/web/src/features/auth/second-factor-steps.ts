import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

import { backTo, carriedFlow, nextAfterSignIn } from "./carried-flow.ts";
import { rememberTheSession } from "./session-memory.ts";

export const CONFIRM_STEP = "/confirm";

export const RECOVERY_STEP = "/recovery";

export const SETUP_STEP = "/setup";

export const CODES_STEP = "/recovery-codes";

const DISPLAY_NAME_STEP = "/display-name";

type SessionStanding = "not-required" | "confirmed" | "confirm" | "setup";

type Held = {
  readonly mustHoldOne?: boolean;
  readonly codesAcknowledged: boolean;
  readonly recoveryCodes?: unknown;
  readonly thisSession?: { readonly standing: SessionStanding } | undefined;
};

const codesUnseen = (held: Held | undefined): boolean => {
  if (held === undefined) return false;
  if (held.recoveryCodes === undefined) return held.mustHoldOne === true;
  return !held.codesAcknowledged;
};

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

export type LeftFrom = { readonly href: string; readonly query: string };

export const detourTo = (step: string, from: LeftFrom): string =>
  carriedFlow(from.query) === "" ? backTo(step, from.href) : `${step}${from.query}`;

export const pendingDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  from: LeftFrom,
  fresh = false,
): Promise<string | undefined> => {
  const step = pendingStepOf(await secondFactorOrUnread(queryClient, api, fresh));
  return step === undefined ? undefined : detourTo(step, from);
};

export const confirmDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  from: LeftFrom,
): Promise<string> =>
  (await pendingDetour(queryClient, api, from, true)) ?? detourTo(CONFIRM_STEP, from);

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

export const codesDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
): Promise<string | undefined> => {
  const held = await secondFactorOrUnread(queryClient, api);
  if (codesUnseen(held) && pendingStepOf(held) === undefined) return undefined;
  return stepDue(held, query) ?? stepAfterTheCodes(query);
};
