import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type SubmitEvent,
  type ReactNode,
} from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { KeystrokesAction, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { ACCOUNT_ACTIONS, ACCOUNT_WORDS } from "../account-words.ts";
import { CodeRefused, isTooMany, SIGNED_OUT } from "../auth-hooks.ts";
import { AuthPage, Outcome, ReadAgain, Refused } from "../auth-page.tsx";
import { leavingFor } from "../carried-flow.ts";
import { selectTheCode } from "../code-entry.ts";
import {
  saidOfASecondFactorRefusal,
  tooManyCodesTriedOr,
  type OtherWay,
} from "../refusal-words.ts";
import { rememberTheStanding } from "../second-factor-steps.ts";
import { SignOutButton } from "../sign-out-button.tsx";
import { isAWrongCode } from "./authenticator-code.tsx";
import type { SendingACode } from "./confirm-hooks.ts";
import type { SecondFactor, SecondFactorRead } from "./second-factor-hooks.ts";
import { CODE_AGAIN, USE_CODE } from "./second-factor-words.ts";

export const READ_AGAIN: Keystroke = { key: "r", action: ACCOUNT_ACTIONS.readAgain };

const MS_PER_SECOND = 1000;

const SHORTEST_WAIT_SECONDS = 30;

export const holdsAFactor = (held: SecondFactor): boolean =>
  held.passkeys.length > 0 || held.authenticator === "set-up";

export const sessionOf = (held: SecondFactor) =>
  held.thisSession ?? { confirmed: false, setupGranted: false };

export const readUnanswered = (read: SecondFactorRead): boolean =>
  read.data === undefined && read.error !== null && refusalOf(read.error) === undefined;

export function SecondFactorRefused(properties: {
  readonly id: string;
  readonly read: SecondFactorRead;
  readonly failure: Error | ApiError | null;
  readonly unanswered: string;
}) {
  const { read } = properties;
  return (
    <>
      <Refused
        id={properties.id}
        failure={properties.failure}
        saidOf={saidOfASecondFactorRefusal}
        unanswered={properties.unanswered}
      />
      {readUnanswered(read) ? (
        <ReadAgain
          keystroke={READ_AGAIN}
          reading={read.isFetching}
          words={ACCOUNT_WORDS}
          onReadAgain={() => {
            void read.refetch();
          }}
          className="mt-4"
        />
      ) : null}
    </>
  );
}

export const useGoingTo = (to: string | undefined) => {
  const navigate = useNavigate();
  useEffect(() => {
    if (to !== undefined) void navigate(leavingFor(to));
  }, [to, navigate]);
};

export const useArrivalFocus = () => {
  const arrived = useRef(false);
  return useCallback((node: HTMLElement | null) => {
    if (node === null || arrived.current) return;
    arrived.current = true;
    node.focus();
  }, []);
};

export type FocusOnArrival = ReturnType<typeof useArrivalFocus>;

const useWaiting = (secondsAtArrival: number, onLifted: () => void) => {
  const [wait, setWait] = useState<{ readonly seconds: number | undefined } | undefined>(
    secondsAtArrival > 0 ? { seconds: secondsAtArrival } : undefined,
  );
  const [lifted, setLifted] = useState(false);
  const lift = useEffectEvent(() => {
    setWait(undefined);
    setLifted(true);
    onLifted();
  });

  useEffect(() => {
    if (wait === undefined) return undefined;
    const timer = setTimeout(
      () => {
        lift();
      },
      (wait.seconds ?? SHORTEST_WAIT_SECONDS) * MS_PER_SECOND,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  return {
    waiting: wait !== undefined,
    seconds: wait?.seconds,
    lifted,
    waitFor: (seconds: number | undefined) => {
      setLifted(false);
      setWait({ seconds });
    },
  };
};

type SendingState = {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly error: Error | null;
  readonly reset: () => void;
};

export const useThrottledSend = (
  sending: SendingState,
  waitSecondsAtArrival: number,
  others: readonly OtherWay[],
  saidOfFailure: (failure: Error | null) => string | undefined,
) => {
  const waiting = useWaiting(waitSecondsAtArrival, () => {
    sending.reset();
  });
  return {
    held: sending.isPending || sending.isSuccess || waiting.waiting,
    said: waiting.waiting
      ? tooManyCodesTriedOr(waiting.seconds, others)
      : saidOfFailure(sending.error),
    lifted: waiting.lifted,
    refused: (failure: Error, otherwise: (failure: Error) => void) => {
      if (isTooMany(failure)) waiting.waitFor(failure.waitSeconds);
      else otherwise(failure);
    },
  };
};

export function StepLink(properties: {
  readonly href: string;
  readonly keystroke: Keystroke;
  readonly linkRef?: FocusOnArrival | undefined;
}) {
  const { href, keystroke, linkRef } = properties;
  const navigate = useNavigate();
  const go = () => {
    void navigate(leavingFor(href));
  };
  useKeystroke(keystroke, go);

  return (
    <div className="mt-6">
      <Button asChild variant="link" className="px-0">
        <a
          ref={linkRef}
          href={href}
          aria-keyshortcuts={keystroke.key}
          onClick={(event) => {
            event.preventDefault();
            go();
          }}
        >
          {keystroke.action}
        </a>
      </Button>
    </div>
  );
}

const listedKeystrokes = (
  read: SecondFactorRead,
  keystrokes: readonly Keystroke[],
): readonly Keystroke[] | undefined => {
  if (read.data !== undefined) return keystrokes;
  return readUnanswered(read) ? [READ_AGAIN] : undefined;
};

const useStandingRemembered = (held: SecondFactor | undefined) => {
  useEffect(() => {
    rememberTheStanding(held);
  }, [held]);
};

export function PendingFrame(properties: {
  readonly title: string;
  readonly read: SecondFactorRead;
  readonly keystrokes: readonly Keystroke[];
  readonly children: ReactNode;
}) {
  const { read } = properties;
  const readId = useId();
  const listed = listedKeystrokes(read, properties.keystrokes);
  useStandingRemembered(read.data);
  return (
    <AuthPage title={properties.title}>
      {read.data === undefined ? null : properties.children}
      <SecondFactorRefused
        id={readId}
        read={read}
        failure={read.data === undefined ? read.error : null}
        unanswered={STOCK.notLoaded}
      />
      <div className="mt-10 flex flex-wrap items-center gap-2">
        {listed === undefined ? null : (
          <KeystrokesAction page={properties.title} keystrokes={listed} />
        )}
        <SignOutButton />
      </div>
    </AuthPage>
  );
}

export function CodeOutcomes(properties: {
  readonly lifted: boolean;
  readonly said: string | undefined;
  readonly refusedId: string;
}) {
  const { lifted, said, refusedId } = properties;
  return (
    <>
      <Outcome tone="said">{lifted ? CODE_AGAIN : null}</Outcome>
      <Outcome tone="refused" id={refusedId}>
        {said}
      </Outcome>
    </>
  );
}

const saidOfSending = (failure: Error | null, wrong: string): string | undefined => {
  if (failure === null || isTooMany(failure)) return undefined;
  if (!(failure instanceof CodeRefused)) return STOCK.unconfirmed;
  return failure.status === SIGNED_OUT ? STOCK.session : wrong;
};

export function OneTimeCodeForm(properties: {
  readonly label: string;
  readonly sending: SendingACode;

  readonly wrong: string;
  readonly others: readonly OtherWay[];
  readonly waitSecondsAtArrival: number;
  readonly fieldRef?: FocusOnArrival | undefined;
  readonly onGranted: () => void;
}) {
  const { label, sending, wrong, others, waitSecondsAtArrival, fieldRef, onGranted } = properties;
  const fieldId = useId();
  const refusedId = useId();
  const [code, setCode] = useState("");
  const { held, said, lifted, refused } = useThrottledSend(
    sending,
    waitSecondsAtArrival,
    others,
    (failure) => saidOfSending(failure, wrong),
  );

  const send = (event: SubmitEvent) => {
    event.preventDefault();
    const asked = code.trim();
    if (asked === "" || held) return;
    sending.mutate(asked, {
      onSuccess: onGranted,
      onError: (failure) => {
        refused(failure, () => {
          selectTheCode(fieldId);
        });
      },
    });
  };

  return (
    <form onSubmit={send} className="mt-6">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input
        id={fieldId}
        ref={fieldRef}
        name="code"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        required
        readOnly={held}
        aria-describedby={said === undefined ? undefined : refusedId}
        aria-invalid={isAWrongCode(sending.error)}
        className="mt-2 max-w-sm font-mono"
        value={code}
        onChange={(event) => {
          setCode(event.target.value);
        }}
      />
      <Button type="submit" className="mt-4 aria-disabled:opacity-50" aria-disabled={held}>
        {USE_CODE}
      </Button>
      <CodeOutcomes lifted={lifted} said={said} refusedId={refusedId} />
    </form>
  );
}
