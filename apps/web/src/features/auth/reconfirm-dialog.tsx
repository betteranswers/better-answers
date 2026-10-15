import { useQuery } from "@tanstack/react-query";
import { useId, useSyncExternalStore } from "react";

import { type RefusedAct } from "@/shared/api/query-client.ts";
import { refusalOf, useTRPC } from "@/shared/api/trpc.ts";
import { stockWait } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog.tsx";

import { CodeRefused, isTooMany } from "./auth-hooks.ts";
import { AuthenticatorCodeField, isAWrongCode, useSixDigits } from "./authenticator-code.tsx";
import { useConfirmByAuthenticator, useConfirmByPasskey } from "./confirm-hooks.ts";
import { DeviceRefused, passkeysHere } from "./passkey-hooks.ts";
import { AUTHENTICATOR_CODE_WRONG, STALE_CONFIRMATION } from "./refusal-words.ts";
import { CONFIRM_WORDS } from "./second-factor-words.ts";

/** The refused act, kept whole: it runs again with its input once the confirmation lands. */
type Refused = RefusedAct;

let refused: Refused | undefined;

const hearing = new Set<() => void>();

const heard = (next: Refused | undefined): void => {
  refused = next;
  for (const hear of hearing) hear();
};

const askedAgain = (failure: Error): boolean =>
  refusalOf(failure)?.word === STALE_CONFIRMATION ||
  (failure instanceof CodeRefused && failure.word === STALE_CONFIRMATION);

/** Opens the re-confirm a stale confirmation asked for; false where the failure is another's to say. */
export const reconfirmAfter = (failure: Error, refusedAct: RefusedAct | undefined): boolean => {
  if (refusedAct === undefined || !askedAgain(failure)) return false;
  heard(refusedAct);
  return true;
};

export const cancelTheRefusedAct = (): void => heard(undefined);

const refusedActHeld = (): Refused | undefined => refused;

/** The act a stale confirmation refused, or none while no dialog is open. */
export const useTheRefusedAct = (): Refused | undefined =>
  useSyncExternalStore(
    (hear) => {
      hearing.add(hear);
      return () => {
        hearing.delete(hear);
      };
    },
    refusedActHeld,
    refusedActHeld,
  );

const SAID_OF_THE_DEVICE = {
  cancelled: undefined,
  held: CONFIRM_WORDS.passkeyNotUsed,
  unverified: CONFIRM_WORDS.passkeyNotUsed,
  failed: CONFIRM_WORDS.passkeyNotUsed,
} satisfies Record<DeviceRefused["reason"], string | undefined>;

/** The words of a passkey that did not confirm, in the dialog's own line. */
const saidOfAPasskey = (failure: Error | null): string | undefined => {
  if (failure === null) return undefined;
  if (failure instanceof DeviceRefused) return SAID_OF_THE_DEVICE[failure.reason];
  if (isTooMany(failure)) return stockWait(failure.waitSeconds);
  return failure instanceof CodeRefused ? CONFIRM_WORDS.passkeyNotUsed : undefined;
};

/** The words of a code that did not confirm, in the dialog's own line. */
const saidOfACode = (failure: Error | null): string | undefined => {
  if (failure === null) return undefined;
  if (isTooMany(failure)) return stockWait(failure.waitSeconds);
  return failure instanceof CodeRefused ? AUTHENTICATOR_CODE_WRONG : undefined;
};

/** One way to confirm, named by what the person holds. */
type Way = "passkey" | "authenticator";

/** The ways the person can confirm with, read afresh as the dialog opens. */
const waysHeld = (
  held: { readonly passkeys: readonly unknown[]; readonly authenticator: string } | undefined,
): readonly Way[] => {
  if (held === undefined) return [];
  return [
    ...(held.passkeys.length > 0 && passkeysHere() ? (["passkey"] as const) : []),
    ...(held.authenticator === "set-up" ? (["authenticator"] as const) : []),
  ];
};

function PasskeyWay(properties: { readonly onConfirmed: () => void }) {
  const saidId = useId();
  const confirm = useConfirmByPasskey();
  const pending = confirm.isPending || confirm.isSuccess;
  const said = saidOfAPasskey(confirm.error);

  return (
    <div>
      <Button
        type="button"
        className="aria-disabled:opacity-50"
        aria-disabled={pending}
        aria-describedby={said === undefined ? undefined : saidId}
        onClick={() => {
          if (!pending) confirm.mutate(undefined, { onSuccess: properties.onConfirmed });
        }}
      >
        {CONFIRM_WORDS.passkey}
      </Button>
      <p id={saidId} className="mt-2 text-muted-foreground">
        {pending && confirm.isPending ? CONFIRM_WORDS.passkeyWaiting : said}
      </p>
    </div>
  );
}

function AuthenticatorWay(properties: { readonly onConfirmed: () => void }) {
  const fieldId = useId();
  const hintId = useId();
  const saidId = useId();
  const confirm = useConfirmByAuthenticator();
  const said = saidOfACode(confirm.error);
  const digits = useSixDigits(fieldId, confirm.isPending, (code, onRefused) => {
    confirm.mutate(code, {
      onSuccess: properties.onConfirmed,
      onError: (failure) => {
        onRefused(failure);
      },
    });
  });

  return (
    <form
      onSubmit={digits.submit}
      aria-describedby={hintId}
      className="grid justify-items-start gap-2"
    >
      <AuthenticatorCodeField
        id={fieldId}
        label={CONFIRM_WORDS.codeField}
        digits={digits}
        readOnly={confirm.isPending}
        wrong={isAWrongCode(confirm.error)}
        describedBy={said === undefined ? hintId : `${hintId} ${saidId}`}
      />
      <p id={hintId} className="text-muted-foreground">
        {CONFIRM_WORDS.codeHint}
      </p>
      <p id={saidId} className="text-muted-foreground">
        {said}
      </p>
      <Button type="submit" className="aria-disabled:opacity-50" aria-disabled={confirm.isPending}>
        {CONFIRM_WORDS.confirm}
      </Button>
    </form>
  );
}

/** The re-confirm a stale confirmation opens, wherever the refused act was asked for. */
export function ReconfirmDialog() {
  const refusedAct = useTheRefusedAct();
  const open = refusedAct !== undefined;
  const api = useTRPC();
  const held = useQuery({
    ...api.person.secondFactor.queryOptions(),
    enabled: open,
  });
  const ways = waysHeld(held.data);

  /** The dialog closes first, so the act's own outcome region takes the focus its answer gives. */
  const confirmedAndRetried = () => {
    const act = refusedAct;
    cancelTheRefusedAct();
    act?.retry();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelTheRefusedAct();
      }}
    >
      <DialogContent className="wrap-anywhere">
        <DialogHeader>
          <DialogTitle>{CONFIRM_WORDS.heading}</DialogTitle>
          <DialogDescription>
            You confirmed your second factor over an hour ago. Confirm it again and your change goes
            ahead.
          </DialogDescription>
        </DialogHeader>
        {ways.length === 0 && held.data === undefined ? null : (
          <div className="grid gap-4">
            {ways.includes("passkey") ? <PasskeyWay onConfirmed={confirmedAndRetried} /> : null}
            {ways.includes("authenticator") ? (
              <AuthenticatorWay onConfirmed={confirmedAndRetried} />
            ) : null}
            {ways.length === 0 ? (
              <p className="text-muted-foreground">
                You no longer hold a second factor. Add one from your Account page.
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
