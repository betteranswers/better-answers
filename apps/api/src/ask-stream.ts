/**
 * Cloudflare drops a response quiet for 125 seconds between two reads; the judge alone may take
 * 150.
 */
export const ASK_KEEP_ALIVE_MS = 25_000;

export type KeepAlive = { readonly kind: "keep-alive" };

const KEEP_ALIVE: KeepAlive = { kind: "keep-alive" };

const quietFor = async (
  woken: Promise<void>,
  quietMs: number,
  stop: AbortSignal,
): Promise<"woken" | "quiet" | "stopped"> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopped = Promise.withResolvers<"stopped">();
  const onStop = (): void => {
    stopped.resolve("stopped");
  };
  stop.addEventListener("abort", onStop, { once: true });
  try {
    return await Promise.race([
      woken.then(() => "woken" as const),
      new Promise<"quiet">((resolve) => {
        timer = setTimeout(() => resolve("quiet"), quietMs);
      }),
      stopped.promise,
    ]);
  } finally {
    clearTimeout(timer);
    stop.removeEventListener("abort", onStop);
  }
};

type Ended = { readonly threw: false } | { readonly threw: true; readonly error: Error };

export async function* eventsOf<Event extends object>(
  work: (emit: (event: Event) => void) => Promise<void>,
  quietMs: number,
  stop: AbortSignal,
): AsyncGenerator<Event | KeepAlive, void, undefined> {
  const queued: Event[] = [];
  let woken = Promise.withResolvers<void>();
  let ended: Ended | undefined;
  const settle = (end: Ended): void => {
    ended = end;
    woken.resolve();
  };
  void work((event) => {
    queued.push(event);
    woken.resolve();
  }).then(
    () => settle({ threw: false }),
    (error: Error) => settle({ threw: true, error }),
  );
  for (;;) {
    const next = queued.shift();
    if (next !== undefined) {
      yield next;
      continue;
    }
    if (ended?.threw === true) throw ended.error;
    if (ended !== undefined || stop.aborted) return;
    woken = Promise.withResolvers<void>();
    // oxlint-disable-next-line eslint/no-await-in-loop -- each wait for the next event starts once the last one was yielded
    const heard = await quietFor(woken.promise, quietMs, stop);
    if (heard === "quiet") yield KEEP_ALIVE;
  }
}
