import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import {
  matchQuery,
  mutationOptions,
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { BetterFetchError } from "better-auth/client";
import { useState } from "react";
import { z } from "zod";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";

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
import { forgetMembership, rereadMembership } from "./membership.ts";
import { factorStepDue } from "./second-factor-steps.ts";
import {
  announceTheSignIn,
  forgetTheUnsavedChange,
  rememberTheSession,
  sessionRemembered,
} from "./session-memory.ts";
import type { Arrival } from "./sign-in-words.ts";

const AUTH_KEYS = {
  all: ["auth"],
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

/** `asked` false reads nothing yet, for a list shown only once a menu opens. */
export const useListOrganizations = (asked = true) =>
  useQuery({ ...listOrganizationsOptions(), enabled: asked });

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

/** The two refusals our own routes answer by status alone. */
export const SIGNED_OUT = 401;

export const TOO_MANY_REQUESTS = 429;

/** The api refused a code's send or its check, by form or by link, with the wait a ceiling named. */
export class CodeRefused extends Error {
  readonly status: number;
  readonly waitSeconds: number | undefined;
  readonly libraryCode: string | undefined;

  /** The refusal's word, when one of our own routes named it. */
  readonly word: string | undefined;

  constructor(
    status: number,
    waitSeconds: number | undefined,
    libraryCode?: string,
    word?: string,
  ) {
    super(`answered ${String(status)}`);
    this.name = "CodeRefused";
    this.status = status;
    this.waitSeconds = waitSeconds;
    this.libraryCode = libraryCode;
    this.word = word;
  }
}

export const isTooMany = (failure: Error | null): failure is CodeRefused =>
  failure instanceof CodeRefused && failure.status === TOO_MANY_REQUESTS;

type WaitReading = { readonly onError: (context: { readonly response: Response }) => void };

/**
 * The client's error drops the response's headers, so the wait is read as the response lands. A
 * server's failure is no refusal.
 */
const unwrapWithTheWait = async <TData>(
  call: (
    reading: WaitReading,
  ) => Promise<{ data: TData; error: { status: number; code?: string | undefined } | null }>,
): Promise<TData> => {
  let waitSeconds: number | undefined;
  const { data, error } = await call({
    onError: ({ response }) => {
      waitSeconds = waitNamedBy(response);
    },
  });
  if (error === null) return data;
  if (error.status >= SERVER_FAILED) throw new Error(`answered ${String(error.status)}`);
  throw new CodeRefused(error.status, waitSeconds, error.code);
};

/** Sealed into the email's link, so a sign-in through it returns where this page would. */
const returnPathOf = (query: string): { readonly redirect?: string } => {
  const redirect = new URLSearchParams(query).get("redirect");
  return redirect === null ? {} : { redirect };
};

const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, Error, { email: string; type: "sign-in" }>({
    mutationFn: (input) =>
      unwrapWithTheWait((reading) =>
        authClient.emailOtp.sendVerificationOtp(
          { ...input, ...returnPathOf(pageQuery()) },
          reading,
        ),
      ),
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
      announceTheSignIn();
    },
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

/** The shape the api accepts, not the one it mints, so a change of length never reads as no link. */
const LINK_TOKEN = /^#([A-Za-z0-9]{1,128})$/;

export const linkTokenOnThisPage = (): string | undefined =>
  LINK_TOKEN.exec(globalThis.location.hash)?.[1];

/** History keeps its state, so the router's key for this entry survives. */
export const dropTheLinkToken = (): void => {
  const { hash, pathname, search } = globalThis.location;
  if (hash === "") return;
  globalThis.history.replaceState(globalThis.history.state, "", `${pathname}${search}`);
};

const linkDescribed = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("bound"),
    address: z.string(),
    carried: z.string(),
  }),
  z.object({ state: z.literal("elsewhere"), code: z.string(), until: z.string() }),
  z.object({ state: z.literal("dead") }),
]);

export type LinkDescribed = z.infer<typeof linkDescribed>;

/** Strings, or the browser's own answer to a passkey's ask. */
type RouteBody =
  | Readonly<Record<string, string>>
  | { readonly name: string; readonly response: RegistrationResponseJSON }
  | { readonly response: AuthenticationResponseJSON };

