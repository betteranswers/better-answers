import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ENVELOPE_KEY_BYTES, err, ok, type Result } from "@better-answers/core/kernel";
import type { ObjectStoreSettings } from "@better-answers/core/store/objects";
import type { UploadSweepMode } from "@better-answers/core/sweeps";
import { UPLOAD_SWEEP_MODES } from "@better-answers/schema";

import {
  bareHostname,
  hostIsAsWritten,
  hostnameOfUrl,
  originOfUrl,
  type PublicHostnames,
} from "./ingress/hostnames.ts";
import { logger } from "./logger.ts";

const bootstrapSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  WEB_ROOT: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL("../../web/dist", import.meta.url))),

  GIT_STORE_DIR: z.string().min(1).optional(),
});

const httpsOrigin = z
  .url({ protocol: /^https$/u })
  .refine((value) => {
    const url = new URL(value);
    return (
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === ""
    );
  }, "PUBLIC_URL must be an https origin with no path, query, fragment or credentials")
  .refine(
    hostIsAsWritten,
    "PUBLIC_URL must spell its host the way a URL parser writes it. A spelling the parser rewrites, such as `127.000.000.001`, `0x7f.1` or a percent-encoded label, gives an `app.` hostname that no request can match",
  )
  .refine(
    (value) => bareHostname.safeParse(hostnameOfUrl(value)).success,
    "PUBLIC_URL's host must be a hostname of DNS labels only, because the hostname fence matches each request's `Host` against it",
  )

  .transform((value) => originOfUrl(value));

const identityBootstrapSchema = z
  .object({
    PUBLIC_URL: httpsOrigin,

    AUTH_SECRET: z.string().min(32),

    AGENT_HOSTNAME: bareHostname,
    APEX_HOSTNAME: bareHostname,

    SMTP_URL: z.url({ protocol: /^smtps?$/u }).optional(),
  })
  .refine((parsed) => {
    const hostnames = [
      hostnameOfUrl(parsed.PUBLIC_URL),
      parsed.AGENT_HOSTNAME,
      parsed.APEX_HOSTNAME,
    ];
    return new Set(hostnames).size === hostnames.length;
  }, "PUBLIC_URL's host, AGENT_HOSTNAME and APEX_HOSTNAME must all differ. If two are the same, one hostname serves the other's paths and the hostname fence is lost");

const objectStoreSchema = z.object({
  S3_ENDPOINT: z.url({ protocol: /^https?$/u }),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
});

/** fetch rejects a URL with credentials with an error that quotes the whole URL, and that error is logged. */
const deadManPingUrl = z
  .url({ protocol: /^https?$/u, abort: true })
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "a healthcheck ping URL must not contain credentials")
  .optional();

const sweepsSchema = z.object({
  UPLOAD_SWEEP: z.enum(UPLOAD_SWEEP_MODES).default("list"),
  HEALTHCHECKS_PING_URL_SWEEPS: deadManPingUrl,
});

const headCheckSchema = z.object({
  HEALTHCHECKS_PING_URL_SCHEDULER: deadManPingUrl,
});

/** Coolify kills the container 30 s after the signal, so the api stops waiting for clients and queries well before that. */
const DEFAULT_STOP_DEADLINE_MS = 10_000;

const stopSchema = z.object({
  STOP_DEADLINE_MS: z.coerce.number().int().min(1).default(DEFAULT_STOP_DEADLINE_MS),
});

const runningImageSchema = z.object({
  API_IMAGE_DIGEST: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/u, "must be a digest: sha256: followed by 64 hex characters")
    .optional(),
});

const envelopeKeySchema = z.object({
  KEK: z.string().regex(new RegExp(`^[0-9a-fA-F]{${String(ENVELOPE_KEY_BYTES * 2)}}$`, "u")),
});

export const READER_SCHEMAS = {
  readBootstrap: bootstrapSchema,
  readIdentityBootstrap: identityBootstrapSchema,
  readObjectStore: objectStoreSchema,
  readSweeps: sweepsSchema,
  readHeadCheck: headCheckSchema,
  readStop: stopSchema,
  readRunningImage: runningImageSchema,
  readEnvelopeKey: envelopeKeySchema,
};

type Reader = keyof typeof READER_SCHEMAS;

const EVERY_READER = Object.keys(READER_SCHEMAS).filter((name): name is Reader =>
  Object.hasOwn(READER_SCHEMAS, name),
);

const BOOTSTRAP_ONLY: readonly Reader[] = ["readBootstrap"];

/** The readers each process of this tier starts. `environment-gate.ts` passes a process the keys they read and no other. */
export const PROCESS_READERS = {
  api: EVERY_READER,
  migrate: BOOTSTRAP_ONLY,
};

export type TierProcess = keyof typeof PROCESS_READERS;

/** A dependency reads these. No reader of this module does. */
export const LIBRARY_KEYS = ["NODE_ENV"] as const;

