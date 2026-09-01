import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { Readable } from "node:stream";

import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/**
 * `fetchClientMetadataResource` from `@better-auth/cimd/node` 1.7.2, lifted and fixed.
 *
 * Upstream hands Node's `https.request` a custom `lookup` that always calls back in the
 * single-address form `(err, address, family)`. Since Node 20, `autoSelectFamily`
 * (Happy Eyeballs, RFC 8305) is on by default and calls `lookup` with `{ all: true }`,
 * expecting an array; Node reads `.address` off `undefined` and throws
 * `ERR_INVALID_IP_ADDRESS` before a packet leaves the machine, so every CIMD
 * authorization fails `invalid_client`. Issue better-auth/better-auth#10810; fix PR
 * #10730 (against `next`). Removal condition in `THIRD_PARTY_NOTICES.md`.
 *
 * The SSRF policy ADR 0009 owns lives here, in the same code that replaces the lookup:
 * https only; GET/HEAD only; every resolved address refused if it is not public-routable
 * (private, loopback, link-local, CGNAT/shared address space, documentation, multicast
 * and the tunnel forms that embed one of those); the answer pinned for the connection
 * with the original hostname kept as Host and SNI; a redirect returned, never followed
 * (cap 0 — a location to a private address is therefore never fetched); a timeout; a
 * response cap; a per-host answer cache so a rebinding resolver cannot swap the address
 * between two fetches of the same host inside a window.
 *
 * Dependencies are parameters (`[DESIGN3]`, `[TEST3]`): the test injects a resolver and
 * a request function; production takes Node's.
 */

const BODY_FORBIDDEN_RESPONSE_STATUSES = new Set([204, 205, 304]);

export type LookedUpAddress = { readonly address: string; readonly family: 4 | 6 };
export type Lookup = (hostname: string) => Promise<readonly LookedUpAddress[]>;
export type HttpsRequest = typeof httpsRequest;

export type ClientMetadataFetcherOptions = {
  readonly lookup?: Lookup;
  readonly request?: HttpsRequest;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  /** How long a host's resolved answer is reused; the per-host fetch cache. */
  readonly hostCacheMs?: number;
  readonly now?: () => number;
};

export type CimdRefusal =
  | "not-https"
  | "method-not-allowed"
  | "no-addresses"
  | "address-not-public"
  | "timeout"
  | "response-too-large";

export class CimdTransportError extends TypeError {
  override readonly name = "CimdTransportError";
  readonly reason: CimdRefusal;
  constructor(reason: CimdRefusal, message: string) {
    super(message);
    this.reason = reason;
  }
}

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

/** Refuses the stream past `maxBytes` — a metadata document is a few kilobytes. */
const capped = (source: Readable, maxBytes: number, onExceeded: () => void): ReadableStream =>
  new ReadableStream({
    start(controller) {
      let seen = 0;
      let settled = false;
      const settle = (act: () => void) => {
        if (settled) return;
        settled = true;
        act();
      };
      source.on("data", (chunk: Buffer) => {
        if (settled) return;
        seen += chunk.byteLength;
        if (seen > maxBytes) {
          settle(() =>
            controller.error(
              new CimdTransportError("response-too-large", `response exceeded ${maxBytes} bytes`),
            ),
          );
          source.destroy();
          onExceeded();
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
      });
      source.on("end", () => settle(() => controller.close()));
      source.on("error", (error) => settle(() => controller.error(error)));
    },
    cancel() {
      source.destroy();
    },
  });

export const createClientMetadataFetcher = (options: ClientMetadataFetcherOptions = {}) => {
  const lookup = options.lookup ?? nodeLookup;
  const request = options.request ?? httpsRequest;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  const hostCacheMs = options.hostCacheMs ?? 60_000;
  const now = options.now ?? Date.now;
  const hostCache = new Map<string, { readonly pinned: LookedUpAddress; readonly until: number }>();

  const resolvePinned = async (hostname: string): Promise<LookedUpAddress> => {
    const cached = hostCache.get(hostname);
    if (cached !== undefined && cached.until > now()) return cached.pinned;

    const addresses = await lookup(hostname);
    if (addresses.length === 0) {
      throw new CimdTransportError("no-addresses", "metadata hostname returned no DNS addresses");
    }
    for (const answer of addresses) {
      if (!isPublicRoutableHost(answer.address)) {
        throw new CimdTransportError(
          "address-not-public",
          "metadata hostname must resolve only to public-routable addresses",
        );
      }
    }
    const [pinned] = addresses;
    if (pinned === undefined) {
      throw new CimdTransportError("no-addresses", "metadata hostname returned no DNS addresses");
    }
    hostCache.set(hostname, { pinned, until: now() + hostCacheMs });
    return pinned;
  };

  const fetchClientMetadataResource = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const webRequest = new Request(input, init);
    const url = new URL(webRequest.url);
    if (url.protocol !== "https:") {
      throw new CimdTransportError("not-https", "CIMD transport requires an HTTPS URL");
    }
    if (webRequest.method !== "GET" && webRequest.method !== "HEAD") {
      throw new CimdTransportError(
        "method-not-allowed",
        "CIMD transport supports only GET and HEAD",
      );
    }

    const pinned = await resolvePinned(url.hostname);

    const headers = Object.fromEntries(webRequest.headers.entries());
    headers["host"] = url.host;
    const callerSignal =
      init?.signal ?? (input instanceof Request ? input.signal : webRequest.signal);
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)]);

    return new Promise<Response>((resolve, reject) => {
      const outbound = request(
        url,
        {
          agent: false,
          headers,
          method: webRequest.method,
          servername: isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 ? url.hostname : undefined,
          signal,
          // The fix: answer in whichever shape the socket asked for. `all: true` is
          // what Node 20+ sends under autoSelectFamily and expects an array back.
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
              : capped(response, maxBodyBytes, () => outbound.destroy());
          // A redirect is returned as-is and never followed: the cap is 0, so no
          // second resolve can be aimed at an address the first refused.
          resolve(
            new Response(body, {
              headers: responseHeaders(response.headers),
              status,
              statusText: response.statusMessage ?? "",
            }),
          );
        },
      );
      outbound.once("error", (error: NodeJS.ErrnoException) => {
        if (error.name === "AbortError" || error.name === "TimeoutError" || signal.aborted) {
          reject(new CimdTransportError("timeout", `metadata fetch exceeded ${timeoutMs} ms`));
          return;
        }
        reject(error);
      });
      outbound.end();
    });
  };

  return fetchClientMetadataResource;
};
