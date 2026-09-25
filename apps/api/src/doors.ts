import { Pool } from "pg";

import { err, systemClock, type Clock, type Result } from "@better-answers/core/kernel";
import { openGit, type GitDoor } from "@better-answers/core/store/git";
import {
  closeObjects,
  openObjects,
  type ObjectDoor,
  type ObjectStoreSettings,
} from "@better-answers/core/store/objects";
import { openPostgres, type PostgresDoor } from "@better-answers/core/store/postgres";

/**
 * One budget for every pool this root opens: requests, the MCP surface, sign-in, the tick and a
 * sweep pass, whose lock holds a connection throughout.
 */
export const POSTGRES_POOL_MAX = 10;

/**
 * Absent is a store nothing configured; a refusal is one configured that would not open, said
 * as its operator needs it.
 */
export type DoorTold<T> = Result<T, string> | undefined;

export type Doors = {
  readonly postgres: PostgresDoor;

  readonly git: DoorTold<GitDoor>;

  readonly objects: DoorTold<ObjectDoor>;
  readonly clock: Clock;
};

export type DoorSettings = {
  readonly database: Pool | string;

  readonly gitStoreDir?: string | undefined;

  readonly objectStore?: ObjectStoreSettings | undefined;

  readonly clock?: Clock | undefined;
};

const bundleStoreAt = (root: string): Result<GitDoor, string> => {
  const git = openGit(root);
  return git.ok ? git : err(`the repositories' root is ${git.error} (GIT_STORE_DIR=${root})`);
};

const objectStoreOf = (settings: ObjectStoreSettings): Result<ObjectDoor, string> => {
  const objects = openObjects(settings);
  return objects.ok
    ? objects
    : err(`the object store is ${objects.error} (S3_ENDPOINT=${settings.endpoint})`);
};

export const openDoors = (settings: DoorSettings): Doors => {
  const pool =
    typeof settings.database === "string"
      ? new Pool({ connectionString: settings.database, max: POSTGRES_POOL_MAX })
      : settings.database;

  return {
    postgres: openPostgres(pool),
    git: settings.gitStoreDir === undefined ? undefined : bundleStoreAt(settings.gitStoreDir),
    objects: settings.objectStore === undefined ? undefined : objectStoreOf(settings.objectStore),
    clock: settings.clock ?? systemClock(),
  };
};

export const closeDoors = async (doors: Doors): Promise<void> => {
  if (doors.objects?.ok === true) closeObjects(doors.objects.value);
  await doors.postgres.pool.end();
};

/** `absent` is the refusal said when nothing configured the store. */
export const doorTold = <T>(told: DoorTold<T>, absent: string): Result<T, string> =>
  told === undefined ? err(absent) : told;