/** Node, git and the C library read these in any process. A deployment sets none of them. */
const RUNTIME_KEYS = [
  "PATH",
  "HOME",
  "HOSTNAME",
  "TMPDIR",
  "TZ",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
] as const;

/**
 * Coolify hands every service every variable of the resource. This keeps the keys that the
 * process's readers, its libraries and the runtime read.
 */
export function environmentOf(
  tierProcess: TierProcess,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const kept = new Set<string>([
    ...PROCESS_READERS[tierProcess].flatMap((reader) => Object.keys(READER_SCHEMAS[reader].shape)),
    ...LIBRARY_KEYS,
    ...RUNTIME_KEYS,
  ]);
  return Object.fromEntries(
    Object.entries(environment).flatMap(([key, value]) =>
      kept.has(key) && value !== undefined ? [[key, value]] : [],
    ),
  );
}

const NO_ENVELOPE_KEY = `KEK must be set to the envelope key: ${String(ENVELOPE_KEY_BYTES * 2)} hexadecimal characters, encoding ${String(ENVELOPE_KEY_BYTES)} bytes`;

export type Bootstrap = {
  readonly databaseUrl: string;
  readonly port: number;
  readonly webRoot: string;

  readonly gitStoreDir: string | undefined;
};

export type IdentityBootstrap = {
  readonly publicUrl: string;
  readonly authSecret: string;
  readonly hostnames: PublicHostnames;

  readonly smtpUrl: string | undefined;
};

export type SweepSettings = {
  readonly uploadSweep: UploadSweepMode;

  readonly pingUrl: string | undefined;
};

export type HeadCheckSettings = {
  readonly pingUrl: string | undefined;
};

type StopSettings = {
  readonly deadlineMs: number;
};

export type RunningImage = {
  readonly digest: string | undefined;
};

const invalid = (parsed: z.ZodError, what = "bootstrap configuration"): Error =>
  new Error(`${what} is invalid:\n${z.prettifyError(parsed)}`);

export function readBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<Bootstrap> {
  const parsed = bootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    databaseUrl: parsed.data.DATABASE_URL,
    port: parsed.data.PORT,
    webRoot: parsed.data.WEB_ROOT,
    gitStoreDir: parsed.data.GIT_STORE_DIR,
  });
}

export function readIdentityBootstrap(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<IdentityBootstrap> {
  const parsed = identityBootstrapSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    publicUrl: parsed.data.PUBLIC_URL,
    authSecret: parsed.data.AUTH_SECRET,
    smtpUrl: parsed.data.SMTP_URL,
    hostnames: {
      app: hostnameOfUrl(parsed.data.PUBLIC_URL),
      agent: parsed.data.AGENT_HOSTNAME,
      apex: parsed.data.APEX_HOSTNAME,
    },
  });
}

export function readObjectStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<ObjectStoreSettings> {
  const parsed = objectStoreSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error));
  return ok({
    endpoint: parsed.data.S3_ENDPOINT,
    region: parsed.data.S3_REGION,
    bucket: parsed.data.S3_BUCKET,
    accessKeyId: parsed.data.S3_ACCESS_KEY,
    secretAccessKey: parsed.data.S3_SECRET_KEY,
  });
}

export function readSweeps(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<SweepSettings> {
  const parsed = sweepsSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the sweeps' settings"));
  return ok({
    uploadSweep: parsed.data.UPLOAD_SWEEP,
    pingUrl: parsed.data.HEALTHCHECKS_PING_URL_SWEEPS,
  });
}

export function readHeadCheck(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<HeadCheckSettings> {
  const parsed = headCheckSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the head check's settings"));
  return ok({ pingUrl: parsed.data.HEALTHCHECKS_PING_URL_SCHEDULER });
}

export function readStop(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<StopSettings> {
  const parsed = stopSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the stop settings"));
  return ok({ deadlineMs: parsed.data.STOP_DEADLINE_MS });
}

export function readRunningImage(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<RunningImage> {
  const parsed = runningImageSchema.safeParse(environment);
  if (!parsed.success) return err(invalid(parsed.error, "the image the api runs"));
  return ok({ digest: parsed.data.API_IMAGE_DIGEST });
}

export function readEnvelopeKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Result<Uint8Array> {
  const parsed = envelopeKeySchema.safeParse(environment);
  if (!parsed.success) return err(new Error(NO_ENVELOPE_KEY));
  return ok(new Uint8Array(Buffer.from(parsed.data.KEK, "hex")));
}

export function requireBootstrap(processName: string): Bootstrap {
  return orExit(processName, readBootstrap());
}

export function requireIdentityBootstrap(processName: string): IdentityBootstrap {
  return orExit(processName, readIdentityBootstrap());
}

export function requireStop(processName: string): StopSettings {
  return orExit(processName, readStop());
}

export function requireRunningImage(processName: string): RunningImage {
  return orExit(processName, readRunningImage());
}

const orExit = <T>(processName: string, read: Result<T>): T => {
  if (!read.ok) {
    logger.error({ reason: read.error.message }, `${processName} cannot start`);
    process.exit(1);
  }
  return read.value;
};
