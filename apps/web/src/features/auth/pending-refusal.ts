import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { FailedDuring } from "@/shared/api/query-client.ts";
import { refusalOf, type ApiProxy } from "@/shared/api/trpc.ts";

import { CodeRefused, SIGNED_OUT } from "./auth-hooks.ts";
import { SECOND_FACTOR_PENDING } from "./member.ts";
import {
  CONFIRM_STEP,
  confirmDetour,
  RECOVERY_STEP,
  SETUP_STEP,
  type LeftFrom,
} from "./second-factor-steps.ts";
import { rememberAChangeUnsaved } from "./session-memory.ts";

/** The auth library answers with the word as its code, in a plain object rather than an error. */
const refusedByTheLibrary = z.object({ code: z.literal(SECOND_FACTOR_PENDING) });

/** tRPC's refusal, our own routes' and the auth library's alike. */
const isPendingRefusal = (failure: Error): boolean =>
  refusalOf(failure)?.word === SECOND_FACTOR_PENDING ||
  (failure instanceof CodeRefused && failure.word === SECOND_FACTOR_PENDING) ||
  refusedByTheLibrary.safeParse(failure).success;

const isSignedOut = (failure: Error): boolean =>
  refusalOf(failure)?.class === "unauthenticated" ||
  (failure instanceof CodeRefused && failure.status === SIGNED_OUT);

const PENDING_PAGES: readonly string[] = [CONFIRM_STEP, RECOVERY_STEP, SETUP_STEP];

const onAPendingPage = (pathname: string): boolean => PENDING_PAGES.includes(pathname);

export type HeardAt = LeftFrom & { readonly pathname: string };

/**
 * Undefined: the failure is the page's own to say. A pending page's query already names where the
 * person returns, so sign-in keeps it.
 */
export const detourAfter = async (
  failure: Error,
  during: FailedDuring,
  at: HeardAt,
  reading: { readonly queryClient: QueryClient; readonly api: ApiProxy },
): Promise<string | undefined> => {
  if (onAPendingPage(at.pathname)) return isSignedOut(failure) ? `/sign-in${at.query}` : undefined;
  if (!isPendingRefusal(failure)) return undefined;
  if (during === "action") rememberAChangeUnsaved(at.pathname);
  return confirmDetour(reading.queryClient, reading.api, at);
};
