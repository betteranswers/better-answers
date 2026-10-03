import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { askOfOurRoute, rereadTheSession } from "./auth-hooks.ts";

const START_PATH = "/authenticator/start";

const FINISH_PATH = "/authenticator/finish";

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

export type SecondFactorRead = ReturnType<typeof useSecondFactor>;

export type SecondFactor = NonNullable<SecondFactorRead["data"]>;

/** Awaited by each act, so the act stays pending until the page can show what it changed. */
export const useRereadTheSecondFactor = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries(api.person.secondFactor.queryFilter());
};

/** Starting over an unfinished setup mints a new key, so the old one scanned stops matching. */
export const useStartAuthenticator = () =>
  useMutation({ mutationFn: () => askOfOurRoute(START_PATH, {}, setupStarted) });

export type StartingTheSetup = ReturnType<typeof useStartAuthenticator>;

/**
 * The codes show once, so the mutation hands them over first, even if the field has closed. The
 * first code swaps the session's cookie.
 */
export const useFinishAuthenticator = (onFinished: (issued: CodesIssued | null) => void) => {
  const queryClient = useQueryClient();
  const reread = useRereadTheSecondFactor();
  return useMutation({
    mutationKey: [FINISH_PATH],
    mutationFn: (code: string) => askOfOurRoute(FINISH_PATH, { code }, setupFinished),
    onSuccess: async (issued) => {
      onFinished(issued);
      await Promise.all([rereadTheSession(queryClient), reread()]);
    },
  });
};

/** Read where the setup is opened, since the code field holding the finish can close first. */
export const useFinishingTheSetup = (): boolean =>
  useMutationState({ filters: { mutationKey: [FINISH_PATH], status: "pending" } }).length > 0;

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
