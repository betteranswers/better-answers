import { mutationOptions, useMutation } from "@tanstack/react-query";
import type { BetterFetchError } from "better-auth/client";

import { authClient } from "./auth-client.ts";

/**
 * The platform's own hooks over the module's `better-auth` client — TanStack Query
 * `mutationOptions` factories with thin hooks over them, the same shape the library's
 * hooks had underneath, minus the library (T-046 slice 1; the picker's hooks join in
 * slice 2, and the dependency leaves with its records in slice 3).
 *
 * Two contracts hold the seam:
 *
 * - The client answers `{ data, error }` rather than throwing. Each mutation throws the
 *   returned error object unchanged, so a screen's status branch — the sign-in screen's
 *   429 too-many-codes sentence — reads exactly what it read before. The error generic
 *   says `BetterFetchError`, the type the screens already read; the thrown value is the
 *   client's returned error object, which carries the same `status` field.
 * - Hooks close over the module's one `authClient` constant; there is no client argument.
 *   Every call site is inside this feature, so nothing outside it notices.
 *
 * No screen reads a mutation's returned data — they act on success and read errors — so
 * the factories leave that type `unknown`. Sign-in's and sign-out's whole-cache clears
 * are the screens' own acts and stay in the screens.
 */

/**
 * The module-owned query-key space. The session and workspace-list queries land under
 * these keys in slice 2 (T-050), and the pick's invalidations name them; founding the
 * space beside the mutations gives it one home for T-027 to extend.
 */
export const AUTH_KEYS = {
  session: ["auth", "session"],
  workspaces: ["auth", "workspaces"],
} as const;

/** Ask the api to email a six-digit sign-in code to an address. */
export const sendVerificationOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; type: "sign-in" }>({
    mutationFn: async (input) => {
      const { data, error } = await authClient.emailOtp.sendVerificationOtp(input);
      if (error !== null) throw error;
      return data;
    },
  });

export const useSendVerificationOtp = () => useMutation(sendVerificationOtpOptions());

/** Trade an emailed code for a session. */
export const signInEmailOtpOptions = () =>
  mutationOptions<unknown, BetterFetchError, { email: string; otp: string }>({
    mutationFn: async (input) => {
      const { data, error } = await authClient.signIn.emailOtp(input);
      if (error !== null) throw error;
      return data;
    },
  });

export const useSignInEmailOtp = () => useMutation(signInEmailOtpOptions());

/** End the session on the server; the browser-side clearing is the screen's act. */
export const signOutOptions = () =>
  mutationOptions<unknown, BetterFetchError, void>({
    mutationFn: async () => {
      const { data, error } = await authClient.signOut();
      if (error !== null) throw error;
      return data;
    },
  });

export const useSignOut = () => useMutation(signOutOptions());
