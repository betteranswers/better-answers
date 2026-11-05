import { serve } from "@hono/node-server";
import { describe, expect, it } from "vitest";

import { objectStoreForSuite } from "@better-answers/core/testing/objects";

import { fetchHonouringHost } from "../../src/ops/http-fetch.ts";
import { runOps, type OpsIo } from "../../src/ops/index.ts";
import { PUBLIC_URL } from "../support/harness/harness.ts";
import { opsRunner, ioFor } from "../support/ops-run.ts";
import { servedApp } from "../support/suite-app.ts";

const objects = objectStoreForSuite();
const { doorsFrom, ops } = opsRunner(objects);

describe("pnpm ops", () => {
  const served = servedApp();

  describe("smoke, which checks that the platform answers over HTTP", () => {
    it("passes health, metadata, challenge, and shell checks on the api", async () => {
      const run = await ops(served(), ["smoke", "--url", PUBLIC_URL, "--find", "--guide", "--ask"]);

      expect(run.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
      expect(run.exitCode).toBe(0);
      expect(run.lines.filter((line) => line.startsWith("ok  "))).toHaveLength(4);

      expect(run.lines.filter((line) => line.startsWith("note "))).toHaveLength(3);
    });

    it("passes on loopback by sending the app hostname as Host", async () => {
      let listener: ReturnType<typeof serve> | undefined;
      const port = await new Promise<number>((resolve) => {
        listener = serve({ fetch: served().server.fetch, port: 0, hostname: "127.0.0.1" }, (info) =>
          resolve(info.port),
        );
      });
      const url = `http://127.0.0.1:${port}`;
      try {
        const io = ioFor(served());
        const withHost: OpsIo = { ...io, fetch: fetchHonouringHost };
        const doors = doorsFrom(served(), served().database.pool);
        expect(await runOps(["smoke", "--url", url], doors, withHost)).toBe(0);
        expect(io.lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);

        const bare: OpsIo = {
          ...ioFor(served()),
          fetch: fetchHonouringHost,
          appHostname: undefined,
        };
        expect(await runOps(["smoke", "--url", url], doors, bare)).toBe(1);
      } finally {
        await new Promise<void>((resolve) => listener?.close(() => resolve()));
      }
    });

    it("fails when nothing answers at the URL", async () => {
      const run = await ops(served(), ["smoke", "--url", "https://nowhere.example.test"]);

      expect(run.exitCode).toBe(1);
    });
  });

  describe("dump-grep, which counts a token per table without printing lines", () => {
    const dump = [
      "SET search_path = public;",
      "COPY public.person (id, email) FROM stdin;",
      "1\tjane@example.test",
      "2\tother@example.test",
      "\\.",
      "COPY public.subject_request (id, identifiers) FROM stdin;",
      'r1\t{"emails": ["jane@example.test"]}',
      "\\.",
      "COPY public.suppression (id, identifiers) FROM stdin;",
      's1\t{"emails": ["jane@example.test"]}',
      's2\t{"emails": ["jane@example.test"]}',
      "\\.",
      "",
    ].join("\n");

    it("lists each table that holds a token, or says absent", async () => {
      const run = await ops(
        served(),
        ["dump-grep", "--tokens", "jane@example.test,nobody@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "jane…st: present in 1 line(s) of table public.person",
        "jane…st: present in 1 line(s) of table public.subject_request",
        "jane…st: present in 2 line(s) of table public.suppression",
        "nobo…st: absent",
      ]);

      expect(run.lines.join("\n")).not.toContain("other@example.test");
    });

    it("reports a match outside COPY sections without naming a table", async () => {
      const outside = [
        "SET search_path = public;",
        "CREATE FUNCTION greet() RETURNS text AS $$ select 'jane@example.test' $$;",
        "COPY public.person (id, email) FROM stdin;",
        "1\tsomebody@example.test",
        "\\.",
        "",
      ].join("\n");

      const run = await ops(served(), ["dump-grep", "--tokens", "jane@example.test"], outside);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["jane…st: present in 1 line(s) outside any COPY section"]);
    });

    it("names a passage partition as its COPY header writes it", async () => {
      const partitioned = [
        'COPY index."passage_01K5ZQ8WJ6T3M4N7P9R2S0V1X" (id, workspace_id, content) FROM stdin;',
        "c1\t01K5ZQ8WJ6T3M4N7P9R2S0V1X\tClaims go to jane@example.test by Friday.",
        "\\.",
        "",
      ].join("\n");

      const run = await ops(served(), ["dump-grep", "--tokens", "jane@example.test"], partitioned);

      expect(run.lines).toEqual([
        'jane…st: present in 1 line(s) of table index."passage_01K5ZQ8WJ6T3M4N7P9R2S0V1X"',
      ]);
    });

    it("counts a token given twice only once", async () => {
      const run = await ops(
        served(),
        ["dump-grep", "--tokens", "other@example.test,other@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["othe…st: present in 1 line(s) of table public.person"]);
    });

    it("reports each token once, in the order first given", async () => {
      const run = await ops(
        served(),
        ["dump-grep", "--tokens", "other@example.test,nobody@example.test,other@example.test"],
        dump,
      );

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual([
        "othe…st: present in 1 line(s) of table public.person",
        "nobo…st: absent",
      ]);
    });

    it("never counts the COPY header's column names as a row", async () => {
      const run = await ops(served(), ["dump-grep", "--tokens", "id"], dump);

      expect(run.exitCode).toBe(0);
      expect(run.lines).toEqual(["id: absent"]);
    });
  });
});
