import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { askOfOurRoute, rereadTheSession } from "./auth-hooks.ts";

/** Where an authenticator's setup starts and finishes. */
export type AuthenticatorRoutes = { readonly start: string; readonly finish: string };

export const FIRST_AUTHENTICATOR: AuthenticatorRoutes = {
  start: "/authenticator/start",
  finish: "/authenticator/finish",
};

/** Open only to a session granted setup; finishing removes the old factors. */
export const NEW_AUTHENTICATOR: AuthenticatorRoutes = {
  start: "/second-factor/replace/authenticator-start",
  finish: "/second-factor/replace/authenticator-finish",
};

const keyIn = (setupAddress: string): string =>
  new URL(setupAddress).searchParams.get("secret") ?? "";

/** The key is read out of the address here, so a setup carrying none is refused where it enters. */
const setupStarted = z
  .object({ setupAddress: z.string().startsWith("otpauth://") })
  .transform(({ setupAddress }) => ({ setupAddress, key: keyIn(setupAddress) }))
  .refine((started) => started.key !== "");

export type SetupStarted = z.output<typeof setupStarted>;

/** Null when the person already held codes, which a setup leaves standing. */
const setupFinished = z
  .union([
    z.object({ recoveryCodes: z.array(z.string()), madeAt: z.iso.datetime() }),
    z.object({ recoveryCodes: z.null() }),
  ])
  .transform((answer) => (answer.recoveryCodes === null ? null : answer));

/** A set as its issue answered it; `madeAt` names the set when it is acknowledged. */
export type CodesIssued = NonNullable<z.output<typeof setupFinished>>;

export const useSecondFactor = () => {
  const api = useTRPC();
  return useQuery(api.person.secondFactor.queryOptions());
};

/** Every frame reads it, so never again on a window's focus; an Account page action still rereads it. */
export const useSecondFactorOnce = () => {
  const api = useTRPC();
  return useQuery({
    ...api.person.secondFactor.queryOptions(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
};

export type SecondFactorRead = ReturnType<typeof useSecondFactor>;

export type SecondFactor = NonNullable<SecondFactorRead["data"]>;

/** Awaited by each action, so the action stays pending until the page can show what it changed. */
export const useRereadTheSecondFactor = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(api.person.secondFactor.queryFilter());
};

/** Starting over an unfinished setup mints a new key, so the old one scanned stops matching. */
export const useStartAuthenticator = (routes = FIRST_AUTHENTICATOR) =>
  useMutation({ mutationFn: () => askOfOurRoute(routes.start, {}, setupStarted) });

export type StartingTheSetup = ReturnType<typeof useStartAuthenticator>;

/**
 * The codes show once, so the mutation hands them over first, even if the field has closed. The
 * first code swaps the session's cookie.
 */
export const useFinishAuthenticator = (
  onFinished: (issued: CodesIssued | null) => void,
  routes = FIRST_AUTHENTICATOR,
) => {
  const queryClient = useQueryClient();
  const reread = useRereadTheSecondFactor();
  return useMutation({
    mutationKey: [routes.finish],
    mutationFn: (code: string) => askOfOurRoute(routes.finish, { code }, setupFinished),
    onSuccess: async (issued) => {
      onFinished(issued);
      await Promise.all([rereadTheSession(queryClient), reread()]);
    },
  });
};

/** Read where the setup is opened, since the code field holding the finish can close first. */
export const useFinishingTheSetup = (routes = FIRST_AUTHENTICATOR): boolean =>
  useMutationState({ filters: { mutationKey: [routes.finish], status: "pending" } }).length > 0;

export const useRemoveAuthenticator = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.removeAuthenticator.mutationOptions({ onSuccess: reread }));
};

/** Rereads on a refusal too: a set made in another tab turns Make into Replace. */
export const useReplaceRecoveryCodes = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.replaceRecoveryCodes.mutationOptions({ onSettled: reread }));
};

export const useAcknowledgeRecoveryCodes = () => {
  const api = useTRPC();
  return useMutation(api.person.acknowledgeRecoveryCodes.mutationOptions());
};
