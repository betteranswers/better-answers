import type { Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";

import { CodeRefused } from "./auth-hooks.ts";
import { DeviceRefused, isCancelled } from "./passkey-hooks.ts";
import {
  PASSKEY_SIGN_IN_NOT_VERIFIED,
  PASSKEY_SIGN_IN_REFUSED,
  PASSKEY_UNKNOWN,
  SIGN_IN_UNANSWERED,
  tooManyPasskeySignIns,
} from "./refusal-words.ts";
import { SIGN_IN_WORDS } from "./sign-in-words.ts";

const TOO_MANY_REQUESTS = 429;

const SAID_OF_THE_ROUTE: ReadonlyMap<string, Said> = new Map([
  ["passkey-unknown", PASSKEY_UNKNOWN],
  ["not-verified", PASSKEY_SIGN_IN_NOT_VERIFIED],
]);

const saidOfTheRoute = (refused: CodeRefused): Said =>
  refused.status === TOO_MANY_REQUESTS
    ? tooManyPasskeySignIns(refused.waitSeconds)
    : (SAID_OF_THE_ROUTE.get(refused.word ?? "") ?? PASSKEY_SIGN_IN_REFUSED);

const saidOfTheDevice = (refused: DeviceRefused): Said | undefined => {
  if (refused.reason === "cancelled") return undefined;
  return refused.reason === "unverified" ? PASSKEY_SIGN_IN_NOT_VERIFIED : PASSKEY_SIGN_IN_REFUSED;
};

/** A dismissed prompt is no refusal; the status line says no passkey was used. */
export const saidOfAPasskeySignIn = (failure: Error | null): Said | undefined => {
  if (failure === null) return undefined;
  if (failure instanceof DeviceRefused) return saidOfTheDevice(failure);
  return failure instanceof CodeRefused ? saidOfTheRoute(failure) : SIGN_IN_UNANSWERED;
};

export const saidWhileSigningInWithAPasskey = (
  pending: boolean,
  failure: Error | null,
): string | null => {
  if (pending) return SIGN_IN_WORDS.passkeyWaiting;
  return isCancelled(failure) ? SIGN_IN_WORDS.passkeyNotUsed : null;
};

/** Offered only where the browser can use a passkey; the email field's autofill offers it too. */
export function PasskeyAct(properties: {
  readonly pending: boolean;
  readonly onSignIn: () => void;
}) {
  return (
    <div className="mt-6">
      <p className="text-muted-foreground">{SIGN_IN_WORDS.or}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-2"
        disabled={properties.pending}
        onClick={properties.onSignIn}
      >
        {SIGN_IN_WORDS.passkey}
      </Button>
    </div>
  );
}
