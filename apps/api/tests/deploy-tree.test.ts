import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GARAGE_IMAGE } from "@better-answers/core/store/objects";
import { POSTGRES_IMAGE } from "@better-answers/schema";

/**
 * The deploy tree as a set of facts a test can read (T-005, ADR 0022). Nothing here runs a
 * box; what is held is every property of the tree the runbook and the drill rely on that a
 * quiet edit could break: a script that stops parsing, a production restore that grows the
 * drill's wipe trap, a service that loses its memory limit, a placeholder that comes back,
 * a digest the release matches loosely, the two fences drifting apart in name.
 *
 * That first sentence is why the backup image's *built* half is not here. Every assertion
 * below is text about a file; starting a container from `deploy/backup.Dockerfile` would
 * make it untrue for a reader who relies on it, so the probe lives in
 * `apps/api/tests/backup-image.test.ts` (T-084) and the two name each other.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");
// Where AGENTS.md places the public-facing operations documents. The one name a move edits:
// 529e824 moved them out of a docs-site tree and four assertions here read the old path.
const operationsDocuments = "docs/operations";

const deployScripts = (): readonly string[] =>
  readdirSync(path.join(repositoryRoot, "deploy"))
    .filter((file) => file.endsWith(".sh"))
    .sort();

/** The service names of a compose file: two-space-indented keys under `services:`. */
const composeServices = (file: string): readonly { name: string; body: string }[] => {
  const after = file.split(/^services:\s*$/m)[1] ?? "";
  const blocks = after
    .split(/^(?=  [a-z][a-z0-9_-]*:\s*$)/m)
    .filter((block) => /^  [a-z]/.test(block));
  return blocks.map((block) => ({
    name: (/^  ([a-z][a-z0-9_-]*):/.exec(block)?.[1] ?? "").trim(),
    body: block,
  }));
};

