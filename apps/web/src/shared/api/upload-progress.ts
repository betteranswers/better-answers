import type { httpLink } from "@trpc/client";

import { UPLOAD_HEADER_OF_FIELD } from "./link.ts";

type Fetch = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

type Init = Parameters<Fetch>[1];

export type UploadProgress = {
  readonly sentBytes: number;
  readonly totalBytes: number;
};

type Watcher = (progress: UploadProgress) => void;

const watchers = new Map<string, Watcher>();

/** The binding's id is minted before the bytes leave, so it names the upload a form is watching. */
export const watchUpload = (bindingId: string, watcher: Watcher): (() => void) => {
  watchers.set(bindingId, watcher);
  return () => {
    watchers.delete(bindingId);
  };
};

const bindingIdOf = (headers: Headers): string | undefined => {
  const held = headers.get(UPLOAD_HEADER_OF_FIELD.bindingId);
  if (held === null) return undefined;
  const parsed: unknown = JSON.parse(decodeURIComponent(held));
  return typeof parsed === "string" ? parsed : undefined;
};

const watcherOf = (headers: Headers): Watcher | undefined => {
  const bindingId = bindingIdOf(headers);
  return bindingId === undefined ? undefined : watchers.get(bindingId);
};

const addressOf = (url: Parameters<Fetch>[0]): string => {
  if (typeof url === "string") return url;
  return url instanceof URL ? url.href : url.url;
};

const bodyOf = (init: Init): Blob | string | null => {
  const body = init?.body;
  return body instanceof Blob || typeof body === "string" ? body : null;
};

/** Settles as `fetch` does: a TypeError if the api is not reached, an AbortError if abandoned. */
const settleLikeFetch = (
  request: XMLHttpRequest,
  resolve: (response: Response) => void,
  reject: (failure: Error) => void,
): void => {
  request.addEventListener("load", () => {
    resolve(
      new Response(request.responseText, {
        status: request.status,
        headers: { "content-type": request.getResponseHeader("content-type") ?? "" },
      }),
    );
  });
  request.addEventListener("error", () => {
    reject(new TypeError("the upload did not reach the api"));
  });
  request.addEventListener("abort", () => {
    reject(new DOMException("the upload was abandoned", "AbortError"));
  });
};

/** `fetch` reports nothing of a body on its way out; the XMLHttpRequest's upload does. */
export const sentWithProgress: Fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(init?.method ?? "POST", addressOf(url));
    const headers = new Headers(init?.headers ?? undefined);
    headers.forEach((value, name) => {
      request.setRequestHeader(name, value);
    });

    const watcher = watcherOf(headers);
    request.upload.addEventListener("progress", (event) => {
      watcher?.({ sentBytes: event.loaded, totalBytes: event.total });
    });

    settleLikeFetch(request, resolve, reject);
    init?.signal?.addEventListener("abort", () => {
      request.abort();
    });

    request.send(bodyOf(init));
  });
