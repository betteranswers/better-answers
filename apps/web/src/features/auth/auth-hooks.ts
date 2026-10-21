import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import {
  hashKey,
  matchQuery,
  mutationOptions,
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { inferOutput } from "@trpc/tanstack-react-query";
import type { BetterFetchError } from "better-auth/client";
import { useState } from "react";
import { z } from "zod";

import { useTRPC, type ApiProxy } from "@/shared/api/trpc.ts";
import {
  forgetMember,
  leftFor,
  memberChanged,
  memberOptions,
  workspaceHeld,
} from "@/shared/member.ts";

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
import { factorStepDue } from "./second-factor-steps.ts";
import {
  forgetTheUnsavedChange,
  rememberTheSession,
  sessionRemembered,
  signedInHere,
} from "./session-memory.ts";
import type { Arrival } from "./sign-in-words.ts";

const AUTH_KEYS = {
  all: ["auth"],
  session: ["auth", "session"],
} as const;

const unwrap = async <TData, TError>(
  call: Promise<{ data: TData; error: TError | null }>,
): Promise<TData> => {
  const { data, error } = await call;
  if (error !== null) throw error;
  return data;
};

const theWorkspaceList = (api: ApiProxy) => api.person.workspaces.pathFilter();

type WorkspacesHeld = inferOutput<ApiProxy["person"]["workspaces"]>;

const withTheRole = (held: WorkspacesHeld) =>
  held.map(({ workspace, role }) => ({ ...workspace, role }));

export const useWorkspacesHeld = (asked = true) => {
  const api = useTRPC();
  return useQuery(
    api.person.workspaces.queryOptions(undefined, { enabled: asked, select: withTheRole }),
  );
};

const wholeSeconds = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((seconds) => Number(seconds));

const waitNamedBy = (response: Response): number | undefined =>
  wholeSeconds.safeParse(response.headers.get("retry-after")).data;

const SERVER_FAILED = 500;

export const SIGNED_OUT = 401;

export const TOO_MANY_REQUESTS = 429;

export class CodeRefused extends Error {
  readonly status: number;
  readonly waitSeconds: number | undefined;
  readonly libraryCode: string | undefined;

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
 * The Better Auth client's error drops the response's headers, so the wait is read as the response lands. A
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

const ASKED_AGAIN_AT_MOST = 2;

const askedAgainUnlessRefused = (failures: number, failure: Error): boolean =>
  !(failure instanceof CodeRefused) && failures < ASKED_AGAIN_AT_MOST;

const hasADisplayName = (name: string): boolean => name.trim() !== "";

type Session = {
  readonly id: string;
  readonly address: string;
  readonly displayName: string | undefined;
  readonly workspaceId: string | undefined;
};

export type SessionStanding =
  | { readonly standing: "reading" }
  | { readonly standing: "unread" }
  | { readonly standing: "signed-out" }
  | { readonly standing: "signed-in"; readonly session: Session };

type SessionAnswer = {
  readonly session: {
    readonly id: string;
    readonly activeOrganizationId?: string | null | undefined;
  };
  readonly user: { readonly email: string; readonly name: string };
} | null;

const sessionOf = (answer: SessionAnswer): Session | null =>
  answer === null
    ? null
    : {
        id: answer.session.id,
        address: answer.user.email,
        displayName: hasADisplayName(answer.user.name) ? answer.user.name : undefined,
        workspaceId: answer.session.activeOrganizationId ?? undefined,
      };

const sessionOptions = () =>
  queryOptions({
    queryKey: AUTH_KEYS.session,
    queryFn: () => unwrapWithTheWait((reading) => authClient.getSession({ fetchOptions: reading })),
    retry: askedAgainUnlessRefused,
  });

const standingOf = (read: {
  readonly isPending: boolean;
  readonly data: Session | null | undefined;
}): SessionStanding => {
  if (read.isPending) return { standing: "reading" };
  if (read.data === undefined) return { standing: "unread" };
  return read.data === null
    ? { standing: "signed-out" }
    : { standing: "signed-in", session: read.data };
};

export const addressOf = (read: SessionStanding): string =>
  read.standing === "signed-in" ? read.session.address : "";

const theSession = () => ({ ...sessionOptions(), select: sessionOf });

export const useSession = (): SessionStanding => standingOf(useQuery(theSession()));

/** A failed reread says nothing of the session now, even while the cache keeps an older answer. */
export const useSessionReread = (): (() => Promise<SessionStanding>) => {
  const { refetch } = useQuery(theSession());
  return () => refetch().then((read) => (read.isError ? { standing: "unread" } : standingOf(read)));
};

const returnPathOf = (query: string): { readonly redirect?: string } => {
  const redirect = new URLSearchParams(query).get("redirect");
  return redirect === null ? {} : { redirect };
};

type CodeAsked = { email: string; type: "sign-in" };

const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, Error, CodeAsked>({
    mutationFn: (input) =>
      unwrapWithTheWait((reading) =>
        authClient.emailOtp.sendVerificationOtp(
          { ...input, ...returnPathOf(pageQuery()) },
          reading,
        ),
      ),
  });

export const useSendVerificationOtp = (): UseMutationResult<unknown, Error, CodeAsked> =>
  useMutation(sendVerificationOtpOptions());

export type SignedIn = { readonly displayNameGiven: boolean };

type CodeGiven = { email: string; otp: string };

const signInEmailOtpOptions = () =>
  mutationOptions<SignedIn, Error, CodeGiven>({
    mutationFn: async (input) => {
      const answer = await unwrapWithTheWait((reading) =>
        authClient.signIn.emailOtp(input, reading),
      );
      return { displayNameGiven: answer !== null && hasADisplayName(answer.user.name) };
    },
    onSuccess: signedInHere,
  });

export const useSignInEmailOtp = (): UseMutationResult<SignedIn, Error, CodeGiven> =>
  useMutation(signInEmailOtpOptions());

const LINK_TOKEN = /^#([A-Za-z0-9]{1,128})$/;

export const linkTokenOnThisPage = (): string | undefined =>
  LINK_TOKEN.exec(globalThis.location.hash)?.[1];

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

type RouteBody =
  | Readonly<Record<string, string>>
  | { readonly name: string; readonly response: RegistrationResponseJSON }
  | { readonly response: AuthenticationResponseJSON };

const refusalWord = z.object({ error: z.string() });

const wordOf = async (answered: Response): Promise<string | undefined> =>
  refusalWord.safeParse(await answered.json().catch(() => undefined)).data?.error;

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
    retry: askedAgainUnlessRefused,
  });

