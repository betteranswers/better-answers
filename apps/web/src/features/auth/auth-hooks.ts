import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { BetterFetchError } from "better-auth/client";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { authClient } from "./auth-client.ts";
import { backTo, nextAfterSignIn } from "./carried-flow.ts";
import { forgetMembership } from "./membership.ts";

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

/** Its `data` is null when this browser holds no session. */
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

/** Whitespace alone is no name. */
export const hasADisplayName = (name: string): boolean => name.trim() !== "";

export type SignedIn = { readonly displayNameGiven: boolean };

const signInEmailOtpOptions = () =>
  mutationOptions<SignedIn, BetterFetchError, { email: string; otp: string }>({
    mutationFn: async (input) => {
      const answer = await unwrap(authClient.signIn.emailOtp(input));
      // An answer naming nobody sends the person to the display-name screen, whose own read
      // decides.
      return { displayNameGiven: answer !== null && hasADisplayName(answer.user.name) };
    },
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

/**
 * Undefined when unread: the screen then stands, and its own next request says in words what went
 * wrong.
 */
const sessionOrUnread = (queryClient: QueryClient) =>
  queryClient.fetchQuery(sessionOptions()).catch(() => undefined);

/**
 * Read before the display-name screen draws, so a person it has nothing to ask never sees it.
 * Undefined means the screen draws.
 */
export const displayNameDetour = async (
  queryClient: QueryClient,
  query: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  if (session === undefined) return undefined;
  if (session === null) return `/sign-in${query}`;
  return hasADisplayName(session.user.name) ? nextAfterSignIn(query) : undefined;
};

/** The accept page asks only a person signed in and named. Undefined means the page draws. */
export const acceptDetour = async (
  queryClient: QueryClient,
  path: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  if (session === undefined) return undefined;
  if (session === null) return backTo("/sign-in", path);
  return hasADisplayName(session.user.name) ? undefined : backTo("/display-name", path);
};

/** A save drops the held session, so the next read of it carries the new name. */
export const useSetDisplayName = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.person.setDisplayName.mutationOptions({
      // Removed, not invalidated: no screen watches it here, so a stale answer would be the next
      // screen's first read.
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: AUTH_KEYS.session });
      },
    }),
  );
};

/**
 * A join points the session at the workspace joined, so the held session, membership and list of
 * workspaces are dropped before the shell reads them.
 */
export const useAcceptInvitation = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation(
    api.person.acceptInvitation.mutationOptions({
      onSuccess: () => {
        forgetMembership(queryClient, api);
        queryClient.removeQueries({ queryKey: AUTH_KEYS.session });
        queryClient.removeQueries({ queryKey: AUTH_KEYS.workspaces });
        void navigate({ href: "/", replace: true });
      },
    }),
  );
};

const signOutOptions = () =>
  mutationOptions<unknown, BetterFetchError, void>({
    mutationFn: () => unwrap(authClient.signOut()),
  });

/**
 * Whatever the server answers, clears every held query and goes to the sign-in screen, which
 * comes back to `returnTo` when one is named.
 */
export const useSignOut = (returnTo?: string) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation(signOutOptions());

  return {
    signingOut: signOut.isPending,
    signOut: () => {
      signOut.mutate(undefined, {
        // On settle, not success: whatever the server said, this browser is done with the
        // session the person asked to leave.
        onSettled: () => {
          queryClient.clear();
          const href = returnTo === undefined ? "/sign-in" : backTo("/sign-in", returnTo);
          void navigate({ href, replace: true });
        },
      });
    },
  };
};

const setActiveOrganizationOptions = () =>
  mutationOptions<unknown, BetterFetchError, { organizationId: string }>({
    mutationFn: (input) => unwrap(authClient.organization.setActive(input)),
  });

/** A pick drops the held membership and marks the held session and workspace list stale. */
export const useSetActiveOrganization = () => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  return useMutation({
    ...setActiveOrganizationOptions(),
    onSuccess: () => {
      forgetMembership(queryClient, api);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.workspaces }),
      ]);
    },
  });
};

/** The client plugin types this answer as `any`, so its shape is read where it lands. */
const resumeAnswer = z.object({ redirect: z.boolean().optional(), url: z.string().optional() });
export type ResumeAnswer = z.infer<typeof resumeAnswer>;

const oauthContinueOptions = () =>
  mutationOptions<ResumeAnswer, BetterFetchError, { postLogin: true }>({
    mutationFn: async (input) =>
      resumeAnswer.parse(await unwrap(authClient.oauth2.continue(input))),
  });

export const useOAuthContinue = () => useMutation(oauthContinueOptions());
