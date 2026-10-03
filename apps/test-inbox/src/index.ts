import { answer, type Logged } from "./read-api.ts";
import { attempted, ok } from "./result.ts";
import { storeOver, type Database, type Received, type Store } from "./store.ts";

type Env = { readonly DB: Database; readonly READ_TOKEN?: string | undefined };

/** The part of Cloudflare's `ForwardableEmailMessage` the test inbox reads. */
type ReceivedEmail = {
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
};

const RAW_MOST_BYTES = 256 * 1024;

const TOKEN_LEAST_LENGTH = 32;

const logged: Logged = (event, detail) => {
  // oxlint-disable-next-line no-console -- Workers Logs reads the console, and a Worker has no other sink
  console.log(JSON.stringify({ event, ...detail }));
};

const tokenOf = (token: string | undefined): string | undefined =>
  token !== undefined && token.length >= TOKEN_LEAST_LENGTH ? token : undefined;

const receivedOf = (message: ReceivedEmail, raw: Uint8Array, receivedAtMs: number): Received => ({
  receivedAtMs,
  recipient: message.to.toLowerCase(),
  from: message.headers.get("from") ?? "",
  subject: message.headers.get("subject") ?? "",
  raw,
});

/**
 * Logs every failure and returns, never rejecting, forwarding or throwing: a bounce would put the
 * test address on the sender's suppression list.
 */
const receive = async (
  message: ReceivedEmail,
  store: Store,
  receivedAtMs: number,
): Promise<void> => {
  if (message.rawSize > RAW_MOST_BYTES) {
    logged("dropped", { reason: "larger than 256 KiB", bytes: message.rawSize });
    return;
  }
  const raw = await attempted(async () =>
    ok(new Uint8Array(await new Response(message.raw).arrayBuffer())),
  );
  if (!raw.ok) {
    logged("unread", { error: raw.error });
    return;
  }
  const kept = await store.keep(receivedOf(message, raw.value, receivedAtMs));
  if (!kept.ok) {
    logged("unstored", { error: kept.error });
    return;
  }
  const pruned = await store.prune(receivedAtMs);
  if (!pruned.ok) logged("unpruned", { error: pruned.error });
};

export default {
  email: (message: ReceivedEmail, env: Env): Promise<void> =>
    receive(message, storeOver(env.DB), Date.now()),

  fetch: (request: Request, env: Env): Promise<Response> =>
    answer(request, {
      store: storeOver(env.DB),
      token: tokenOf(env.READ_TOKEN),
      nowMs: Date.now(),
      logged,
    }),
};
