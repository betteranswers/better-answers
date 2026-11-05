import { ULID_CHARACTERS } from "../ulid.ts";

export const PROCESS_PREFIX = "process:better-answers-";

/**
 * Only characters that JavaScript and Postgres regular expressions read the same way, so the
 * boundary check and the column CHECK always agree about a row.
 */
export const ACTOR_ID_PATTERN = `(human:${ULID_CHARACTERS}|${PROCESS_PREFIX}[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)`;

export const ACTOR_ID = new RegExp(`^${ACTOR_ID_PATTERN}$`, "u");
