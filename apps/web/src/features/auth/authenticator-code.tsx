import { useState, type FormEvent, type Ref } from "react";
import { flushSync } from "react-dom";

import { AUTHENTICATOR_CODE_LENGTH } from "@better-answers/schema/second-factor";

import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { CodeRefused } from "./auth-hooks.ts";
import { digitsOf, selectTheCode, worthSending } from "./code-entry.ts";

const CODE_PATTERN = `[0-9]{${String(AUTHENTICATOR_CODE_LENGTH)}}`;

export const CODE_WRONG = 400;

export const isAWrongCode = (failure: Error | null): boolean =>
  failure instanceof CodeRefused && failure.status === CODE_WRONG;

/** Sends `digits`, and hands any refusal back so a wrong code's digits stay selected. */
type SendTheCode = (digits: string, onRefused: (failure: Error) => void) => void;

/**
 * The digit filter and submit-at-six. A code refused as wrong is never sent again, since the api
 * would only spend a try on it.
 */
export const useSixDigits = (fieldId: string, waiting: boolean, send: SendTheCode) => {
  const [code, setCode] = useState("");
  const [refused, setRefused] = useState<readonly string[]>([]);

  const countTheRefusal = (digits: string, failure: Error) => {
    if (!isAWrongCode(failure)) return;
    flushSync(() => {
      setRefused([...refused, digits]);
    });
    selectTheCode(fieldId);
  };

  const sendWith = (digits: string) => {
    if (waiting || !worthSending(digits, refused, AUTHENTICATOR_CODE_LENGTH)) return;
    send(digits, (failure) => {
      countTheRefusal(digits, failure);
    });
  };

  return {
    code,
    enter: (entered: string) => {
      const digits = digitsOf(entered, AUTHENTICATOR_CODE_LENGTH);
      setCode(digits);
      sendWith(digits);
    },
    submit: (event: FormEvent) => {
      event.preventDefault();
      sendWith(code);
    },
  };
};

export type SixDigits = ReturnType<typeof useSixDigits>;

/** No `maxLength`: a browser would cut a pasted `123 456` short before it is read. */
export function AuthenticatorCodeField(properties: {
  readonly id: string;
  readonly label: string;
  readonly digits: SixDigits;
  readonly readOnly: boolean;
  readonly wrong: boolean;
  readonly describedBy: string | undefined;
  readonly fieldRef?: Ref<HTMLInputElement> | undefined;
}) {
  const { id, label, digits, readOnly, wrong, describedBy, fieldRef } = properties;
  return (
    <>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        ref={fieldRef}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={CODE_PATTERN}
        required
        readOnly={readOnly}
        aria-describedby={describedBy}
        aria-invalid={wrong}
        className="mt-2 max-w-48 font-mono tabular-nums"
        value={digits.code}
        onChange={(event) => {
          digits.enter(event.target.value);
        }}
      />
    </>
  );
}
