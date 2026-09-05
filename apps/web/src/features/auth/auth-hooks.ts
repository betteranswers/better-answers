import {
  mutationOptions,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { BetterFetchError } from "better-auth/client";

import { authClient } from "./auth-client.ts";

/**
 * The platform's own hooks over the module's `better-auth` client — TanStack Query
 * `queryOptions`/`mutationOptions` factories with thin hooks over them, the same shape
 * the library's hooks had underneath, minus the library (T-046).
 *
 * Two contracts hold the seam:
 *
 * - The client answers `{ data, error }` rather than throwing. Each query and mutation
 *   throws the returned error object unchanged, so a screen's status branch — the
 *   sign-in screen's 429 too-many-codes sentence — reads exactly what it read before.
 *   The error generic says `BetterFetchError`, the type the screens already read; the
 *   thrown value is the client's returned error object, which carries the same `status`
 *   field.
 * - Hooks close over the module's one `authClient` constant; there is no client argument.
 *   Every call site is inside this feature, so nothing outside it notices.
 *
 * The hooks keep the library's names so every call site inside the module reads the
 * same. No screen reads a sign-in or sign-out mutation's returned data — they act on
 * success and read errors — so those factories leave that type `unknown`; the resume is
 * the one exception, because the picker follows the address in its answer. Sign-in's and
 * sign-out's whole-cache clears are the screens' own acts and stay in the screens.
 */

/**
 * The module-owned query-key space. The session and workspace-list queries live under
 * these keys and the pick's invalidations name them; founding the space beside the
 * factories gives it one home for T-027 to extend.
 */
export const AUTH_KEYS = {
  session: ["auth", "session"],
  workspaces: ["auth", "workspaces"],
} as const;

/** The seam's one contract, in one place: throw the client's error object unchanged. */
const unwrap = async <TData, TError>(
  call: Promise<{ data: TData; error: TError | null }>,
): Promise<TData> => {
  const { data, error } = await call;
  if (error !== null) throw error;
  return data;
};

/** The session as the api answers it — `null` is a signed-out visit, not an error. */
export const sessionOptions = () =>
  queryOptions({
    queryKey: AUTH_KEYS.session,
    queryFn: () => unwrap(authClient.getSession()),
  });

export const useSession = () => useQuery(sessionOptions());

/** The workspaces the signed-in person holds a membership in. */
export const listOrganizationsOptions = () =>
  queryOptions({
    queryKey: AUTH_KEYS.workspaces,
    queryFn: () => unwrap(authClient.organization.list()),
  });

export const useListOrganizations = () => useQuery(listOrganizationsOptions());

/** Ask the api to email a six-digit sign-in code to an address. */
export const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; type: "sign-in" }>({
    mutationFn: (input) => unwrap(authClient.emailOtp.sendVerificationOtp(input)),
  });

export const useSendVerificationOtp = () => useMutation(sendVerificationOtpOptions());

/** Trade an emailed code for a session. */
export const signInEmailOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; otp: string }>({
    mutationFn: (input) => unwrap(authClient.signIn.emailOtp(input)),
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

/** End the session on the server; the browser-side clearing is the screen's act. */
export const signOutOptions = () =>
  mutationOptions<unknown, BetterFetchError, void>({
    mutationFn: () => unwrap(authClient.signOut()),
  });

export const useSignOut = () => useMutation(signOutOptions());

/** Make one workspace the session's active one. */
export const setActiveOrganizationOptions = () =>
  mutationOptions<unknown, BetterFetchError, { organizationId: string }>({
    mutationFn: (input) => unwrap(authClient.organization.setActive(input)),
  });

/**
 * The pick. Success changes what the session means, so the session and workspace-list
 * queries are invalidated — and the invalidation settles — before any per-call
 * `onSuccess` runs: the screen that carries the person on does so over a cache that no
 * longer says the old workspace.
 */
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

/**
 * What Better Auth answers a resumed authorization with: where the person goes next. The
 * shape is stated here because the client's own type for it is `any`, and the picker
 * that navigates somewhere should say what it read to decide.
 */
export type ResumeAnswer = { readonly redirect?: boolean; readonly url?: string };

/**
 * Resume a host's carried OAuth flow after sign-in. The signed query is not an argument:
 * the OAuth client plugin's own request hook reads it off the screen's address and
 * attaches it as `oauth_query`, and this mutation wraps the same client call, so that
 * transport behaviour rides along unchanged.
 */
export const oauthContinueOptions = () =>
  mutationOptions<ResumeAnswer, BetterFetchError, { postLogin: true }>({
    mutationFn: async (input) => {
      // SAFETY: the client plugin types this endpoint's answer as `any`; `ResumeAnswer`
      // states the two optional fields the api answers with, and the picker checks
      // `url` for presence and shape before following it.
      return (await unwrap(authClient.oauth2.continue(input))) as ResumeAnswer;
    },
  });

export const useOAuthContinue = () => useMutation(oauthContinueOptions());
