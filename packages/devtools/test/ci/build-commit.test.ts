import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { gitIn, throwawayRepository } from "@better-answers/devtools/throwaway-tree";

import {
  type Answer,
  deployScript,
  type Heard,
  listening,
  PATH_ONLY,
  type Ran,
  ran,
} from "./script-stand-ins.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "build-commit-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const checkout = throwawayRepository(path.join(scratch, "checkout"));
const committed = (message: string): string => {
  gitIn(checkout, "commit", "-q", "--allow-empty", "-m", message);
  return gitIn(checkout, "rev-parse", "HEAD").trim();
};
const olderOnMain = committed("the release a rollback returns to");
const mainHead = committed("the release before tonight's");
gitIn(checkout, "update-ref", "refs/remotes/origin/main", mainHead);
const unpushed = committed("main's work origin does not have yet");
gitIn(checkout, "switch", "-q", "-c", "side", olderOnMain);
const sideOnly = committed("a side branch's work");
const ABSENT = "0123456789abcdef0123456789abcdef01234567";

const DIGEST = "sha256:9ca99a42834d5f5f6023f9b2947d6dc7cc29632ee74c261829a7b0ffc529413d";
const CONFIG_DIGEST = "sha256:aa5fc55b523e532a79019046eefe45895bccddae553555148aab6094ba4feba2";
const OWNER = "betteranswers";
const IMAGE = `${OWNER}/api`;
const USER = "release-bot";
const REGISTRY_TOKEN = "ghs_registry_read_token_for_tests";
const BEARER = "registry-bearer-for-tests";
const BASIC = `Basic ${Buffer.from(`${USER}:${REGISTRY_TOKEN}`).toString("base64")}`;

const TOKEN_PATH = `/token?scope=repository:${IMAGE}:pull&service=ghcr.io`;
const MANIFEST_PATH = `/v2/${IMAGE}/manifests/${DIGEST}`;
const CONFIG_PATH = `/v2/${IMAGE}/blobs/${CONFIG_DIGEST}`;
const STORED_PATH = `/stored/${CONFIG_DIGEST}`;
const DOCKER_MANIFEST = "application/vnd.docker.distribution.manifest.v2+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";

const UNAUTHORIZED: Answer = { status: 401, body: "{}" };
const NOT_FOUND: Answer = { status: 404, body: "{}" };
const NOT_JSON: Answer = { status: 200, body: "<html>an edge's error page</html>" };

type Shelf = { readonly token: Answer; readonly manifest: Answer; readonly config: Answer };

const labelled = (labels: Readonly<Record<string, string>>): Answer => ({
  status: 200,
  body: JSON.stringify({ architecture: "amd64", os: "linux", config: { Labels: labels } }),
});

const shelfFor = (commit: string): Shelf => ({
  token: { status: 200, body: JSON.stringify({ token: BEARER }) },
  manifest: {
    status: 200,
    body: JSON.stringify({
      schemaVersion: 2,
      mediaType: DOCKER_MANIFEST,
      config: {
        mediaType: "application/vnd.docker.container.image.v1+json",
        digest: CONFIG_DIGEST,
      },
      layers: [],
    }),
  },
  config: labelled({
    "org.opencontainers.image.revision": commit,
    "org.opencontainers.image.source": "https://github.com/betteranswers/better-answers",
  }),
});

const acceptsBoth = (heard: Heard): boolean =>
  [DOCKER_MANIFEST, OCI_MANIFEST].every((type) => (heard.headers["accept"] ?? "").includes(type));

/** ghcr's answers, each behind its credential; a blob redirects to storage on another origin, as ghcr's does. */
const registry =
  (shelf: Shelf, storage: string) =>
  (heard: Heard): Answer => {
    if (heard.url === TOKEN_PATH) {
      return heard.headers["authorization"] === BASIC ? shelf.token : UNAUTHORIZED;
    }
    if (heard.headers["authorization"] !== `Bearer ${BEARER}`) return UNAUTHORIZED;
    if (heard.url === CONFIG_PATH) {
      return { status: 307, body: "", headers: { location: `${storage}${STORED_PATH}` } };
    }
    return heard.url === MANIFEST_PATH && acceptsBoth(heard) ? shelf.manifest : NOT_FOUND;
  };

type Asked = Ran & { readonly heard: readonly Heard[]; readonly stored: readonly Heard[] };

const askedAbout = async (
  shelf: Shelf,
  env: Readonly<Record<string, string>> = {},
  args: readonly string[] = [DIGEST],
): Promise<Asked> => {
  let asked: Asked = { code: null, out: "", err: "", heard: [], stored: [] };
  const storedAnswer = (heard: Heard): Answer =>
    heard.url === STORED_PATH ? shelf.config : NOT_FOUND;
  await listening(storedAnswer, async (storage, stored) => {
    await listening(registry(shelf, storage), async (origin, heard) => {
      const done = await ran(deployScript("build-commit.sh"), args, {
        ...PATH_ONLY,
        GIT_DIR: path.join(checkout, ".git"),
        OWNER,
        REGISTRY_USER: USER,
        REGISTRY_TOKEN,
        REGISTRY_URL: origin,
        ...env,
      });
      asked = { ...done, heard: [...heard], stored: [...stored] };
    });
  });
  return asked;
};

