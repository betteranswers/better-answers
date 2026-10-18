import type { QueryClient } from "@tanstack/react-query";
import { z } from "zod";

import type { FailedDuring } from "@/shared/api/query-client.ts";
import { refusalOf, type ApiProxy } from "@/shared/api/trpc.ts";
import { SECOND_FACTOR_PENDING } from "@/shared/member.ts";

import { CodeRefused, SIGNED_OUT } from "./auth-hooks.ts";
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
