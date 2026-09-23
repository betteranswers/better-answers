import type { z } from "zod";

import {
  err,
  MALFORMED,
  ok,
  parse,
  type IssueWord,
  type Malformed,
  type Result,
} from "@better-answers/core/kernel";
import { bindUploadFields, type BindUploadFields } from "@better-answers/core/sources";
import type { ObjectDoor } from "@better-answers/core/store/objects";
import type { PostgresDoor } from "@better-answers/core/store/postgres";

import { doorTold, type Doors } from "../doors.ts";

// Outside the router's types: the web's wrapper is kept in step by hand, and the api harness
// holds the pair.
export const UPLOAD_DESCRIPTOR_HEADERS = {
  bindingId: "x-upload-binding-id",
  name: "x-upload-name",
  fileName: "x-upload-file-name",
  mediaType: "x-upload-media-type",
  byteSize: "x-upload-byte-size",
  sensitivity: "x-upload-sensitivity",
  audience: "x-upload-audience",
  audienceGroups: "x-upload-audience-groups",
} as const satisfies Record<keyof z.input<typeof bindUploadFields>, string>;

// A header carries bytes and a name may not be one, so each value is its JSON, percent-encoded.
const decoded = (sent: string): Result<z.JSONType, IssueWord> => {
  try {
    const value: z.JSONType = JSON.parse(decodeURIComponent(sent));
    return ok(value);
  } catch {
    // Either step throwing says the value was never encoded, which is that field's refusal.
    return err("bad-format");
  }
};

export const descriptorOf = (headers: Headers): Result<BindUploadFields, Malformed> => {
  const gathered: Record<string, z.JSONType> = {};
  const unreadable: Record<string, IssueWord> = {};
  for (const [field, header] of Object.entries(UPLOAD_DESCRIPTOR_HEADERS)) {
    const sent = headers.get(header);
    if (sent === null) continue;
    const read = decoded(sent);
    if (read.ok) gathered[field] = read.value;
    else unreadable[field] = read.error;
  }
  const parsed = parse(bindUploadFields, gathered);
  if (Object.keys(unreadable).length === 0) return parsed;
  const refused = parsed.ok ? {} : parsed.error.fields;
  return err({ word: MALFORMED, fields: { ...refused, ...unreadable } });
};

export type UploadDoors = { readonly postgres: PostgresDoor; readonly objects: ObjectDoor };

export const uploadDoorsOf = (doors: Doors): Result<UploadDoors, Error> => {
  const objects = doorTold(doors.objects, "no object store is configured");
  return objects.ok
    ? ok({ postgres: doors.postgres, objects: objects.value })
    : err(new Error(`the upload has nowhere to land: ${objects.error}`));
};
