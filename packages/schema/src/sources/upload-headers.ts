export const UPLOAD_HEADER_OF_FIELD = {
  connectedSourceId: "x-upload-connected-source-id",
  name: "x-upload-name",
  fileName: "x-upload-file-name",
  mediaType: "x-upload-media-type",
  byteSize: "x-upload-byte-size",
  sensitivity: "x-upload-sensitivity",
  audience: "x-upload-audience",
  audienceGroups: "x-upload-audience-groups",
} as const;

export type HeaderOfEachField<Fields> = Record<keyof Fields, string> &
  Record<Exclude<keyof typeof UPLOAD_HEADER_OF_FIELD, keyof Fields>, never>;