const outcome = ({ code, out, err }: Ran): Ran => ({ code, out, err });

const couldNotRun = (sentence: string): Ran => ({
  code: 1,
  out: "",
  err: `::error::${sentence}\n`,
});

const UNKNOWN = "so the api image's commit is unknown and the journeys could not run";
const NO_LABEL = `${IMAGE}@${DIGEST} has no org.opencontainers.image.revision label naming a full commit, ${UNKNOWN}`;

const request = (heard: Heard) => ({
  method: heard.method,
  url: heard.url,
  authorization: heard.headers["authorization"],
});

describe("the commit a release's journeys check out", () => {
  it("prints the commit main's head image was built from", async () => {
    expect(outcome(await askedAbout(shelfFor(mainHead)))).toEqual({
      code: 0,
      out: `${mainHead}\n`,
      err: "",
    });
  });

  it("prints an older main commit, as a rollback night needs", async () => {
    expect(outcome(await askedAbout(shelfFor(olderOnMain)))).toEqual({
      code: 0,
      out: `${olderOnMain}\n`,
      err: "",
    });
  });

  it("asks with the basic credential, then the bearer token", async () => {
    const asked = await askedAbout(shelfFor(mainHead));

    expect(asked.heard.map(request)).toEqual([
      { method: "GET", url: TOKEN_PATH, authorization: BASIC },
      { method: "GET", url: MANIFEST_PATH, authorization: `Bearer ${BEARER}` },
      { method: "GET", url: CONFIG_PATH, authorization: `Bearer ${BEARER}` },
    ]);
  });

  it("follows the blob's redirect without carrying the bearer token", async () => {
    const asked = await askedAbout(shelfFor(mainHead));

    expect(asked.stored.map(request)).toEqual([
      { method: "GET", url: STORED_PATH, authorization: undefined },
    ]);
  });
});

describe("an image whose journeys could not run", () => {
  it("refuses an image with no revision label", async () => {
    const shelf = { ...shelfFor(mainHead), config: labelled({}) };

    expect(outcome(await askedAbout(shelf))).toEqual(couldNotRun(NO_LABEL));
  });

  it("refuses a revision label that is not a full commit", async () => {
    expect(outcome(await askedAbout(shelfFor(mainHead.slice(0, 7))))).toEqual(
      couldNotRun(NO_LABEL),
    );
  });

  it.each([
    { only: "a side branch has", commit: sideOnly },
    { only: "main has, before origin's main", commit: unpushed },
  ])("refuses a commit only $only", async ({ commit }) => {
    expect(outcome(await askedAbout(shelfFor(commit)))).toEqual(
      couldNotRun(
        `${IMAGE}@${DIGEST} was built from ${commit}, which is not on origin/main, so the journeys could not run`,
      ),
    );
  });

  it("refuses a commit this checkout does not have", async () => {
    expect(outcome(await askedAbout(shelfFor(ABSENT)))).toEqual(
      couldNotRun(
        `${IMAGE}@${DIGEST} was built from ${ABSENT}, which this checkout does not have, so the journeys could not run`,
      ),
    );
  });

  it("refuses when the main it checks against is absent", async () => {
    expect(outcome(await askedAbout(shelfFor(mainHead), { MAIN_REF: "origin/release" }))).toEqual(
      couldNotRun(
        `origin/release is not in this checkout (a checkout with fetch-depth: 0 has it), so whether ${mainHead} is on main is unknown and the journeys could not run`,
      ),
    );
  });

  it("refuses a manifest that names no config", async () => {
    const index = {
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [{ digest: CONFIG_DIGEST }],
    };
    const shelf = { ...shelfFor(mainHead), manifest: { status: 200, body: JSON.stringify(index) } };

    expect(outcome(await askedAbout(shelf))).toEqual(
      couldNotRun(`the manifest of ${IMAGE}@${DIGEST} names no config, ${UNKNOWN}`),
    );
  });

  it("refuses a token answer that carries no token", async () => {
    const shelf = { ...shelfFor(mainHead), token: { status: 200, body: "{}" } };

    expect(outcome(await askedAbout(shelf))).toEqual(
      couldNotRun(
        `the registry's answer to the token request for ${IMAGE} carries no token, ${UNKNOWN}`,
      ),
    );
  });

  it.each([
    {
      step: "token",
      shelf: { ...shelfFor(mainHead), token: NOT_JSON },
      sentence: `the registry's answer to the token request for ${IMAGE} carries no token, ${UNKNOWN}`,
    },
    {
      step: "manifest",
      shelf: { ...shelfFor(mainHead), manifest: NOT_JSON },
      sentence: `the manifest of ${IMAGE}@${DIGEST} names no config, ${UNKNOWN}`,
    },
    {
      step: "config",
      shelf: { ...shelfFor(mainHead), config: NOT_JSON },
      sentence: NO_LABEL,
    },
  ])("refuses a $step answer that is not JSON", async ({ shelf, sentence }) => {
    expect(outcome(await askedAbout(shelf))).toEqual(couldNotRun(sentence));
  });
});

