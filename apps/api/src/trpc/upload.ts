import { z } from "zod";

import {
  err,
  MALFORMED,
  ok,
  parse,
  type IssueWord,
  type Malformed,
  type Result,
} from "@better-answers/core/kernel";
import { connectUploadFields, type ConnectUploadFields } from "@better-answers/core/sources";
import type { ObjectDoor } from "@better-answers/core/store/objects";
import type { PostgresDoor } from "@better-answers/core/store/postgres";
import {
  type HeaderOfEachField,
  UPLOAD_HEADER_OF_FIELD,
} from "@better-answers/schema/upload-headers";

import { doorTold, type Doors } from "../doors.ts";

const HEADER_OF_FIELD = Object.entries(
  UPLOAD_HEADER_OF_FIELD satisfies HeaderOfEachField<z.input<typeof connectUploadFields>>,
);

/** A header carries bytes and a name may not be one, so each value is its JSON, percent-encoded. */
const decoded = (sent: string): Result<z.JSONType, IssueWord> => {
  try {
    return ok(z.json().parse(JSON.parse(decodeURIComponent(sent))));
  } catch {
    return err("bad-format");
  }
};

export const descriptorOf = (headers: Headers): Result<ConnectUploadFields, Malformed> => {
  const gathered: Record<string, z.JSONType> = {};
  const unreadable: Record<string, IssueWord> = {};
  for (const [field, header] of HEADER_OF_FIELD) {
    const sent = headers.get(header);
    if (sent === null) continue;
    const read = decoded(sent);
    if (read.ok) gathered[field] = read.value;
    else unreadable[field] = read.error;
  }
  const parsed = parse(connectUploadFields, gathered);
  if (Object.keys(unreadable).length === 0) return parsed;
  const refused = parsed.ok ? {} : parsed.error.fields;
  return err({ word: MALFORMED, fields: { ...refused, ...unreadable } });
};

export type UploadDoors = { readonly postgres: PostgresDoor; readonly objects: ObjectDoor };

export const uploadDoorsOf = (doors: Doors): Result<UploadDoors> => {
  const objects = doorTold(doors.objects, "no object store is configured");
  return objects.ok
    ? ok({ postgres: doors.postgres, objects: objects.value })
    : err(new Error(`the upload has nowhere to land: ${objects.error}`));
};
