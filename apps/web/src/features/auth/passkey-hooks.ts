import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  WebAuthnError,
  type AuthenticationResponseJSON,
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

const askedFor = <Options>() => z.custom<Options>((value) => challenged.safeParse(value).success);

const askedToAdd = askedFor<PublicKeyCredentialCreationOptionsJSON>();

const askedToSignIn = askedFor<PublicKeyCredentialRequestOptionsJSON>();

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

const askToSignIn = () => askOfOurRoute(SIGN_IN_OPTIONS_PATH, {}, askedToSignIn);

const signInWith = (response: AuthenticationResponseJSON): Promise<SignedIn> =>
  askOfOurRoute(SIGN_IN_PATH, { response }, signedInByPasskey);

const signInWithAPasskey = async (): Promise<SignedIn> => {
  const optionsJSON = await askToSignIn();
  const response = await startAuthentication({ optionsJSON }).catch((failure: Error) => {
    throw deviceRefusalOf(failure);
  });
  return signInWith(response);
};

/**
 * Nothing is said until the person picks a passkey: a browser with none to offer refuses the wait
 * in its own way.
 */
const chosenFromTheAutofill = async (
  live: () => boolean,
): Promise<AuthenticationResponseJSON | undefined> => {
  const offered = await browserSupportsWebAuthnAutofill().catch(() => false);
  if (!offered || !live()) return undefined;
  const optionsJSON = await askToSignIn().catch(() => undefined);
  if (optionsJSON === undefined || !live()) return undefined;
  return startAuthentication({ optionsJSON, useBrowserAutofill: true }).catch(() => undefined);
};

const signedInHere = (): void => {
  rememberTheSession("held");
  announceTheSignIn();
};

/**
 * A press cancels the autofill's wait, so a failed press arms it again; a refused pick does not,
 * as a device answering unasked would loop.
 */
export const usePasskeySignIn = (armed: boolean, onSignedIn: (signedIn: SignedIn) => void) => {
  const [round, setRound] = useState(0);
  const [lastFailure, setLastFailure] = useState<Error | null>(null);
  const pressed = useMutation({
    mutationFn: signInWithAPasskey,
    onSuccess: (signedIn) => {
      signedInHere();
      onSignedIn(signedIn);
    },
    onError: (failure) => {
      setLastFailure(failure);
      setRound((last) => last + 1);
    },
  });

  const autofilled = useEffectEvent((signedIn: SignedIn) => {
    signedInHere();
    onSignedIn(signedIn);
  });

  const autofillFailed = useEffectEvent((failure: Error) => {
    setLastFailure(failure);
  });

  useEffect(() => {
    if (!armed) return undefined;
    const disarmed = new AbortController();
    const live = (): boolean => !disarmed.signal.aborted;
    const waitOnTheAutofill = async () => {
      const response = await chosenFromTheAutofill(live);
      if (response === undefined || !live()) return;
      const signedIn = await signInWith(response);
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
      setLastFailure(null);
      pressed.mutate();
    },
    pending: pressed.isPending || pressed.isSuccess,
    failure: lastFailure,
    reset: () => {
      setLastFailure(null);
      pressed.reset();
    },
  };
};
