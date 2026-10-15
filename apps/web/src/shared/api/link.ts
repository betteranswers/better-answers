import {
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
  isNonJsonSerializable,
  splitLink,
} from "@trpc/client";
import type { OperationContext } from "@trpc/client";

import { TAB_WORKSPACE_HEADER } from "@better-answers/schema/tab-workspace";

/**
 * The bytes are the mutation's input, so this rides beside them where the router's types never
 * reach; the api harness holds the pair.
 */
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

/**
 * A header carries bytes and a file's name may not be one, so each value is its JSON,
 * percent-encoded.
 */
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

type ApiLinkOptions = Pick<Parameters<typeof httpBatchLink>[0], "url" | "fetch"> & {
  readonly uploadFetch?: Parameters<typeof httpLink>[0]["fetch"];
  /** Asked at each send, and undefined while the tab holds no member read. */
  readonly heldWorkspace: () => string | undefined;
};

/**
 * A batch carries its inputs in the address, and an address past this length is one some proxies
 * refuse; the link splits the batch instead.
 */
const BATCH_URL_CEILING = 2083;

/** Answered as a stream: its result first, then prose as it is drafted. */
const STREAMED_PATH = "ask.question";

export const apiLink = ({ uploadFetch, heldWorkspace, ...options }: ApiLinkOptions) => {
  const uploading = uploadFetch === undefined ? options : { ...options, fetch: uploadFetch };
  const namingTheWorkspace = (sent: Headers): Headers => {
    const headers = new Headers(sent);
    const held = heldWorkspace();
    if (held !== undefined) headers.set(TAB_WORKSPACE_HEADER, held);
    return headers;
  };
  return splitLink({
    condition: (op) => isNonJsonSerializable(op.input),
    true: httpLink({
      ...uploading,
      headers: ({ op }) => namingTheWorkspace(uploadHeadersOf(op.context)),
    }),
    false: splitLink({
      condition: (op) => op.path === STREAMED_PATH,
      // Alone in its request, so no other call waits on the stream's end.
      true: httpBatchStreamLink({
        ...options,
        maxItems: 1,
        headers: () => namingTheWorkspace(new Headers()),
      }),
      false: httpBatchLink({
        ...options,
        maxURLLength: BATCH_URL_CEILING,
        headers: () => namingTheWorkspace(new Headers()),
      }),
    }),
  });
};