describe("a registry that will not answer", () => {
  it("names the status when the token request is refused", async () => {
    const asked = await askedAbout(shelfFor(mainHead), { REGISTRY_TOKEN: "not-the-token" });

    expect(asked.heard).toHaveLength(1);
    expect(outcome(asked)).toEqual(
      couldNotRun(`the registry answered 401 to the token request for ${IMAGE}, ${UNKNOWN}`),
    );
  });

  it("names the status when the manifest is not found", async () => {
    const shelf = { ...shelfFor(mainHead), manifest: NOT_FOUND };

    expect(outcome(await askedAbout(shelf))).toEqual(
      couldNotRun(
        `the registry answered 404 to the manifest request for ${IMAGE}@${DIGEST}, ${UNKNOWN}`,
      ),
    );
  });

  it("names the status the blob's storage answers", async () => {
    const shelf = { ...shelfFor(mainHead), config: { status: 403, body: "" } };

    expect(outcome(await askedAbout(shelf))).toEqual(
      couldNotRun(
        `the registry answered 403 to the config request for ${IMAGE}@${CONFIG_DIGEST}, ${UNKNOWN}`,
      ),
    );
  });

  it("refuses when the registry cannot be reached", async () => {
    let closed = "";
    await listening(
      () => UNAUTHORIZED,
      async (origin) => {
        closed = origin;
      },
    );

    const asked = await askedAbout(shelfFor(mainHead), { REGISTRY_URL: closed });

    expect({ code: asked.code, out: asked.out }).toEqual({ code: 1, out: "" });
    expect(asked.err).toMatch(
      new RegExp(
        `\n::error::the registry did not answer the token request for ${IMAGE}, ${UNKNOWN}\n$`,
        "u",
      ),
    );
  });
});

describe("the arguments and credentials it is given", () => {
  it.each([
    { given: "a short digest", digest: "sha256:9ca99a42" },
    { given: "upper-case hex", digest: DIGEST.toUpperCase().replace("SHA256", "sha256") },
    { given: "an image reference", digest: `ghcr.io/${IMAGE}@${DIGEST}` },
  ])("refuses $given as a digest, calling nothing", async ({ digest }) => {
    const asked = await askedAbout(shelfFor(mainHead), {}, [digest]);

    expect({ ...outcome(asked), heard: asked.heard.length }).toEqual({
      code: 2,
      out: "",
      err: `::error::usage: build-commit.sh <api digest> — ${digest} is not a digest (sha256: followed by 64 hex characters)\n`,
      heard: 0,
    });
  });

  it.each([
    { given: "no argument", args: [] },
    { given: "two arguments", args: [DIGEST, DIGEST] },
  ])("refuses $given, calling nothing", async ({ args }) => {
    const asked = await askedAbout(shelfFor(mainHead), {}, args);

    expect({ ...outcome(asked), heard: asked.heard.length }).toEqual({
      code: 2,
      out: "",
      err: `::error::usage: build-commit.sh <api digest> — takes one argument, and was given ${String(args.length)}\n`,
      heard: 0,
    });
  });

  it.each(["OWNER", "REGISTRY_USER", "REGISTRY_TOKEN"])(
    "refuses an empty %s, calling nothing",
    async (name) => {
      const asked = await askedAbout(shelfFor(mainHead), { [name]: "" });

      expect({ ...outcome(asked), heard: asked.heard.length }).toEqual({
        code: 1,
        out: "",
        err: `::error::${name} is empty, so the registry cannot be asked which commit the api image was built from, and the journeys could not run\n`,
        heard: 0,
      });
    },
  );

  it("never says the registry token or its bearer", async () => {
    const shelves = [
      shelfFor(mainHead),
      shelfFor(sideOnly),
      { ...shelfFor(mainHead), token: UNAUTHORIZED },
      { ...shelfFor(mainHead), manifest: NOT_FOUND },
      { ...shelfFor(mainHead), config: NOT_JSON },
    ];
    const runs = await Promise.all(shelves.map(async (shelf) => askedAbout(shelf)));
    const said = runs.map((asked) => asked.out + asked.err);

    expect(runs.map((asked) => asked.code)).toEqual([0, 1, 1, 1, 1]);
    expect(said.filter((one) => one.includes(REGISTRY_TOKEN) || one.includes(BEARER))).toEqual([]);
  });
});