const signedInByLink = z.object({ displayNameGiven: z.boolean(), carried: z.string() });

export type SignedInByLink = z.infer<typeof signedInByLink>;

const signInByLinkOptions = () =>
  mutationOptions<SignedInByLink, Error, string>({
    mutationFn: (token) => askOfOurRoute("/sign-in-link/sign-in", { token }, signedInByLink),
    onSuccess: signedInHere,
  });

export const useSignInByLink = () => useMutation(signInByLinkOptions());

const ARRIVAL_AFTER = {
  held: "session-ended",
  pending: "confirm-timed-out",
  "signed-out": "signed-out",
} as const satisfies Record<NonNullable<ReturnType<typeof sessionRemembered>>, Arrival>;

export const useArrival = (): Arrival | undefined => {
  const [remembered] = useState(sessionRemembered);
  const session = useQuery({ ...sessionOptions(), enabled: remembered !== undefined });
  if (remembered === undefined || session.data !== null) return undefined;
  return ARRIVAL_AFTER[remembered];
};

const sessionOrUnread = (queryClient: QueryClient) =>
  queryClient.fetchQuery(sessionOptions()).catch(() => undefined);

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

export const signedOutDetour = async (
  queryClient: QueryClient,
  path: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  return session === null ? backTo("/sign-in", path) : undefined;
};

export const signedOutOfAStep = async (
  queryClient: QueryClient,
  query: string,
): Promise<string | undefined> => {
  const session = await sessionOrUnread(queryClient);
  return session === null ? `/sign-in${query}` : undefined;
};

export const rereadTheSession = (queryClient: QueryClient): Promise<void> =>
  queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session });

export const useSetDisplayName = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  return useMutation(
    api.person.setDisplayName.mutationOptions({
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: AUTH_KEYS.session });
      },
    }),
  );
};

export const useAcceptInvitation = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation(
    api.person.acceptInvitation.mutationOptions({
      onSuccess: () => {
        forgetMember(queryClient, api);
        forgetTheWorkspaceLeft(queryClient, api);
        queryClient.removeQueries({ queryKey: AUTH_KEYS.session });
        queryClient.removeQueries(theWorkspaceList(api));
        void navigate(leavingFor(nextAfterJoining(pageQuery())));
      },
    }),
  );
};

