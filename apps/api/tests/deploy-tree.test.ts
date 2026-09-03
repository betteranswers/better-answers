import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { POSTGRES_IMAGE } from "@better-answers/schema";

/**
 * The deploy tree as a set of facts a test can read (T-005, ADR 0022). Nothing here runs a
 * box; what is held is every property of the tree the runbook and the drill rely on that a
 * quiet edit could break: a script that stops parsing, a production restore that grows the
 * drill's wipe trap, a service that loses its memory limit, a placeholder that comes back,
 * a digest the release matches loosely, the two fences drifting apart in name.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const read = (relative: string): string =>
  readFileSync(path.join(repositoryRoot, relative), "utf8");

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
            !(
              /\*(small|medium)\b/.test(service.body) || /limits:\s*\{\s*memory:/.test(service.body)
            ),
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
    expect(script).toContain("pnpm ops replay-erasures --since");
    // The replay runs before api is started, never after.
    expect(script.indexOf("replay-erasures")).toBeLessThan(
      script.indexOf("platform up -d --wait api"),
    );
    expect(read("apps/docs-site/operations/RUNBOOK.md")).toContain("restore-production.sh");
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
    expect(read("apps/docs-site/operations/RUNBOOK.md")).toContain("RELEASES.md");
  });

  it("has no staging job in build.yml: staging is brought up by the drill procedure", () => {
    const build = read(".github/workflows/build.yml");
    expect(build).not.toMatch(/^\s+staging:\s*$/m);
    expect(build).not.toContain("COOLIFY_STAGING_APP_UUID");
  });

  it("names the app's own fence beside the tunnel's rules, one rule per hostname role, and the two uptime paths", () => {
    const coolify = read("apps/docs-site/operations/coolify.md");
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
      "apps/docs-site/operations/SECRETS.md",
      "apps/docs-site/operations/RUNBOOK.md",
    ].filter(
      (file) =>
        !(/VPC 2.*root-only|root-only.*VPC 2/s.test(read(file)) && /plaintext/.test(read(file))),
    );
    expect(silent).toEqual([]);
  });
});
