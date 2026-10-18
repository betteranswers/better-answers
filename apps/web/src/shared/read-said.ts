import { useDeferredValue } from "react";

type Read<Failure> = {
  readonly error: Failure | null;
  readonly isPending: boolean;
};

export function useReadSaid<Failure>(read: Read<Failure>): Read<Failure> {
  const error = useDeferredValue(read.error, null);
  const isPending = useDeferredValue(read.isPending, false);
  return {
    error: read.error === null || error === null ? null : read.error,
    isPending: read.isPending && isPending,
  };
}
