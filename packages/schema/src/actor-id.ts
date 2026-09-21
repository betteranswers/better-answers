import { ULID_CHARACTERS } from "./ulid.ts";

export const ACTOR_ID_PATTERN = `(human:${ULID_CHARACTERS}|process:better-answers-[a-z0-9][a-z0-9-]*|better-answers-[a-z0-9][a-z0-9-]*/[0-9A-Za-z.-]+)`;

export const ACTOR_ID = new RegExp(`^${ACTOR_ID_PATTERN}$`);

export const PLATFORM_ACTOR_PREFIX = "process:better-answers-";
