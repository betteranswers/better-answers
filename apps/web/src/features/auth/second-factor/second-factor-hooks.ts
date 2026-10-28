import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { askOfOurRoute, rereadTheSession } from "../auth-hooks.ts";

export type AuthenticatorRoutes = { readonly start: string; readonly finish: string };

export const FIRST_AUTHENTICATOR: AuthenticatorRoutes = {
  start: "/authenticator/start",
  finish: "/authenticator/finish",
};

export const NEW_AUTHENTICATOR: AuthenticatorRoutes = {
  start: "/second-factor/replace/authenticator-start",
  finish: "/second-factor/replace/authenticator-finish",
};

const keyIn = (setupAddress: string): string =>
  new URL(setupAddress).searchParams.get("secret") ?? "";

const setupStarted = z
  .object({ setupAddress: z.string().startsWith("otpauth://") })
  .transform(({ setupAddress }) => ({ setupAddress, key: keyIn(setupAddress) }))
  .refine((started) => started.key !== "");

export type SetupStarted = z.output<typeof setupStarted>;

const setupFinished = z
  .union([
    z.object({ recoveryCodes: z.array(z.string()), madeAt: z.iso.datetime() }),
    z.object({ recoveryCodes: z.null() }),
  ])
  .transform((answer) => (answer.recoveryCodes === null ? null : answer));

export type CodesIssued = NonNullable<z.output<typeof setupFinished>>;

export const useSecondFactor = () => {
  const api = useTRPC();
  return useQuery(api.person.secondFactor.queryOptions());
};

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

export const useRereadTheSecondFactor = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(api.person.secondFactor.queryFilter());
};

export const useStartAuthenticator = (routes = FIRST_AUTHENTICATOR) =>
  useMutation({ mutationFn: () => askOfOurRoute(routes.start, {}, setupStarted) });

export type StartingTheSetup = ReturnType<typeof useStartAuthenticator>;

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

export const useFinishingTheSetup = (routes = FIRST_AUTHENTICATOR): boolean =>
  useMutationState({ filters: { mutationKey: [routes.finish], status: "pending" } }).length > 0;

export const useRemoveAuthenticator = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.removeAuthenticator.mutationOptions({ onSuccess: reread }));
};

export const useReplaceRecoveryCodes = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.replaceRecoveryCodes.mutationOptions({ onSettled: reread }));
};

export const useAcknowledgeRecoveryCodes = () => {
  const api = useTRPC();
  return useMutation(api.person.acknowledgeRecoveryCodes.mutationOptions());
};
