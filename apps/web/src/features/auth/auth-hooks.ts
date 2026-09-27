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
import { useState } from "react";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { authClient } from "./auth-client.ts";
import {
  backTo,
  dropTheCarriedFlow,
  isAnInvitation,
  leavingFor,
  nextAfterJoining,
  nextAfterSignIn,
  pageQuery,
} from "./carried-flow.ts";
import { forgetMembership } from "./membership.ts";
import { rememberTheSession, sessionRemembered } from "./session-memory.ts";
import type { Arrival } from "./sign-in-words.ts";

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

/** The per-email ceiling in front of Better Auth answers the first; Better Auth's own, the second. */
const WAIT_HEADERS = ["retry-after", "x-retry-after"] as const;

const wholeSeconds = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((seconds) => Number(seconds));

const waitNamedBy = (response: Response): number | undefined => {
  for (const header of WAIT_HEADERS) {
    const named = wholeSeconds.safeParse(response.headers.get(header));
    if (named.success) return named.data;
  }
  return undefined;
};

const SERVER_FAILED = 500;

/** Better Auth refused a code's send or its check, with the wait a ceiling named, if it named one. */
export class CodeRefused extends Error {
  readonly status: number;
  readonly waitSeconds: number | undefined;

  constructor(status: number, waitSeconds: number | undefined) {
    super(`answered ${String(status)}`);
    this.name = "CodeRefused";
    this.status = status;
    this.waitSeconds = waitSeconds;
  }
}

type WaitReading = { readonly onError: (context: { readonly response: Response }) => void };

/**
 * The client's error drops the response's headers, so the wait is read as the response lands. A
 * server's failure is no refusal.
 */
const unwrapWithTheWait = async <TData>(
  call: (reading: WaitReading) => Promise<{ data: TData; error: { status: number } | null }>,
): Promise<TData> => {
  let waitSeconds: number | undefined;
  const { data, error } = await call({
    onError: ({ response }) => {
      waitSeconds = waitNamedBy(response);
    },
  });
  if (error === null) return data;
  if (error.status >= SERVER_FAILED) throw new Error(`answered ${String(error.status)}`);
  throw new CodeRefused(error.status, waitSeconds);
};

const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, Error, { email: string; type: "sign-in" }>({
    mutationFn: (input) =>
      unwrapWithTheWait((reading) => authClient.emailOtp.sendVerificationOtp(input, reading)),
  });

export const useSendVerificationOtp = () => useMutation(sendVerificationOtpOptions());

/** Whitespace alone is no name. */
export const hasADisplayName = (name: string): boolean => name.trim() !== "";

export type SignedIn = { readonly displayNameGiven: boolean };

const signInEmailOtpOptions = () =>
  mutationOptions<SignedIn, Error, { email: string; otp: string }>({
    mutationFn: async (input) => {
      const answer = await unwrapWithTheWait((reading) =>
        authClient.signIn.emailOtp(input, reading),
      );
      // An answer naming nobody sends the person to the display-name screen, whose own read
      // decides.
      return { displayNameGiven: answer !== null && hasADisplayName(answer.user.name) };
    },
    onSuccess: () => {
      rememberTheSession("held");
    },
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

/**
 * Said only once the api reads no session: a failed sign-out, or a visit while signed in, leaves
 * one standing.
 */
export const useArrival = (): Arrival | undefined => {
  const [remembered] = useState(sessionRemembered);
  const session = useQuery({ ...sessionOptions(), enabled: remembered !== undefined });
  if (remembered === undefined || session.data !== null) return undefined;
  return remembered === "signed-out" ? "signed-out" : "session-ended";
};

/**
 * Undefined when unread: the screen then stands, and its own next request says in words what went
 * wrong.
 */
const sessionOrUnread = (queryClient: QueryClient) =>
  queryClient.fetchQuery(sessionOptions()).catch(() => undefined);

/**
 * Read before the screen draws, so a person it has nothing to ask never sees it; an invitation
 * asks its invitee's name. Undefined: it draws.
 */
export const displayNameDetour = async (
  queryClient: QueryClient,
  query: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  if (session === undefined) return undefined;
  if (session === null) return `/sign-in${query}`;
  const next = nextAfterSignIn(query);
  return hasADisplayName(session.user.name) || isAnInvitation(next) ? next : undefined;
};

/**
 * Only a signed-out person is sent on: the page asks a nameless invitee's name beside its join,
 * so joining is one step. Undefined: it draws.
 */
export const acceptDetour = async (
  queryClient: QueryClient,
  path: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  return session === null ? backTo("/sign-in", path) : undefined;
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
        void navigate(leavingFor(nextAfterJoining(pageQuery())));
      },
    }),
  );
};

const signOutOptions = () =>
  mutationOptions<unknown, BetterFetchError, void>({
    mutationFn: () => {
      dropTheCarriedFlow();
      return unwrap(authClient.signOut());
    },
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
          rememberTheSession("signed-out");
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