const refusalWord = z.object({ error: z.string() });

/** The word a route's refusal names, if its answer names one. */
const wordOf = async (answered: Response): Promise<string | undefined> =>
  refusalWord.safeParse(await answered.json().catch(() => undefined)).data?.error;

/** Neither Better Auth's nor tRPC's, so a ceiling's wait is read off the answer here. */
export const askOfOurRoute = async <T>(
  path: string,
  body: RouteBody,
  answer: z.ZodType<T>,
): Promise<T> => {
  const answered = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (answered.status >= SERVER_FAILED) throw new Error(`answered ${String(answered.status)}`);
  if (!answered.ok) {
    throw new CodeRefused(
      answered.status,
      waitNamedBy(answered),
      undefined,
      await wordOf(answered),
    );
  }
  return answer.parse(await answered.json());
};

const ASKED_AGAIN_AT_MOST = 2;

/** Each read spends the link's ceiling, and a failed read stays stale, so only Read again reads twice. */
export const useDescribeTheLink = (token: string | undefined, reading: boolean) =>
  useQuery({
    queryKey: [...AUTH_KEYS.all, "link", token],
    queryFn:
      token === undefined
        ? skipToken
        : () => askOfOurRoute("/sign-in-link/describe", { token }, linkDescribed),
    enabled: reading,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    retry: (failures, failure) =>
      !(failure instanceof CodeRefused) && failures < ASKED_AGAIN_AT_MOST,
  });

const signedInByLink = z.object({ displayNameGiven: z.boolean(), carried: z.string() });

export type SignedInByLink = z.infer<typeof signedInByLink>;

const signInByLinkOptions = () =>
  mutationOptions<SignedInByLink, Error, string>({
    mutationFn: (token) => askOfOurRoute("/sign-in-link/sign-in", { token }, signedInByLink),
    onSuccess: () => {
      rememberTheSession("held");
      announceTheSignIn();
    },
  });

export const useSignInByLink = () => useMutation(signInByLinkOptions());

/** A session left pending ended on its hour; one confirmed or never pending just ended. */
const ARRIVAL_AFTER = {
  held: "session-ended",
  pending: "confirm-timed-out",
  "signed-out": "signed-out",
} as const satisfies Record<NonNullable<ReturnType<typeof sessionRemembered>>, Arrival>;

/**
 * Said only once the api reads no session: a failed sign-out, or a visit while signed in, leaves
 * one standing.
 */
export const useArrival = (): Arrival | undefined => {
  const [remembered] = useState(sessionRemembered);
  const session = useQuery({ ...sessionOptions(), enabled: remembered !== undefined });
  if (remembered === undefined || session.data !== null) return undefined;
  return ARRIVAL_AFTER[remembered];
};

/**
 * Undefined when unread: the screen then stands, and its own next request says in words what went
 * wrong.
 */
const sessionOrUnread = (queryClient: QueryClient) =>
  queryClient.fetchQuery(sessionOptions()).catch(() => undefined);

/**
 * Read before the screen draws, so a person it has nothing to ask never sees it; an invitation
 * asks its invitee's name.
 */
export const displayNameDetour = async (
  queryClient: QueryClient,
  api: ApiProxy,
  query: string,
): Promise<string | undefined> => {
  const due = await factorStepDue(queryClient, api, query);
  if (due !== undefined) return due;
  const session = await sessionOrUnread(queryClient);
  if (session === undefined) return undefined;
  if (session === null) return `/sign-in${query}`;
  const next = nextAfterSignIn(query);
  return hasADisplayName(session.user.name) || isAnInvitation(next) ? next : undefined;
};

/** Only a signed-out visitor is sent on, to sign in and come back to `path`. Undefined: it draws. */
export const signedOutDetour = async (
  queryClient: QueryClient,
  path: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  return session === null ? backTo("/sign-in", path) : undefined;
};

/** A step's query already names where the person returns, so sign-in keeps it whole. */
export const signedOutOfAStep = async (
  queryClient: QueryClient,
  query: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  return session === null ? `/sign-in${query}` : undefined;
};

/** Read again rather than dropped, for a screen that shows whose session it is. */
export const rereadTheSession = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session });

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
 * A join points the session at the workspace joined, so what is held of the workspace left is
 * dropped before the shell reads it.
 */
