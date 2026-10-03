import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

import { nextAfterSignIn } from "./carried-flow.ts";

export const CONFIRM_STEP = "/confirm";

export const RECOVERY_STEP = "/recovery";

export const SETUP_STEP = "/setup";

export const CODES_STEP = "/recovery-codes";

const DISPLAY_NAME_STEP = "/display-name";

type CodesHeld = { readonly codesAcknowledged: boolean; readonly recoveryCodes?: unknown };

/** Codes are kept hashed, so a set never ticked as saved is shown again as a new one. */
const codesUnseen = (held: CodesHeld | undefined): boolean =>
  held !== undefined && !held.codesAcknowledged && held.recoveryCodes !== undefined;

/** The display-name step's own read sends a named person on, so it is always the next one. */
export const stepAfterTheCodes = (query: string): string => `${DISPLAY_NAME_STEP}${query}`;

export const stepAfterTheFactors = (held: CodesHeld, query: string): string =>
  codesUnseen(held) ? `${CODES_STEP}${query}` : stepAfterTheCodes(query);

/** Never retried and never refused: an unread second factor holds no sign-in back. */
const secondFactorOrUnread = (queryClient: QueryClient, api: ApiProxy) =>
  queryClient
    .fetchQuery({ ...api.person.secondFactor.queryOptions(), retry: false })
    .catch(() => undefined);

export const codesWaitUnseen = async (queryClient: QueryClient, api: ApiProxy) =>
  codesUnseen(await secondFactorOrUnread(queryClient, api));

/** Where a sign-in lands: unseen codes first, then the display name, or on if one is given. */
const stepAfterSignIn = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
  displayNameGiven: boolean,
): Promise<string> => {
  if (await codesWaitUnseen(queryClient, api)) return `${CODES_STEP}${query}`;
  return displayNameGiven ? nextAfterSignIn(query) : stepAfterTheCodes(query);
};

/** Read after the sign-in has cleared the cache, so the second factor read is the new session's. */
export const useStepAfterSignIn = () => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  return (query: string, displayNameGiven: boolean) =>
    stepAfterSignIn(queryClient, api, query, displayNameGiven);
};

/** The codes step draws only for unseen codes. Undefined: it draws. */
export const codesDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
): Promise<string | undefined> =>
  (await codesWaitUnseen(queryClient, api)) ? undefined : stepAfterTheCodes(query);
