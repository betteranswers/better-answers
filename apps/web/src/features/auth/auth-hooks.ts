import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BetterFetchError } from "better-auth/client";

import { authClient } from "./auth-client.ts";

const AUTH_KEYS = {
  session: ["auth", "session"],
  workspaces: ["auth", "workspaces"],
} as const;

const unwrap = async <TData, TError>(
  call: Promise<{ data: TData; error: TError | null }>,
): Promise<TData> => {
  const { data, error } = await call;
  if (error !== null) throw error;
  return data;
};

const sessionOptions = () =>
  queryOptions({
    queryKey: AUTH_KEYS.session,
    queryFn: () => unwrap(authClient.getSession()),
  });

export const useSession = () => useQuery(sessionOptions());

const listOrganizationsOptions = () =>
  queryOptions({
    queryKey: AUTH_KEYS.workspaces,
    queryFn: () => unwrap(authClient.organization.list()),
  });

export const useListOrganizations = () => useQuery(listOrganizationsOptions());

const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; type: "sign-in" }>({
    mutationFn: (input) => unwrap(authClient.emailOtp.sendVerificationOtp(input)),
  });

export const useSendVerificationOtp = () => useMutation(sendVerificationOtpOptions());

const signInEmailOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; otp: string }>({
    mutationFn: (input) => unwrap(authClient.signIn.emailOtp(input)),
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

const signOutOptions = () =>
  mutationOptions<unknown, BetterFetchError, void>({
    mutationFn: () => unwrap(authClient.signOut()),
  });

export const useSignOut = () => useMutation(signOutOptions());

const setActiveOrganizationOptions = () =>
  mutationOptions<unknown, BetterFetchError, { organizationId: string }>({
    mutationFn: (input) => unwrap(authClient.organization.setActive(input)),
  });

export const useSetActiveOrganization = () => {
  const queryClient = useQueryClient();
  return useMutation({
    ...setActiveOrganizationOptions(),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.workspaces }),
      ]),
  });
};

export type ResumeAnswer = { readonly redirect?: boolean; readonly url?: string };

const oauthContinueOptions = () =>
  mutationOptions<ResumeAnswer, BetterFetchError, { postLogin: true }>({
    mutationFn: async (input) => {
      // SAFETY: the client plugin types this answer as `any`; the picker checks `url` for
      // presence and shape before following it.
      return (await unwrap(authClient.oauth2.continue(input))) as ResumeAnswer;
    },
  });

export const useOAuthContinue = () => useMutation(oauthContinueOptions());
