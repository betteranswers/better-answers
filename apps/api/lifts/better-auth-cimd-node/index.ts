import { lookup as dnsLookup } from "node:dns/promises";
import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { isPublicRoutableHost } from "@better-auth/core/utils/host";

const BODY_FORBIDDEN_RESPONSE_STATUSES = new Set([204, 205, 304]);

export type LookedUpAddress = { readonly address: string; readonly family: 4 | 6 };
export type Lookup = (hostname: string) => Promise<readonly LookedUpAddress[]>;
/**
 * Only what the fetcher reads: Node's `request` fits, and so does a double built from an
 * `EventEmitter` and a `Readable`.
 */
export type InboundResponse = Readable & {
  readonly statusCode?: number | undefined;
  readonly statusMessage?: string | undefined;
  readonly headers: IncomingHttpHeaders;
};
export type OutboundRequest = {
  once(event: "error", listener: (error: NodeJS.ErrnoException) => void): void;
  end(): void;
  destroy(): void;
};
export type HttpsRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: InboundResponse) => void,
) => OutboundRequest;

export type ClientMetadataFetcherOptions = {
  readonly lookup?: Lookup;
  readonly request?: HttpsRequest;
};

const nodeLookup: Lookup = async (hostname) => {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => ({
    address: answer.address,
    family: answer.family === 6 ? 6 : 4,
  }));
};

const responseHeaders = (raw: NodeJS.Dict<string | string[]>): Headers => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.append(name, value);
  }
  return headers;
};

const publicPinOf = (addresses: readonly LookedUpAddress[]): LookedUpAddress => {
  const [pinned] = addresses;
  if (pinned === undefined) throw new TypeError("metadata hostname returned no DNS addresses");
  if (!addresses.every((answer) => isPublicRoutableHost(answer.address))) {
    throw new TypeError("metadata hostname must resolve only to public-routable addresses");
  }
  return pinned;
};

/**
 * Node's resolver cannot be cancelled: a lookup abandoned at the signal keeps a thread-pool
 * thread until it settles, so it still counts here.
 */
const MAX_INFLIGHT_LOOKUPS = 32;

/** The resolver and the request function are parameters so the policy is testable offline. */
export const createClientMetadataFetcher = (options: ClientMetadataFetcherOptions = {}) => {
  const lookup = options.lookup ?? nodeLookup;
  const request = options.request ?? httpsRequest;
  let inFlight = 0;

  /** Guard: upstream's lookup takes no signal, so a stalled resolver outlives the deadline. */
  const lookupUntilAborted = (
    hostname: string,
    signal: AbortSignal,
  ): Promise<readonly LookedUpAddress[]> => {
    signal.throwIfAborted();
    if (inFlight >= MAX_INFLIGHT_LOOKUPS) {
      throw new TypeError("too many metadata hostnames resolving at once");
    }
    inFlight += 1;
    const release = () => {
      inFlight -= 1;
    };
    const resolving = Promise.resolve().then(() => lookup(hostname));
    resolving.then(release, release);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      resolving.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };

  const fetchClientMetadataResource = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const webRequest = new Request(input, init);
    const url = new URL(webRequest.url);
    if (url.protocol !== "https:") {
      throw new TypeError("CIMD Node transport requires an HTTPS URL");
    }
    if (webRequest.method !== "GET" && webRequest.method !== "HEAD") {
      throw new TypeError("CIMD Node transport supports only GET and HEAD");
    }

    const signal = init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);
    const pinned = publicPinOf(await lookupUntilAborted(url.hostname, signal));

    const headers = Object.fromEntries(webRequest.headers.entries());
    headers["host"] = url.host;

    return new Promise<Response>((resolve, reject) => {
      const outbound = request(
        url,
        {
          agent: false,
          headers,
          method: webRequest.method,
          servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? url.hostname : undefined,
          signal,
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions.all === true) {
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            } else {
              callback(null, pinned.address, pinned.family);
            }
          },
        },
        (response) => {
          const status = response.statusCode ?? 500;
          const body =
            webRequest.method === "HEAD" || BODY_FORBIDDEN_RESPONSE_STATUSES.has(status)
              ? null
              : Readable.toWeb(response);
          // Guard: `Response` throws on a status outside 200–599, and a throw in this callback
          // is uncaught, so it would end the process.
          try {
            resolve(
              new Response(body, {
                headers: responseHeaders(response.headers),
                status,
                statusText: response.statusMessage ?? "",
              }),
            );
          } catch (cause) {
            response.destroy();
            reject(
              new TypeError(`a Response cannot carry the metadata reply (status ${status})`, {
                cause,
              }),
            );
          }
        },
      );
      outbound.once("error", reject);
      outbound.end();
    });
  };

  return fetchClientMetadataResource;
};
