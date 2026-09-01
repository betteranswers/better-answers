import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import type { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  CimdTransportError,
  createClientMetadataFetcher,
  type LookedUpAddress,
  type Lookup,
} from "../lifts/better-auth-cimd-node/index.ts";

/**
 * The lift's contract test (`[APP4]`): the Node 20+ fix — the socket's `{ all: true }`
 * lookup answered with an array — and the SSRF policy ADR 0009 owns, each refusal
 * its own test (`[SEC3]`). No network: the resolver and the request function are the
 * transport's parameters, replaced here with in-memory ones (`[TEST3]`).
 */

type LookupOptions = { readonly all?: boolean };
type LookupCallback = (
  error: Error | null,
  address: string | readonly { readonly address: string; readonly family: number }[],
  family?: number,
) => void;

/** What the fake `https.request` records: the options it was handed and the lookup it ran. */
type Observed = {
  lookupAnswers: unknown[];
  headers: Readonly<Record<string, string>>;
  servername: string | undefined;
};

const publicAnswer: LookedUpAddress = { address: "104.18.32.47", family: 4 };
const resolvesTo =
  (...answers: LookedUpAddress[]): Lookup =>
  async () =>
    answers;

/** A request function that answers with `status`, `body` and `headers`, exercising the lookup both ways. */
const answering = (
  observed: Observed,
  response: {
    status: number;
    body?: string | Buffer;
    headers?: Record<string, string>;
    delayMs?: number;
  },
): typeof httpsRequest =>
  ((
    _url: string | URL,
    options: {
      headers?: Record<string, string>;
      servername?: string;
      lookup?: unknown;
      signal?: AbortSignal;
    },
    callback?: (res: IncomingMessage) => void,
  ) => {
    observed.headers = options.headers ?? {};
    observed.servername = options.servername;
    const lookup = options.lookup as
      | ((h: string, o: LookupOptions, cb: LookupCallback) => void)
      | undefined;
    // Node 20+ under autoSelectFamily asks for all addresses; older Node for one.
    lookup?.("ignored", { all: true }, (_error, address) => observed.lookupAnswers.push(address));
    lookup?.("ignored", {}, (_error, address, family) =>
      observed.lookupAnswers.push([address, family]),
    );

    const request = new EventEmitter() as ClientRequest;
    request.end = () => request;
    request.destroy = () => request;
    const deliver = () => {
      const incoming = Readable.from([Buffer.from(response.body ?? "")]) as IncomingMessage;
      incoming.statusCode = response.status;
      incoming.statusMessage = "OK";
      incoming.headers = response.headers ?? {};
      callback?.(incoming);
    };
    if (response.delayMs === undefined) queueMicrotask(deliver);
    else {
      const timer = setTimeout(deliver, response.delayMs);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        const abort = new Error("aborted");
        abort.name = "AbortError";
        request.emit("error", abort);
      });
    }
    return request;
  }) as unknown as typeof httpsRequest;

const observe = (): Observed => ({ lookupAnswers: [], headers: {}, servername: undefined });

describe("the CIMD transport's fix", () => {
  it("answers the socket's all-addresses lookup with an array and the single form with an address", async () => {
    const observed = observe();
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observed, { status: 200, body: "{}" }),
    });

    const response = await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(response.status).toBe(200);
    expect(observed.lookupAnswers).toEqual([
      [{ address: "104.18.32.47", family: 4 }],
      ["104.18.32.47", 4],
    ]);
  });

  it("keeps the original hostname as Host and SNI while connecting to the pinned address", async () => {
    const observed = observe();
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observed, { status: 200, body: "{}" }),
    });

    await fetcher("https://claude.ai/oauth/mcp-oauth-client-metadata");

    expect(observed.headers["host"]).toBe("claude.ai");
    expect(observed.servername).toBe("claude.ai");
  });
});

describe("the SSRF policy", () => {
  const refusal = async (
    fetcher: ReturnType<typeof createClientMetadataFetcher>,
    url: string,
    init?: RequestInit,
  ) => {
    try {
      await fetcher(url, init);
    } catch (error) {
      return error instanceof CimdTransportError ? error.reason : String(error);
    }
    return "fetched";
  };

  it("refuses anything but https", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observe(), { status: 200 }),
    });
    expect(await refusal(fetcher, "http://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(
      "not-https",
    );
  });

  it("refuses any method but GET and HEAD", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observe(), { status: 200 }),
    });
    expect(await refusal(fetcher, "https://claude.ai/x", { method: "POST" })).toBe(
      "method-not-allowed",
    );
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private (RFC 1918)", "10.0.0.5"],
    ["private (RFC 1918)", "192.168.1.1"],
    ["link-local (cloud metadata)", "169.254.169.254"],
    ["CGNAT / shared address space", "100.64.0.1"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local", "fd00::1"],
  ])(
    "refuses a hostname that resolves to a %s address (%s), before any packet leaves",
    async (_class, address) => {
      const observed = observe();
      const fetcher = createClientMetadataFetcher({
        lookup: resolvesTo({ address, family: address.includes(":") ? 6 : 4 }),
        request: answering(observed, { status: 200 }),
      });

      expect(await refusal(fetcher, "https://evil.example/doc")).toBe("address-not-public");
      expect(observed.lookupAnswers).toEqual([]);
    },
  );

  it("refuses when any one answer is private, even if the first is public", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer, { address: "10.0.0.5", family: 4 }),
      request: answering(observe(), { status: 200 }),
    });
    expect(await refusal(fetcher, "https://evil.example/doc")).toBe("address-not-public");
  });

  it("refuses a hostname with no answers", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(),
      request: answering(observe(), { status: 200 }),
    });
    expect(await refusal(fetcher, "https://nowhere.example/doc")).toBe("no-addresses");
  });

  it("returns a redirect and never follows it — a location to a private address is never fetched", async () => {
    let lookups = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: async () => {
        lookups += 1;
        return [publicAnswer];
      },
      request: answering(observe(), {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data" },
      }),
    });

    const response = await fetcher("https://claude.ai/doc");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://169.254.169.254/latest/meta-data");
    expect(lookups).toBe(1);
  });

  it("refuses a response past the cap while streaming it", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observe(), { status: 200, body: Buffer.alloc(70 * 1024, "a") }),
      maxBodyBytes: 64 * 1024,
    });

    const response = await fetcher("https://claude.ai/doc");

    await expect(response.text()).rejects.toMatchObject({ reason: "response-too-large" });
  });

  it("refuses a fetch that outlives the timeout", async () => {
    const fetcher = createClientMetadataFetcher({
      lookup: resolvesTo(publicAnswer),
      request: answering(observe(), { status: 200, delayMs: 200 }),
      timeoutMs: 20,
    });

    expect(await refusal(fetcher, "https://claude.ai/doc")).toBe("timeout");
  });

  it("reuses a host's pinned answer inside the cache window and resolves again after it", async () => {
    let lookups = 0;
    let clock = 0;
    const fetcher = createClientMetadataFetcher({
      lookup: async () => {
        lookups += 1;
        return [publicAnswer];
      },
      request: answering(observe(), { status: 200, body: "{}" }),
      hostCacheMs: 1_000,
      now: () => clock,
    });

    await fetcher("https://claude.ai/doc");
    await fetcher("https://claude.ai/doc");
    clock = 2_000;
    await fetcher("https://claude.ai/doc");

    expect(lookups).toBe(2);
  });
});
