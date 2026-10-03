import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import { z } from "zod";

import { useTRPC } from "@/shared/api/trpc.ts";

import { askOfOurRoute, type SignedIn } from "./auth-hooks.ts";
import { useRereadTheSecondFactor } from "./second-factor-hooks.ts";
import { announceTheSignIn, rememberTheSession } from "./session-memory.ts";

const ADD_OPTIONS_PATH = "/passkeys/add-options";

const ADD_PATH = "/passkeys/add";

const SIGN_IN_OPTIONS_PATH = "/passkeys/sign-in-options";

const SIGN_IN_PATH = "/passkeys/sign-in";

/** Whether this browser can make or use a passkey at all. */
export const passkeysHere = (): boolean => browserSupportsWebAuthn();

export type DeviceRefusal = "cancelled" | "held" | "unverified" | "failed";

/** The device answered without a passkey: the person cancelled, or it could not do the asking. */
export class DeviceRefused extends Error {
  readonly reason: DeviceRefusal;

  constructor(reason: DeviceRefusal) {
    super(`the device refused: ${reason}`);
    this.name = "DeviceRefused";
    this.reason = reason;
  }
}

/** A closed prompt and a timed-out one look alike to a page, so both read as cancelled. */
const REASONS: ReadonlyMap<string, DeviceRefusal> = new Map([
  ["ERROR_CEREMONY_ABORTED", "cancelled"],
  ["ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "cancelled"],
  ["ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", "held"],
  ["ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT", "unverified"],
]);

const deviceRefusalOf = (failure: Error): DeviceRefused =>
  new DeviceRefused(
    failure instanceof WebAuthnError ? (REASONS.get(failure.code) ?? "failed") : "failed",
  );

export const isCancelled = (failure: Error | null | undefined): boolean =>
  failure instanceof DeviceRefused && failure.reason === "cancelled";

/** The library checks every value; this reads only what tells an ask from anything else. */
const challenged = z.object({ challenge: z.string() });

const askedToAdd = z.custom<PublicKeyCredentialCreationOptionsJSON>(
  (value) => challenged.safeParse(value).success,
);

const askedToSignIn = z.custom<PublicKeyCredentialRequestOptionsJSON>(
  (value) => challenged.safeParse(value).success,
);

/** Null when the person already held codes, which an add leaves standing. */
const passkeyAdded = z.union([
  z.object({ passkeyId: z.string(), recoveryCodes: z.array(z.string()), madeAt: z.iso.datetime() }),
  z.object({ passkeyId: z.string(), recoveryCodes: z.null() }),
]);

export type PasskeyAdded = z.output<typeof passkeyAdded>;

const addAPasskey = async (name: string): Promise<PasskeyAdded> => {
  const optionsJSON = await askOfOurRoute(ADD_OPTIONS_PATH, { name }, askedToAdd);
  const response = await startRegistration({ optionsJSON }).catch((failure: Error) => {
    throw deviceRefusalOf(failure);
  });
  return askOfOurRoute(ADD_PATH, { name, response }, passkeyAdded);
};

/**
 * Codes show once, so the add hands them over before the page reads again, even if the form has
 * closed.
 */
export const useAddPasskey = (onAdded: (added: PasskeyAdded, name: string) => void) => {
  const reread = useRereadTheSecondFactor();
  return useMutation({
    mutationFn: addAPasskey,
    onSuccess: async (added, name) => {
      onAdded(added, name);
      await reread();
    },
  });
};

export const useRenamePasskey = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.renamePasskey.mutationOptions({ onSettled: reread }));
};

export const useRemovePasskey = () => {
  const api = useTRPC();
  const reread = useRereadTheSecondFactor();
  return useMutation(api.person.removePasskey.mutationOptions({ onSettled: reread }));
};

/** The offer goes as it is dismissed; a dismissal that fails offers it again on the next read. */
export const useDismissPasskeyOffer = () => {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const read = api.person.secondFactor;
  return useMutation(
    api.person.dismissPasskeyOffer.mutationOptions({
      onMutate: () => {
        queryClient.setQueryData(read.queryKey(), (held) =>
          held === undefined ? held : { ...held, passkeyOfferDismissed: true },
        );
      },
    }),
  );
};

const signedInByPasskey = z.object({ displayNameGiven: z.boolean() });

const signInWithAPasskey = async (autofill: boolean): Promise<SignedIn> => {
  const optionsJSON = await askOfOurRoute(SIGN_IN_OPTIONS_PATH, {}, askedToSignIn);
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill }).catch(
    (failure: Error) => {
      throw deviceRefusalOf(failure);
    },
  );
  return askOfOurRoute(SIGN_IN_PATH, { response }, signedInByPasskey);
};

const signedInHere = (): void => {
  rememberTheSession("held");
  announceTheSignIn();
};

/**
 * Autofill waits on the email field while `armed`; a press cancels that wait, so a press that
 * fails arms it again.
 */
export const usePasskeySignIn = (armed: boolean, onSignedIn: (signedIn: SignedIn) => void) => {
  const [round, setRound] = useState(0);
  const [autofillFailure, setAutofillFailure] = useState<Error | undefined>(undefined);
  const pressed = useMutation({
    mutationFn: () => signInWithAPasskey(false),
    onSuccess: (signedIn) => {
      signedInHere();
      onSignedIn(signedIn);
    },
    onError: () => {
      setRound((last) => last + 1);
    },
  });

  const autofilled = useEffectEvent((signedIn: SignedIn) => {
    signedInHere();
    onSignedIn(signedIn);
  });

  const autofillFailed = useEffectEvent((failure: Error) => {
    if (!isCancelled(failure)) setAutofillFailure(failure);
  });

  useEffect(() => {
    if (!armed) return undefined;
    const disarmed = new AbortController();
    const live = (): boolean => !disarmed.signal.aborted;
    const waitOnTheAutofill = async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !live()) return;
      const signedIn = await signInWithAPasskey(true);
      if (live()) autofilled(signedIn);
    };
    waitOnTheAutofill().catch((failure: Error) => {
      if (live()) autofillFailed(failure);
    });
    return () => {
      disarmed.abort();
      WebAuthnAbortService.cancelCeremony();
    };
  }, [armed, round]);

  return {
    signIn: () => {
      setAutofillFailure(undefined);
      pressed.mutate();
    },
    pending: pressed.isPending || pressed.isSuccess,
    failure: pressed.error ?? autofillFailure ?? null,
    reset: () => {
      setAutofillFailure(undefined);
      pressed.reset();
    },
  };
};
