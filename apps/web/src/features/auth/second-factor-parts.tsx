import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import { KeystrokesAct, useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { NO_RESPONSE_TO_A_READ, SAID_OF_CLASS, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { ACCOUNT_ACTS, ACCOUNT_WORDS } from "./account-words.ts";
import { CodeRefused, SIGNED_OUT, TOO_MANY_REQUESTS } from "./auth-hooks.ts";
import { AuthScreen, Outcome, ReadAgain, Refused } from "./auth-screen.tsx";
import { isAWrongCode } from "./authenticator-code.tsx";
import { leavingFor } from "./carried-flow.ts";
import { selectTheCode } from "./code-entry.ts";
import type { SendingACode } from "./confirm-hooks.ts";
import { saidOfASecondFactorRefusal, tooManyCodesTriedOr, type OtherWay } from "./refusal-words.ts";
import type { SecondFactor, SecondFactorRead } from "./second-factor-hooks.ts";
import { CODE_AGAIN, USE_CODE } from "./second-factor-words.ts";
import { SignOutButton } from "./sign-out-button.tsx";

export const READ_AGAIN: Keystroke = { key: "r", act: ACCOUNT_ACTS.readAgain };

const MS_PER_SECOND = 1000;

/** The throttle's first wait, for a refusal whose answer named none. */
const SHORTEST_WAIT_SECONDS = 30;

export const holdsAFactor = (held: SecondFactor): boolean =>
  held.passkeys.length > 0 || held.authenticator === "set-up";

/** The session the read names; one it cannot name is neither confirmed nor granted. */
export const sessionOf = (held: SecondFactor) =>
  held.thisSession ?? { confirmed: false, setupGranted: false };

/** A wordless failure of the read itself, which only reading again can mend. */
export const readUnanswered = (read: SecondFactorRead): boolean =>
  read.data === undefined && read.error !== null && refusalOf(read.error) === undefined;

/** What a failed read or act says, with Read again when the read went unanswered. */
export function SecondFactorRefused(properties: {
  readonly id: string;
  readonly read: SecondFactorRead;
  readonly failure: Error | ApiError | null;
  readonly unanswered: Said;
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

/** A reread that lands on the same place goes nowhere new. */
export const useGoingTo = (to: string | undefined) => {
  const navigate = useNavigate();
  useEffect(() => {
    if (to !== undefined) void navigate(leavingFor(to));
  }, [to, navigate]);
};

/** The first way on takes focus once, as it first appears after the read. */
export const useArrivalFocus = () => {
  const arrived = useRef(false);
  return useCallback((node: HTMLElement | null) => {
    if (node === null || arrived.current) return;
    arrived.current = true;
    node.focus();
  }, []);
};

export type FocusOnArrival = ReturnType<typeof useArrivalFocus>;

/** No countdown: the wait is named once, and its lifting said once. */
export const useWaiting = (secondsAtArrival: number, onLifted: () => void) => {
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

export const isTooMany = (failure: Error | null): failure is CodeRefused =>
  failure instanceof CodeRefused && failure.status === TOO_MANY_REQUESTS;

/** A real link, so it opens in a new tab too; a press keeps the page's query. */
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
          {keystroke.act}
        </a>
      </Button>
    </div>
  );
}

/** Before the read lands, Read again is the one act with a key, once the read went unanswered. */
const listedKeystrokes = (
  read: SecondFactorRead,
  keystrokes: readonly Keystroke[],
): readonly Keystroke[] | undefined => {
  if (read.data !== undefined) return keystrokes;
  return readUnanswered(read) ? [READ_AGAIN] : undefined;
};

/** h1 from the first draw and Sign out last; until the read lands, nothing between them. */
export function PendingFrame(properties: {
  readonly title: string;
  readonly read: SecondFactorRead;
  readonly keystrokes: readonly Keystroke[];
  readonly children: ReactNode;
}) {
  const { read } = properties;
  const readId = useId();
  const listed = listedKeystrokes(read, properties.keystrokes);
  return (
    <AuthScreen title={properties.title}>
      {read.data === undefined ? null : properties.children}
      <SecondFactorRefused
        id={readId}
        read={read}
        failure={read.data === undefined ? read.error : null}
        unanswered={NO_RESPONSE_TO_A_READ}
      />
      <div className="mt-10 flex flex-wrap items-center gap-2">
        {listed === undefined ? null : (
          <KeystrokesAct screen={properties.title} keystrokes={listed} />
        )}
        <SignOutButton />
      </div>
    </AuthScreen>
  );
}

/** A code field's two regions: the wait lifting, and what refused the code. */
export function CodeOutcomes(properties: {
  readonly lifted: boolean;
  readonly said: Said | undefined;
  readonly refusedId: string;
}) {
  const { lifted, said, refusedId } = properties;
  return (
    <>
      <Outcome tone="said">{lifted ? CODE_AGAIN : null}</Outcome>
      <Outcome tone="refused" id={refusedId}>
        {said === undefined ? null : <RefusalLine said={said} />}
      </Outcome>
    </>
  );
}

/** What a code typed whole says once refused; a throttle is said by its wait instead. */
export type CodeSaids = { readonly wrong: Said; readonly unanswered: Said };

const saidOfSending = (failure: Error | null, saids: CodeSaids): Said | undefined => {
  if (failure === null || isTooMany(failure)) return undefined;
  if (!(failure instanceof CodeRefused)) return saids.unanswered;
  return failure.status === SIGNED_OUT ? SAID_OF_CLASS.unauthenticated : saids.wrong;
};

/** A recovery or restore code, sent as typed: the api ignores its spaces, dashes and case. */
export function OneTimeCodeForm(properties: {
  readonly label: string;
  readonly sending: SendingACode;
  readonly saids: CodeSaids;
  readonly others: readonly OtherWay[];
  readonly waitAtArrival: number;
  readonly fieldRef?: FocusOnArrival | undefined;
  readonly onGranted: () => void;
}) {
  const { label, sending, saids, others, waitAtArrival, fieldRef, onGranted } = properties;
  const fieldId = useId();
  const refusedId = useId();
  const [code, setCode] = useState("");
  const waiting = useWaiting(waitAtArrival, () => {
    sending.reset();
  });
  const held = sending.isPending || sending.isSuccess || waiting.waiting;
  const said = waiting.waiting
    ? tooManyCodesTriedOr(waiting.seconds, others)
    : saidOfSending(sending.error, saids);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const asked = code.trim();
    if (asked === "" || held) return;
    sending.mutate(asked, {
      onSuccess: onGranted,
      onError: (failure) => {
        if (isTooMany(failure)) waiting.waitFor(failure.waitSeconds);
        else selectTheCode(fieldId);
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
      <CodeOutcomes lifted={waiting.lifted} said={said} refusedId={refusedId} />
    </form>
  );
}
