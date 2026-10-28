import { err, ok, type Result } from "../../kernel/index.ts";
import type { PrincipalRefusal } from "../../kernel/index.ts";

type AnyResult = Result<unknown, unknown>;

type WhollyAResult<T> = [T] extends [AnyResult] ? true : false;

type PartlyAResult<T> = [Extract<T, AnyResult>] extends [never] ? false : true;

type Unwrapped<T> = T extends { readonly ok: true; readonly value: infer Value } ? Value : never;

type Refused<T> = T extends { readonly ok: false; readonly error: infer Refusal } ? Refusal : never;

type OnlyPartlyAResult<T> = WhollyAResult<T> extends true ? false : PartlyAResult<T>;

export type Answered<T> =
  OnlyPartlyAResult<T> extends true ? never : WhollyAResult<T> extends true ? Unwrapped<T> : T;

export type Foldable<T> = OnlyPartlyAResult<T> extends true ? never : T;

export type Opened<T> = Result<T, PrincipalRefusal>;

export type Folded<T, Failure = never> = Result<
  Answered<T>,
  Refused<T> | PrincipalRefusal | Failure
>;

const answersAResult = <T>(answer: T): answer is T & AnyResult =>
  typeof answer === "object" &&
  answer !== null &&
  "ok" in answer &&
  (answer.ok === true ? "value" in answer : answer.ok === false && "error" in answer);

export const answersARefusal = <T>(answer: T): boolean => answersAResult(answer) && !answer.ok;

export const folded = <T>(opened: Opened<Foldable<T>>): Folded<T> => {
  if (!opened.ok) return err(opened.error);
  const answer = opened.value;
  // oxlint-disable-next-line typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion -- `Folded<T>` turns on a `T` still open here, which no runtime check narrows
  return (answersAResult(answer) ? answer : ok(answer)) as Folded<T>;
};
