import type { ModelProvider } from "@better-answers/schema";

import {
  err,
  MALFORMED,
  ok,
  openEnvelope,
  sealEnvelope,
  type KernelRefusal,
  type OpenEnvelopeRefusal,
  type Result,
  type WorkspaceId,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * Reached through `reveal` alone, so a logger, an error or a JSON body handed this value prints no
 * part of the key.
 */
type ModelKey = {
  readonly reveal: () => string;
};

type ModelKeyOf = {
  readonly workspaceId: WorkspaceId;
  readonly provider: ModelProvider;
};

export type Credentials = {
  /**
   * Replaces any key `of` held. Refuses a key that is not one header value, in a word that never
   * repeats it.
   */
  readonly storeModelKey: (
    tx: Tx,
    of: ModelKeyOf,
    key: string,
  ) => Promise<Result<undefined, KernelRefusal<"malformed">>>;

  /**
   * None is `undefined`. A row that does not open is refused and never read as none, so a lost key
   * is seen.
   */
  readonly readModelKey: (
    tx: Tx,
    of: ModelKeyOf,
  ) => Promise<Result<ModelKey | undefined, OpenEnvelopeRefusal>>;
};

const MODEL_KEY_MAX = 1024;

/**
 * Visible ASCII with no space, as a request header carries it. A key outside it is refused when
 * sent, in an error quoting it.
 */
const ONE_HEADER_VALUE = /^[!-~]+$/;

const LINE = "\n";

/**
 * The sealed text names whose key it is: the envelope authenticates its own bytes alone, so a frame
 * copied onto another row would otherwise open.
 */
const textSealedFor = (of: ModelKeyOf, key: string): Uint8Array =>
  new TextEncoder().encode([of.workspaceId, of.provider, key].join(LINE));

const keyHeldFor = (of: ModelKeyOf, text: string): string | undefined => {
  const [workspaceId, provider, key, ...more] = text.split(LINE);
  const named = workspaceId === of.workspaceId && provider === of.provider && more.length === 0;
  return named ? key : undefined;
};

/**
 * The credentials provider, for the model provider's class alone. A model key is sealed and never
 * hashed, because it is sent. Opened once with the envelope key, which no caller is handed back.
 *
 * @throws from either method when `envelopeKey` is not the envelope's length.
 */
export const openCredentials = (envelopeKey: Uint8Array): Credentials => ({
  storeModelKey: async (tx, of, key) => {
    if (key.length > MODEL_KEY_MAX || !ONE_HEADER_VALUE.test(key)) return err(MALFORMED);
    await tx.query(
      `INSERT INTO model_key (workspace_id, provider, sealed) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, provider) DO UPDATE SET sealed = EXCLUDED.sealed`,
      [of.workspaceId, of.provider, sealEnvelope(envelopeKey, textSealedFor(of, key))],
    );
    return ok(undefined);
  },

  readModelKey: async (tx, of) => {
    const found = await tx.query<{ sealed: Uint8Array }>(
      "SELECT sealed FROM model_key WHERE workspace_id = $1 AND provider = $2",
      [of.workspaceId, of.provider],
    );
    const sealed = found.rows[0]?.sealed;
    if (sealed === undefined) return ok(undefined);

    const opened = openEnvelope(envelopeKey, sealed);
    if (!opened.ok) return opened;
    const key = keyHeldFor(of, new TextDecoder().decode(opened.value));
    // One word for a moved frame and a wrong key alike, as the envelope answers them.
    return key === undefined ? err("envelope-not-authentic") : ok({ reveal: () => key });
  },
});