const signOutOptions = () =>
  mutationOptions<unknown, Error, void>({
    mutationFn: () => unwrapWithTheWait((reading) => authClient.signOut({ fetchOptions: reading })),
  });

type SigningOut = {
  readonly signingOut: boolean;
  readonly failure: Error | null;
  readonly signOut: () => void;
};

export const useSignOut = (returnTo?: string): SigningOut => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation(signOutOptions());

  return {
    signingOut: signOut.isPending,
    failure: signOut.error,
    signOut: () => {
      if (signOut.isPending) return;
      const keepTheCarriedFlow = dropTheCarriedFlow();
      signOut.mutate(undefined, {
        onError: keepTheCarriedFlow,
        onSuccess: () => {
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

const notAMember = z.object({ code: z.literal("USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION") });

const libraryCode = z.object({ code: z.string() });

export class SwitchRefused extends Error {
  readonly noLongerAMember: boolean;

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
      const { success: noLongerAMember } = notAMember.safeParse(refused);
      throw new SwitchRefused(noLongerAMember, libraryCode.safeParse(refused).data?.code);
    },
  );

type WorkspacePicked = { organizationId: string };

const setActiveOrganizationOptions = () =>
  mutationOptions<unknown, SwitchRefused, WorkspacePicked>({
    mutationFn: (input) => setActiveWorkspace(input.organizationId),
  });

const aboutTheWorkspace = (api: ApiProxy) => {
  const theirOwn = [
    { queryKey: AUTH_KEYS.all },
    api.session.pathFilter(),
    api.console.pathFilter(),
    theWorkspaceList(api),
  ];
  return (query: Query) => !theirOwn.some((filters) => matchQuery(filters, query));
};

const forgetTheWorkspaceLeft = (queryClient: QueryClient, api: ApiProxy) => {
  queryClient.removeQueries({ predicate: aboutTheWorkspace(api) });
};

export const forgetAWorkspaceLeftElsewhere = (queryClient: QueryClient, api: ApiProxy): void => {
  const memberHash = hashKey(memberOptions(api).queryKey);
  let held = workspaceHeld(queryClient, api);
  queryClient.getQueryCache().subscribe(({ query }) => {
    if (query.queryHash !== memberHash) return;
    const was = held;
    held = workspaceHeld(queryClient, api);
    if (leftFor(was, held)) forgetTheWorkspaceLeft(queryClient, api);
  });
};

export const useSetActiveOrganization = (): UseMutationResult<
  unknown,
  SwitchRefused,
  WorkspacePicked
> => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  return useMutation({
    ...setActiveOrganizationOptions(),
    onSuccess: () => {
      forgetMember(queryClient, api);
      forgetTheWorkspaceLeft(queryClient, api);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session }),
        queryClient.invalidateQueries(theWorkspaceList(api)),
      ]);
    },
  });
};

export type SwitchedTo = { readonly id: string; readonly name: string };

export const followTheSession = async (queryClient: QueryClient, api: ApiProxy): Promise<void> => {
  forgetTheWorkspaceLeft(queryClient, api);
  await memberChanged(queryClient, api, { readAgain: true, ifUnread: "reset" });
  void queryClient.invalidateQueries({ queryKey: AUTH_KEYS.session });
};

export const useSwitchWorkspace = (): UseMutationResult<unknown, SwitchRefused, SwitchedTo> => {
  const queryClient = useQueryClient();
  const api = useTRPC();
  const navigate = useNavigate();
  return useMutation<unknown, SwitchRefused, SwitchedTo>({
    mutationFn: (workspace) => setActiveWorkspace(workspace.id),
    onSuccess: async () => {
      await followTheSession(queryClient, api);
      await navigate({ href: "/", replace: true });
    },
  });
};

/** The Better Auth client plugin types this answer as `any`, so its shape is read where it lands. */
const resumeAnswer = z.object({ redirect: z.boolean().optional(), url: z.string().optional() });
export type ResumeAnswer = z.infer<typeof resumeAnswer>;

type ResumeAsked = { postLogin: true };

const oauthContinueOptions = () =>
  mutationOptions<ResumeAnswer, Error, ResumeAsked>({
    mutationFn: async (input) => {
      const { data, error } = await authClient.oauth2.continue(input);
      if (error !== null) {
        throw Object.assign(new Error(`answered ${String(error.status)}`), { code: error.code });
      }
      return resumeAnswer.parse(data);
    },
  });

export const useOAuthContinue = (): UseMutationResult<ResumeAnswer, Error, ResumeAsked> =>
  useMutation(oauthContinueOptions());