export const useAcceptInvitation = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation(
    api.person.acceptInvitation.mutationOptions({
      onSuccess: () => {
        forgetMembership(queryClient, api);
        forgetTheWorkspaceLeft(queryClient, api);
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
          forgetTheUnsavedChange();
          const href = returnTo === undefined ? "/sign-in" : backTo("/sign-in", returnTo);
          void navigate({ href, replace: true });
        },
      });
    },
  };
};

/** Better Auth's code for a pick of a workspace the person holds no membership in. */
const noMembership = z.object({ code: z.literal("USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION") });

const libraryCode = z.object({ code: z.string() });

/** A refused switch or pick in the platform's terms, so no screen reads the provider's error. */
export class SwitchRefused extends Error {
  readonly noLongerAMember: boolean;

  /** The library's own, so a pending refusal heard app-wide is still told apart. */
  readonly code: string | undefined;

  constructor(noLongerAMember: boolean, code?: string) {
    super(noLongerAMember ? "no longer a member" : "switch refused");
    this.name = "SwitchRefused";
    this.noLongerAMember = noLongerAMember;
    this.code = code;
  }
}

const setActiveWorkspace = (organizationId: string) =>
  unwrap(authClient.organization.setActive({ organizationId })).catch(
    (refused: BetterFetchError) => {
      const { success: noLongerAMember } = noMembership.safeParse(refused);
      throw new SwitchRefused(noLongerAMember, libraryCode.safeParse(refused).data?.code);
    },
  );

const setActiveOrganizationOptions = () =>
  mutationOptions<unknown, SwitchRefused, { organizationId: string }>({
    mutationFn: (input) => setActiveWorkspace(input.organizationId),
  });

/**
 * The session's and the console's reads belong to no workspace, so a switch keeps them. Naming
 * these fails safe: one left off is read again.
 */
const aboutTheWorkspace = (api: ApiProxy) => {
  const theirOwn = [
    { queryKey: AUTH_KEYS.all },
    api.session.pathFilter(),
    api.console.pathFilter(),
  ];
  return (query: Query) => !theirOwn.some((filters) => matchQuery(filters, query));
};

/**
 * Some reads, such as the members, name no workspace in their key, so a held answer is the left
 * workspace's.
 */
const forgetTheWorkspaceLeft = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ predicate: aboutTheWorkspace(api) });
};

/**
 * A pick drops the held membership and every read of the workspace left, and marks the held
 * session and workspace list stale.
 */
export const useSetActiveOrganization = () => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  return useMutation({
    ...setActiveOrganizationOptions(),
    onSuccess: () => {
      forgetMembership(queryClient, api);
      forgetTheWorkspaceLeft(queryClient, api);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.workspaces }),
      ]);
    },
  });
};

export type SwitchedTo = { readonly id: string; readonly name: string };

/**
 * The membership is read again in place, not dropped, so the band blanks between the two only
 * when that read fails or waits.
 */
export const useSwitchWorkspace = () => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  const navigate = useNavigate();
  return useMutation<unknown, SwitchRefused, SwitchedTo>({
    mutationFn: (workspace) => setActiveWorkspace(workspace.id),
    onSuccess: async () => {
      forgetTheWorkspaceLeft(queryClient, api);
      await rereadMembership(queryClient, api);
      void queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session });
      await navigate({ href: "/", replace: true });
    },
  });
};

/** The client plugin types this answer as `any`, so its shape is read where it lands. */
const resumeAnswer = z.object({ redirect: z.boolean().optional(), url: z.string().optional() });
export type ResumeAnswer = z.infer<typeof resumeAnswer>;

const oauthContinueOptions = () =>
  mutationOptions<ResumeAnswer, Error, { postLogin: true }>({
    mutationFn: async (input) => {
      const { data, error } = await authClient.oauth2.continue(input);
      if (error !== null) {
        // The library's code rides along, so a pending refusal heard app-wide is still told apart.
        throw Object.assign(new Error(`answered ${String(error.status)}`), { code: error.code });
      }
      return resumeAnswer.parse(data);
    },
  });

export const useOAuthContinue = () => useMutation(oauthContinueOptions());
