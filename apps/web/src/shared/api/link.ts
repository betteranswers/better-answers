import {
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
  isNonJsonSerializable,
  splitLink,
} from "@trpc/client";
import type { Operation, OperationContext } from "@trpc/client";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

export type UploadDescriptor = {
  readonly connectedSourceId: string;
  readonly name: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly sensitivity?: string;
  readonly audience?: string;
  readonly audienceGroups?: readonly string[] | null;
};

export const UPLOAD_HEADER_OF_FIELD = {
  connectedSourceId: "x-upload-connected-source-id",
  name: "x-upload-name",
  fileName: "x-upload-file-name",
  mediaType: "x-upload-media-type",
  byteSize: "x-upload-byte-size",
  sensitivity: "x-upload-sensitivity",
  audience: "x-upload-audience",
  audienceGroups: "x-upload-audience-groups",
} as const satisfies Record<keyof UploadDescriptor, string>;

const HEADER_OF_FIELD = new Map<string, string>(Object.entries(UPLOAD_HEADER_OF_FIELD));

const UPLOAD_CONTEXT = "upload";

export const uploadOptions = (descriptor: UploadDescriptor) => {
  const headers = new Headers();
  for (const [field, value] of Object.entries(descriptor)) {
    const header = HEADER_OF_FIELD.get(field);
    if (header === undefined) continue;
    headers.set(header, encodeURIComponent(JSON.stringify(value)));
  }
  return { context: { [UPLOAD_CONTEXT]: headers } };
};

const uploadHeadersOf = (context: OperationContext): Headers => {
  const held = context[UPLOAD_CONTEXT];
  return held instanceof Headers ? held : new Headers();
};

export type NamedWorkspace = {
  readonly forARead: () => string | undefined;
  readonly forAWrite: () => Promise<string | undefined>;
};

type ApiLinkOptions = Pick<Parameters<typeof httpBatchLink>[0], "url" | "fetch"> & {
  readonly uploadFetch?: Parameters<typeof httpLink>[0]["fetch"];
  readonly namedWorkspace: NamedWorkspace;
};

/**
 * A batch carries its inputs in the address, and an address past this length is one some proxies
 * refuse; the link splits the batch instead.
 */
const BATCH_URL_CEILING = 2083;

const STREAMED_PATH = "ask.question";

export const apiLink = ({ uploadFetch, namedWorkspace, ...options }: ApiLinkOptions) => {
  const uploading = uploadFetch === undefined ? options : { ...options, fetch: uploadFetch };
  const namingTheWorkspace = async (sent: Headers, ops: readonly Operation[]): Promise<Headers> => {
    const headers = new Headers(sent);
    const named = ops.some((op) => op.type === "mutation")
      ? await namedWorkspace.forAWrite()
      : namedWorkspace.forARead();
    if (named !== undefined) headers.set(TAB_WORKSPACE_HEADER, named);
    return headers;
  };
  return splitLink({
    condition: (op) => isNonJsonSerializable(op.input),
    true: httpLink({
      ...uploading,
      headers: ({ op }) => namingTheWorkspace(uploadHeadersOf(op.context), [op]),
    }),
    false: splitLink({
      condition: (op) => op.path === STREAMED_PATH,
      true: httpBatchStreamLink({
        ...options,
        maxItems: 1,
        headers: ({ opList }) => namingTheWorkspace(new Headers(), opList),
      }),
      false: httpBatchLink({
        ...options,
        maxURLLength: BATCH_URL_CEILING,
        headers: ({ opList }) => namingTheWorkspace(new Headers(), opList),
      }),
    }),
  });
};
