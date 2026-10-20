import {
  httpBatchLink,
  httpBatchStreamLink,
  httpLink,
  isNonJsonSerializable,
  splitLink,
} from "@trpc/client";
import type { Operation, OperationContext } from "@trpc/client";

import {
  ANSWERING_WORKSPACE_HEADER,
  TAB_WORKSPACE_HEADER,
} from "@better-answers/schema/tab-workspace";
import {
  type HeaderOfEachField,
  UPLOAD_HEADER_OF_FIELD,
} from "@better-answers/schema/upload-headers";

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

const HEADER_OF_FIELD = new Map<string, string>(
  Object.entries(UPLOAD_HEADER_OF_FIELD satisfies HeaderOfEachField<UploadDescriptor>),
);

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
  readonly forAWrite: () => string | undefined;
  readonly answeredIn: (workspaceId: string) => void;
};

type LinkFetch = NonNullable<Parameters<typeof httpBatchLink>[0]["fetch"]>;

const fromTheNetwork: LinkFetch = (url, init) =>
  fetch(url, {
    method: init?.method ?? "GET",
    headers: new Headers(init?.headers),
    body: init?.body ?? null,
    signal: init?.signal ?? null,
  });

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
  const namingTheWorkspace = (sent: Headers, ops: readonly Operation[]): Headers => {
    const headers = new Headers(sent);
    const named = ops.some((op) => op.type === "mutation")
      ? namedWorkspace.forAWrite()
      : namedWorkspace.forARead();
    if (named !== undefined) headers.set(TAB_WORKSPACE_HEADER, named);
    return headers;
  };
  const sent = options.fetch ?? fromTheNetwork;
  const hearingTheWorkspace: LinkFetch = async (url, init) => {
    const answered = await sent(url, init);
    const answering =
      answered instanceof Response ? answered.headers.get(ANSWERING_WORKSPACE_HEADER) : null;
    if (answering !== null) namedWorkspace.answeredIn(answering);
    return answered;
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
        fetch: hearingTheWorkspace,
        maxURLLength: BATCH_URL_CEILING,
        headers: ({ opList }) => namingTheWorkspace(new Headers(), opList),
      }),
    }),
  });
};
