import type { httpLink } from "@trpc/client";

import { UPLOAD_HEADER_OF_FIELD } from "./link.ts";

type Fetch = NonNullable<Parameters<typeof httpLink>[0]["fetch"]>;

export type UploadProgress = {
  readonly sentBytes: number;
  readonly totalBytes: number;
};

type Watcher = (progress: UploadProgress) => void;

const watchers = new Map<string, Watcher>();

// The binding's id is minted before the bytes leave, so it names the upload a form is watching.
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

const addressOf = (url: Parameters<Fetch>[0]): string => {
  if (typeof url === "string") return url;
  return url instanceof URL ? url.href : url.url;
};

// `fetch` reports nothing of a body on its way out; the XMLHttpRequest's upload does.
export const sentWithProgress: Fetch = (url, init) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(init?.method ?? "POST", addressOf(url));
    const headers = new Headers(init?.headers ?? undefined);
    headers.forEach((value, name) => {
      request.setRequestHeader(name, value);
    });

    const bindingId = bindingIdOf(headers);
    const watcher = bindingId === undefined ? undefined : watchers.get(bindingId);
    request.upload.addEventListener("progress", (event) => {
      watcher?.({ sentBytes: event.loaded, totalBytes: event.total });
    });

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
    init?.signal?.addEventListener("abort", () => {
      request.abort();
    });

    const body = init?.body;
    request.send(body instanceof Blob || typeof body === "string" ? body : null);
  });
