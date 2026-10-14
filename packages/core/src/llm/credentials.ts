import type { ModelProvider } from "@better-answers/schema";

import {
  ENVELOPE_KEY_BYTES,
  err,
  MALFORMED,
  ok,
  openEnvelope,
  sealEnvelope,
  type AuditEventId,
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
export type ModelKey = {
  readonly reveal: () => string;
};

type ModelKeyOf = {
  readonly workspaceId: WorkspaceId;
  readonly provider: ModelProvider;
};

/** What the side that calls a model is handed: the read, and no way to store. */
export type Credentials = {
  /**
   * None is `undefined`; a row that will not open is refused, never read as none.
   *
   * @throws outside a workspace's transaction.
   */
  readonly readModelKey: (
    tx: Tx,
    provider: ModelProvider,
  ) => Promise<Result<ModelKey | undefined, OpenEnvelopeRefusal>>;
};

/** What the audited action is handed: a key is stored only with the event that records it. */
export type ModelKeySetting = {
  /**
   * Replaces any key `of` held, then awaits `recorded`. Refuses a key that is not one header
   * value, never repeating it.
   */
  readonly storeModelKey: (
    tx: Tx,
    of: ModelKeyOf,
    key: string,
    recorded: () => Promise<{ readonly id: AuditEventId }>,
  ) => Promise<Result<undefined, KernelRefusal<"malformed">>>;
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

const keyHeldFor = (
  of: { readonly workspaceId: string; readonly provider: ModelProvider },
  text: string,
): string | undefined => {
  const [workspaceId, provider, key, ...more] = text.split(LINE);
  const named = workspaceId === of.workspaceId && provider === of.provider && more.length === 0;
  return named ? key : undefined;
};

/** Checked as it is taken, so a mis-provisioned key is told before the first row is read. */
const envelopeKeyHeld = (envelopeKey: Uint8Array): Uint8Array => {
  if (envelopeKey.length !== ENVELOPE_KEY_BYTES) {
    throw new Error(
      `credentials: an envelope key is ${String(ENVELOPE_KEY_BYTES)} bytes, not ${String(envelopeKey.length)}`,
    );
  }
  return envelopeKey;
};

/** The scope comes back beside the row, so no key and no workspace are told apart. */
const KEY_OF_THE_SCOPE = `SELECT scope.id AS "workspaceId", held.sealed
   FROM (SELECT current_workspace_id() AS id) AS scope
   LEFT JOIN model_key AS held ON held.workspace_id = scope.id AND held.provider = $1`;

type KeyOfTheScope = { readonly workspaceId: string | null; readonly sealed: Uint8Array | null };

const keyOpened = (
  opener: Uint8Array,
  of: { readonly workspaceId: string; readonly provider: ModelProvider },
  sealed: Uint8Array,
): Result<ModelKey, OpenEnvelopeRefusal> => {
  const opened = openEnvelope(opener, sealed);
  if (!opened.ok) return opened;
  const key = keyHeldFor(of, new TextDecoder().decode(opened.value));
  // One word for a moved frame and a wrong key alike, as the envelope answers them.
  return key === undefined ? err("envelope-not-authentic") : ok({ reveal: () => key });
};

/**
 * The reading half of the credentials provider. The envelope key is held here and handed back to
 * no caller.
 *
 * @throws when `envelopeKey` is not the envelope's length, naming no byte of it.
 */
export const openCredentials = (envelopeKey: Uint8Array): Credentials => {
  const opener = envelopeKeyHeld(envelopeKey);
  return {
    readModelKey: async (tx, provider) => {
      const found = await tx.query<KeyOfTheScope>(KEY_OF_THE_SCOPE, [provider]);
      const workspaceId = found.rows[0]?.workspaceId ?? null;
      if (workspaceId === null) {
        throw new Error("credentials: a model key is read inside its workspace's transaction");
      }
      const sealed = found.rows[0]?.sealed ?? null;
      if (sealed === null) return ok(undefined);
      return keyOpened(opener, { workspaceId, provider }, sealed);
    },
  };
};

/**
 * The storing half, sealed and never hashed because a model key is sent. Kept apart from the
 * read so that only the audited action holds it.
 *
 * @throws when `envelopeKey` is not the envelope's length, naming no byte of it.
 */
export const openModelKeySetting = (envelopeKey: Uint8Array): ModelKeySetting => {
  const sealer = envelopeKeyHeld(envelopeKey);
  return {
    storeModelKey: async (tx, of, key, recorded) => {
      if (key.length > MODEL_KEY_MAX || !ONE_HEADER_VALUE.test(key)) return err(MALFORMED);
      await tx.query(
        `INSERT INTO model_key (workspace_id, provider, sealed) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, provider) DO UPDATE SET sealed = EXCLUDED.sealed`,
        [of.workspaceId, of.provider, sealEnvelope(sealer, textSealedFor(of, key))],
      );
      await recorded();
      return ok(undefined);
    },
  };
};
