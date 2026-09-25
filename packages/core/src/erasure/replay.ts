import { boundarySchemas } from "@better-answers/schema";
import { z } from "zod";

import { attempt, err, ok, type PlatformPrincipal, type Result } from "../kernel/index.ts";
import {
  getPlatformObject,
  listPlatformObjects,
  putPlatformObject,
  type ObjectDoor,
} from "../store/objects/index.ts";
import { ERASURE_FAMILIES, PERSONAL_DATA_CATEGORIES, type ErasureMap } from "./map.ts";
import type { SubjectIdentifiers } from "./requests.ts";

const REPLAY_PREFIX = "erasures/";

const replayCopyKeyOf = (workspaceId: string, erasureRequestId: string): string =>
  `${REPLAY_PREFIX}${workspaceId}/${erasureRequestId}.json`;

export type ReplayCopy = {
  readonly workspaceId: string;
  readonly subjectRequestId: string;
  readonly erasureRequestId: string;

  readonly personId?: string;

  readonly pseudonym: string;

  readonly completedAt: string;

  readonly identifiers: SubjectIdentifiers | null;
  readonly map: ErasureMap;
};

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(bytes);
      controller.close();
    },
  });

export const writeReplayCopy = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  completed: {
    readonly workspaceId: string;
    readonly subjectRequestId: string;
    readonly erasureRequestId: string;
    readonly personId: string | null;
    readonly pseudonym: string;
    readonly completedAt: Date;
    readonly identifiers: SubjectIdentifiers | null;
    readonly map: ErasureMap;
  },
): Promise<void> => {
  const named = {
    workspaceId: completed.workspaceId,
    subjectRequestId: completed.subjectRequestId,
    erasureRequestId: completed.erasureRequestId,
    pseudonym: completed.pseudonym,
    completedAt: completed.completedAt.toISOString(),
    identifiers: completed.identifiers,
    map: completed.map,
  };

  const copy: ReplayCopy =
    completed.personId === null ? named : { ...named, personId: completed.personId };

  const written = await putPlatformObject(
    platform,
    door,
    replayCopyKeyOf(completed.workspaceId, completed.erasureRequestId),
    streamOf(new TextEncoder().encode(JSON.stringify(copy, null, 2))),
  );
  if (!written.ok) {
    throw new Error(`erasure: the replay copy's key was refused (${written.error})`);
  }
};

const COPY_AS_READ = z.object({
  workspaceId: boundarySchemas.workspace.select.shape.id,
  subjectRequestId: boundarySchemas.subjectRequest.select.shape.id,
  erasureRequestId: boundarySchemas.erasureRequest.select.shape.id,

  personId: boundarySchemas.user.select.shape.id.optional(),
  pseudonym: boundarySchemas.erasureRequest.select.shape.pseudonym,
  completedAt: z.iso.datetime(),
  identifiers: boundarySchemas.subjectRequest.select.shape.identifiers,
  map: z.array(
    z.object({
      family: z.enum(ERASURE_FAMILIES),
      categories: z.array(z.enum(PERSONAL_DATA_CATEGORIES)),
      locations: z.array(z.string()),
    }),
  ),
});

const copyOf = (parsed: z.infer<typeof COPY_AS_READ>): ReplayCopy => {
  const named = {
    workspaceId: parsed.workspaceId,
    subjectRequestId: parsed.subjectRequestId,
    erasureRequestId: parsed.erasureRequestId,
    pseudonym: parsed.pseudonym,
    completedAt: parsed.completedAt,
    identifiers: parsed.identifiers,
    map: parsed.map,
  };
  return parsed.personId === undefined ? named : { ...named, personId: parsed.personId };
};

const copyAt = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  key: string,
): Promise<ReplayCopy> => {
  const got = await getPlatformObject(platform, door, key);
  if (!got.ok)
    throw new Error(`erasure: the replay copy at ${key} was not readable (${got.error})`);
  const parsed = COPY_AS_READ.safeParse(JSON.parse(await new Response(got.value).text()));
  if (!parsed.success) {
    throw new Error(`erasure: the replay copy at ${key} is not a replay copy`, {
      cause: parsed.error,
    });
  }
  return copyOf(parsed.data);
};

/** Copies completed after `since`, not at it. One unreadable copy answers an error. */
export const replayCopiesSince = async (
  platform: PlatformPrincipal,
  door: ObjectDoor,
  since: Date,
): Promise<Result<readonly ReplayCopy[], Error>> => {
  const listed = await attempt(() => listPlatformObjects(platform, door, REPLAY_PREFIX));
  if (!listed.ok) return err(listed.error);
  if (!listed.value.ok) {
    return err(new Error(`erasure: the replay prefix was refused (${listed.value.error})`));
  }

  const copies: ReplayCopy[] = [];
  for (const key of listed.value.value) {
    const read = await attempt(() => copyAt(platform, door, key));
    if (!read.ok) return err(read.error);
    if (new Date(read.value.completedAt).getTime() > since.getTime()) copies.push(read.value);
  }
  return ok(copies);
};