describe("the deploy tree (T-005)", () => {
  it("has a script tree that parses, every file", () => {
    for (const script of deployScripts()) {
      expect(() =>
        execFileSync("bash", ["-n", path.join(repositoryRoot, "deploy", script)], {
          stdio: "pipe",
        }),
      ).not.toThrow();
    }
    expect(deployScripts()).toEqual(
      expect.arrayContaining([
        "backup.sh",
        "host-setup.sh",
        "mirror-shell.sh",
        "restore-drill.sh",
        "restore-production.sh",
        "seed-synthetic.sh",
        "uptime-probe.sh",
        "wizard-41.sh",
      ]),
    );
  });

  it("carries no `<read on the day>` placeholder in a field that must parse", () => {
    for (const file of [
      "deploy/backup.Dockerfile",
      "deploy/stores.compose.yaml",
      "deploy/platform.compose.yaml",
      "deploy/garage.toml",
    ]) {
      const live = read(file)
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      expect({ file, placeholder: live.includes("<read on the day") }).toEqual({
        file,
        placeholder: false,
      });
    }
  });

  it("builds the backup image on the one pinned database image, so pg_dump never skews from the server ([DEPS2])", () => {
    // The claim about the Dockerfile. The claim about the image it builds — that the
    // `pg_dump` in it answers with this major — is `backup-image.test.ts`'s, against the
    // same constant.
    expect(read("deploy/backup.Dockerfile")).toContain(`FROM ${POSTGRES_IMAGE}`);
  });

  it("runs the backup service by digest from the image build.yml pushes, not from a host build", () => {
    const stores = read("deploy/stores.compose.yaml");
    expect(stores).toContain("ghcr.io/betteranswers/backup@${BACKUP_IMAGE_DIGEST:?");
    expect(stores).not.toMatch(/^\s+build:/m);
    expect(read(".github/workflows/build.yml")).toMatch(
      /tier: backup\n\s+context: deploy\n\s+dockerfile: deploy\/backup\.Dockerfile/,
    );
  });

  it("runs the object store on the one pinned Garage image, so the estate and the harness cannot skew", () => {
    // The same claim the database image's row above makes, for the other store the tree
    // pins: the constant lives with the door that opens it
    // (`packages/core/src/store/objects/garage-image.ts`), the Testcontainers harness in
    // `packages/core/test/suite-objects.ts` starts that ref, and this is what stops a
    // version move landing in one place and not the other.
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain(`image: ${GARAGE_IMAGE}`);
  });

  it("gives Garage its secrets from the environment and names no `*_file` key", () => {
    const garage = read("deploy/garage.toml");
    expect(garage).not.toMatch(/^\s*(rpc_secret_file|admin_token_file)/m);
    const objectstore = composeServices(read("deploy/stores.compose.yaml")).find(
      (service) => service.name === "objectstore",
    );
    expect(objectstore?.body).toContain("GARAGE_RPC_SECRET:");
    expect(objectstore?.body).toContain("GARAGE_ADMIN_TOKEN:");
  });

  it("puts an explicit memory limit on every VPC 1 service, and a swap allowance on the worker", () => {
    for (const file of ["deploy/stores.compose.yaml", "deploy/platform.compose.yaml"]) {
      const services = composeServices(read(file));
      expect(services.length).toBeGreaterThan(1);
      const unlimited = services
        .filter(
          (service) =>
            !(/\*mem\d+\b/.test(service.body) || /limits:\s*\{\s*memory:/.test(service.body)),
        )
        .map((service) => `${file}: ${service.name}`);
      expect(unlimited).toEqual([]);
    }
    expect(read("deploy/platform.compose.yaml")).toMatch(/^\s+memswap_limit: 3072m/m);
  });

  it("keeps the production restore free of the drill's traps: no wipe, no exit trap, no second DSN, the replay mandatory", () => {
    const script = read("deploy/restore-production.sh");
    expect(script).not.toMatch(/wipe_staging|trap .*EXIT|PROD_DATABASE_URL/);
    expect(script).not.toMatch(/rm -rf \/data/);
    // That the replay happens at all. *Where* it happens is the next case's, which holds both
    // scripts to one order rather than this one to half of it.
    expect(script).toContain("pnpm ops replay-erasures --since");
    expect(read(`${operationsDocuments}/RUNBOOK.md`)).toContain("restore-production.sh");
  });

  /**
   * The recovery order as ADR 0022's amendment of 2026-09-11 fixes it (T-125): the replay of every
   * erasure the dump undid runs AFTER Postgres, the object store and the git store are all back,
   * and still before `api` is started.
   *
   * Why the position is a property worth a test and not a detail of a script. The routine the
   * replay re-runs rewrites each workspace's bare repository with `git filter-repo` and reads the
   * replay copy every completed erasure left in the object store (ADR 0020). A replay that ran
   * ahead of those two steps — which is where both scripts ran it until this date — reads an
   * object store that has not been synced back, and rewrites a repository the git step is about
   * to overwrite from a bundle that still names the subject. Neither failure is loud: the restore
   * goes green and the estate serves reads over data a subject was told is beyond use.
   *
   * Both scripts, one order, because the drill is the production restore's rehearsal and a drill
   * whose order differs rehearses nothing. The markers are the acts rather than the step numbers,
   * so renumbering a script cannot quietly satisfy this.
   */
  it("runs the replay after the object store and the git store, and before api, in both restore scripts", () => {
    for (const file of ["deploy/restore-production.sh", "deploy/restore-drill.sh"]) {
      const script = read(file);
      const at = (needle: string): number => {
        const index = script.indexOf(needle);
        expect({ file, needle, found: index >= 0 }).toEqual({ file, needle, found: true });
        return index;
      };
      const objectStore = at("${BACKUP_MIRROR_BUCKET}/objectstore/");
      const gitStore = at("git clone --quiet --bare");
      const replay = at("replay-erasures");
      const apiUp = at("platform up -d --wait api");
      expect({ file, afterTheObjectStore: replay > objectStore }).toEqual({
        file,
        afterTheObjectStore: true,
      });
      expect({ file, afterTheGitStore: replay > gitStore }).toEqual({
        file,
        afterTheGitStore: true,
      });
      expect({ file, beforeApi: replay < apiUp }).toEqual({ file, beforeApi: true });
    }
  });

  /**
   * And the one-shot that runs it is `api`, not `migrate`. The replay needs the git store and the
   * object store, and the two services differ in exactly that: `api` carries `GIT_STORE_DIR` with
   * `/data/git` mounted and the bootstrap anchor's S3 settings, `migrate` carries the anchor
   * alone. `migrate` is not grown to suit — it is a one-shot that runs Drizzle over a journal, and
   * a git volume on it would be a store handed to a process that never touches one.
   */
  it("runs the replay's one-shot on the one service that carries the git store and the object store", () => {
    const services = composeServices(read("deploy/platform.compose.yaml"));
    const api = services.find((service) => service.name === "api");
    const migrate = services.find((service) => service.name === "migrate");
    expect(api?.body).toContain("GIT_STORE_DIR: /data/git");
    expect(api?.body).toContain("- /data/git:/data/git");
    expect(api?.body).toContain("<<: *bootstrap");
    expect(migrate?.body).not.toContain("GIT_STORE_DIR");
    expect(migrate?.body).not.toContain("/data/git");
    for (const file of ["deploy/restore-production.sh", "deploy/restore-drill.sh"]) {
      const line = read(file)
        .split("\n")
        .find((candidate) => candidate.includes("replay-erasures"));
      // `--no-deps` as well as `api`: `migrate` is a declared dependency of `api` and has already
      // run in the step above, so without it compose runs the migration a second time inside the
      // replay's own one-shot.
      expect({ file, line }).toEqual({
        file,
        line: expect.stringContaining("run --rm --no-deps api pnpm"),
      });
    }
  });

  /**
   * The five names `apps/api/src/config.ts` § readObjectStore reads, on the anchor the `api`
   * service gets. Two of them are facts of this estate rather than an operator's choice: the
   * endpoint, because Garage is reached by service name on the internal network, and the region,
   * because `garage.toml` fixes it — a region written in two files is a region that can disagree
   * with itself, and an S3 client that signs for the wrong one is refused rather than misrouted.
   */
  it("gives the api the object-store settings its door reads, the bucket named and the region matching garage.toml", () => {
    const anchor =
      read("deploy/platform.compose.yaml")
        .split("x-bootstrap: &bootstrap")[1]
        ?.split("\nservices:")[0] ?? "";
    expect(anchor).toContain("S3_ENDPOINT: http://objectstore:3900");
    expect(anchor).toContain("S3_REGION: garage");
    expect(anchor).toContain("S3_BUCKET: ${S3_BUCKET:?");
    expect(anchor).toContain("S3_ACCESS_KEY: ${OBJECTSTORE_ROOT_KEY:?}");
    expect(anchor).toContain("S3_SECRET_KEY: ${OBJECTSTORE_ROOT_SECRET:?}");
    expect(read("deploy/garage.toml")).toContain('s3_region = "garage"');
  });

  /**
   * Garage's bootstrap, which no script in this tree performed before T-125 (11/09/2026):
   * `garage key create` existed once, as a comment in `stores.compose.yaml`, and the only `garage
   * key` lines were the drill's, for staging. A production Garage therefore came up with no key
   * and no bucket, and the three values `platform.compose.yaml` requires had no source — which
   * made the restore path this file holds unrunnable, because the replay refuses when the object
   * store is unreachable. The wizard is production's half; the drill is staging's.
   */
  it("creates Garage's root key and the platform's bucket — the wizard for production, the drill for staging", () => {
    const wizard = read("deploy/wizard-41.sh");
    expect(wizard).toContain("key create platform-root");
    expect(wizard).toContain("bucket create $S3_BUCKET");
    expect(wizard).toContain("bucket allow --read --write $S3_BUCKET --key platform-root");
    expect(wizard).toContain('write_env S3_BUCKET "$S3_BUCKET"');
    // Every stage prints itself against TOTAL_STAGES, so a stage added without moving that number
    // renders "10/10" twice and tells the operator they have finished when they have not.
    const stages = [...wizard.matchAll(/^stage "/gm)].length;
    expect(wizard).toContain(`TOTAL_STAGES=${stages}`);

    const drill = read("deploy/restore-drill.sh");
    // A create without the grant leaves a bucket no key can reach, which is the same refusal in a
    // different costume, so the drill does both.
    expect(drill).toContain('/garage bucket create "${STAGING_S3_BUCKET}"');
    expect(drill).toContain(
      '/garage bucket allow --read --write "${STAGING_S3_BUCKET}" --key "${STAGING_OBJECTSTORE_ROOT_KEY}"',
    );
    expect(read("deploy/host-setup.sh")).toContain("STAGING_S3_BUCKET=");
  });

  it("runs the four graph commands the way each of them answers, and records counts it has nothing to diff", () => {
    const drill = read("deploy/restore-drill.sh");

    // The rebuild is the one that waits, because it is the one that enqueues; the sweep is
    // one transaction and answers when it has swept.
    expect(drill).toContain('ops graph-rebuild --workspace "${DRILL_WORKSPACE}" --wait');
    expect(drill).toContain('ops graph-sweep --workspace "${DRILL_WORKSPACE}"\n');
    expect(drill).not.toContain('graph-sweep --workspace "${DRILL_WORKSPACE}" --wait');
    expect(drill).toContain('ops reconcile-watermark --workspace "${DRILL_WORKSPACE}"');
    // `graph-counts` is done over an empty map, so its one line of JSON now reaches the
    // diff on every drill. Production's side is the worker's stamped run, which no task has
    // built: nothing to diff against is recorded and never read as a match, and only two
    // counts that really disagree stop the drill.
    expect(drill).toContain("no stamped run on production to diff against");
    expect(drill).toContain("COUNTS DIFFER");
  });

  it("wipes staging without a graph special case: the graph is plain tables in `public` (ADR 0032)", () => {
    const drill = read("deploy/restore-drill.sh");
    expect(drill).not.toMatch(/ag_catalog|drop_graph|\bAGE\b/);
    expect(drill).toContain("drop schema if exists public cascade");
    expect(drill).toContain("stagingstore:");
    expect(drill).toContain("seed-synthetic.sh");
  });

  it("lets the mirror key run init-repo and git-receive-pack, and nothing else", () => {
    const shell = read("deploy/mirror-shell.sh");
    expect(shell).toContain('"init-repo "*)');
    expect(shell).toContain('"git-receive-pack "*)');
    expect(shell).toContain("exec git-receive-pack");
    expect(read("deploy/host-setup.sh")).toContain(
      'command="/usr/local/bin/mirror-shell /data/mirror",restrict',
    );
    expect(read("deploy/backup.sh")).toContain("init-repo");
  });

  it("matches each promoted digest on its own through env, appends every promotion to RELEASES.md, and carries Q7's switch", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("^sha256:[0-9a-f]{64}$");
    expect(release).toMatch(
      /env:\n\s+API_DIGEST: \$\{\{ steps\.d\.outputs\.api \}\}\n\s+WORKER_DIGEST: \$\{\{ steps\.d\.outputs\.worker \}\}/,
    );
    // A digest reaches a shell line as a variable, never as a `${{ }}` interpolation (SEC10).
    const interpolated = release
      .split("\n")
      .filter((candidate) => /\$\{\{ steps\.d\.outputs/.test(candidate))
      .map((line) => line.trim())
      .filter((line) => !/^(API|WORKER)_DIGEST: /.test(line));
    expect(interpolated).toEqual([]);
    expect(release).toContain("deploy/RELEASES.md");
    expect(release).toContain("CLIENT_DATA_ON_BOX");
    expect(read("deploy/RELEASES.md")).toContain("| When (UTC) | By | api | worker | Rode on |");
    expect(read(`${operationsDocuments}/RUNBOOK.md`)).toContain("RELEASES.md");
  });

  it("has no staging job in build.yml: staging is brought up by the drill procedure", () => {
    const build = read(".github/workflows/build.yml");
    expect(build).not.toMatch(/^\s+staging:\s*$/m);
    expect(build).not.toContain("COOLIFY_STAGING_APP_UUID");
  });

  it("names the app's own fence beside the tunnel's rules, one rule per hostname role, and the two uptime paths", () => {
    const coolify = read(`${operationsDocuments}/coolify.md`);
    expect(coolify).toContain("apps/api/src/ingress/hostnames.ts");
    const unnamedRoles = ["app", "agent", "apex"].filter(
      (role) => !new RegExp(`\\b${role}\\b`).test(coolify),
    );
    expect(unnamedRoles).toEqual([]);
    expect(coolify).toContain("http_status:404");
    expect(coolify).toContain("/health");
    expect(coolify).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(coolify).not.toMatch(/\bmcp\.\b/);
  });

  it("says where the backup identity lives and what a VPC 2 compromise means, in both files", () => {
    const silent = [
      `${operationsDocuments}/SECRETS.md`,
      `${operationsDocuments}/RUNBOOK.md`,
    ].filter(
      (file) =>
        !(/VPC 2.*root-only|root-only.*VPC 2/s.test(read(file)) && /plaintext/.test(read(file))),
    );
    expect(silent).toEqual([]);
  });
});
