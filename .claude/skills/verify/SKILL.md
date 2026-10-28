---
name: verify
description: This skill should be used when asked to "verify this on the running app", "drive the people page", "reproduce this web bug live", "check the page in a browser", "launch the app", or "run the doctor", or when a playbook names the driver skill for a change to a page, to what a page reads from the api, or to sign-in and consent. It drives better-answers' served app in a real browser as a person does, with a feature file for every page.
---

# Verify the served app

This skill drives the SPA's built pages through the api that serves them, so a drive sees what a person sees. The scripts in `scripts/` launch, check, sign in and clean up. `features/README.md` indexes one feature file for each area of the navigation and one for the pages outside the shell. Each file says how to reach every page in it and what end state proves the page works. `references/harness.md` holds the harness's actions, the ceilings a drive runs into and what a refused seed leaves.

A spec under `apps/web/e2e/` is written and run per `apps/web/.claude/skills/playwright-specs/SKILL.md`. This skill drives the app live.

*The seam* and *Building state* describe the server and the harness that the spec suite and a live drive share. They name the spec suite's fixtures and helpers. A drive reaches the same server and actions only through `scripts/`, and `E2E_PORT` applies only to the spec runner.

## The seam

The server under the browser is the api's own integration harness, `startApp` in
`apps/api/tests/support/harness/harness.ts`, over the Testcontainers Postgres and the Garage
object store that the api's integration tests use. A claim about a store itself, such as
row-level security, a migration or a lock, is proven in those integration tests, never in a
spec. The email
transport captures codes, Claude's client metadata document is served in process, and a model wire
answers each workspace's model calls as its spec scripted them and fails any call no script
answers. Playwright starts it as a **process**, not an import: `apps/web` imports nothing from
`apps/api` at runtime, so launching it is the only way the browser suite reaches the real server.
`apps/api/tests/serve.ts` takes a port as its one argument and listens on it, with the harness's
control paths (`apps/api/tests/support/harness/harness-control.ts`) mounted in front of the api and served
nowhere in `apps/api/src`.

One origin carries the SPA, sign-in, consent and `/oauth2/*`, which is why the consent
flow is provable in a browser at all. It is `http://localhost:<port>`, never `127.0.0.1`: a
passkey's relying party must be a domain, and WebAuthn refuses an IP address.

`apps/web/playwright.config.ts` holds the port, the `webServer` command (`node tests/serve.ts`
run in `apps/api`, handed that port) and `/health` as the readiness URL. `/health` answers only
once the database is migrated and the authorization server has initialised. `serve.ts` binds its
port before it starts the harness and answers 503 until then, so a port another server holds
fails the run at once. The api's `serve:e2e`
script is the same command for a person to run by hand. Playwright never goes through it: pnpm
11.27 and later start a script in a process group of its own, which Playwright's kill never
reaches, so the server outlives the suite and the run hangs on its open output.

The port is 3100 in CI. On a developer's machine the runner takes a free port and hands it to its
workers in `E2E_PORT`, so two worktrees can run the suite at once. Set `E2E_PORT` to choose the
port yourself.

## Building state

State is built through the api's harness over HTTP, from `apps/web/e2e/harness.ts`, using the
`request` fixture. Nothing writes a row itself and nothing sets a cookie from outside. Each
action calls `/__harness`, which `apps/api/tests/support/harness/harness-control.ts` mounts, and an area's own
actions live beside it in `apps/api/tests/support/harness/harness-*.ts`. The same module re-exports the locators
and browser helpers in `apps/web/e2e/locators.ts`. Most specs sign in with `signIn` or
`signedInAtHome`, which pass through the product's own sign-in page and its second-factor gate,
never around them. Each spec provisions its own workspace with `provision` and mints its own
address with `anAddress`, so two specs running together never share state.

A seed the harness cannot write answers 400, naming each field and its rule, and the action's
failure carries that answer, so read the reason there and not in the server's log. A seed that a
slice's own action writes can leave part of its rows behind when refused part-way;
`references/harness.md` says which seeds do. Before adding an action, search that
file for one that already does the job, and before adding a helper, search
`apps/web/.claude/skills/playwright-specs/references/helpers.md`.

## Launch

Docker must be running, because the harness starts a Testcontainers Postgres and a Garage object store of its own. agent-browser drives the browser. Install it once with `npm install -g agent-browser && agent-browser install`.

```bash
.claude/skills/verify/scripts/launch.sh 4610             # builds the SPA, then starts the server
.claude/skills/verify/scripts/launch.sh 4610 --no-build  # serves the build already in apps/web/dist
```

It builds the SPA with `pnpm --filter @better-answers/web run build`, then runs `node tests/serve.ts <port>` in `apps/api`. It runs `node`, not the `serve:e2e` script, for the process-group reason under *The seam*. It records the server's pid and its log under `/tmp/better-answers-verify/<port>/`, and returns once `/health` answers 200. A cold Docker pulls its images first, so it waits up to 240 s. It refuses a port that any process already holds. Set `VERIFY_HOME` to keep the state somewhere other than `/tmp/better-answers-verify`.

Every instance starts with no workspace and no person. A drive seeds what it needs through the harness.

## Doctor

```bash
.claude/skills/verify/scripts/doctor.sh 4610
```

It reads and changes nothing. It prints `worth driving:` with the origin and the pid and exits 0, or prints `not worth driving:` with the reason and exits 1. It checks these, in order:

- `lsof`, `curl`, `node` and agent-browser are on `PATH`.
- launch.sh started a server on that port, and that process is still alive.
- The port's listener is that process.
- `/health` answers 200 and `/__harness` answers.
- No page source changed after the SPA was built, and no api, core, schema or harness source changed after the server started.

Run it before the first drive, after any drive that failed, and whenever a page looks wrong. When it refuses, run cleanup.sh and launch again. Never drive an instance the doctor refused.

## Drive

Drive the path a person takes. Build state only through the harness's actions, and act only through the page.

Every browser command goes through `scripts/browse.sh <port> <agent-browser command>`, which runs agent-browser in the session `verify-<port>`, so two drives never share a browser. Write each command out in full. A worktree-isolated agent's hook refuses a command assembled from a shell variable or a `$(...)`.

1. **Build state through the harness.** `scripts/harness.sh <port> <METHOD> <path> [json body]` calls `/__harness<path>` and prints the answer. On a refusal it prints the status and the reasons and exits 1. Write no row and set no cookie any other way. Provision a workspace for the drive. With no `adminEmail`, the harness mints a fresh Admin with an address nobody else in the run holds:

   ```bash
   .claude/skills/verify/scripts/harness.sh 4610 POST /workspaces '{"name":"Verify people"}'
   ```

   It answers the workspace's `workspaceId`, `name` and `shortName`, and the Admin's `id`, `email` and `name`. Sign in with that `email`. `references/harness.md` lists every action by the name of its function in `apps/web/e2e/harness.ts`. An action's route is the path that function passes to `/__harness`. The body a route takes is the schema it parses, in `apps/api/tests/support/harness/harness-control.ts` or in the area's `harness-*.ts` file beside it. The function in `apps/web/e2e/harness.ts` may reshape its arguments before it sends them. Each feature file names the routes its pages need.

2. **Sign in through the product's own page.**

   ```bash
   .claude/skills/verify/scripts/sign-in.sh 4610 <email> [path]
   ```

   It keeps the session's browser open and clears its cookies and storage first, so it also switches from one person to another. It then sets a client address of its own in `cf-connecting-ip`, so sign-ins on one instance do not share the per-address ceiling. Never run `browse.sh <port> close` mid-drive. The next commands relaunch the browser on a blank page, and only cleanup.sh closes it. It opens `path`, `/sign-in` by default, waits for *Email Address*, fills it and presses *Send Code*. It waits for the new email to reach the captured transport and for *Verification Code* to draw, then fills the code. An Admin or the operator then meets the confirm or setup page. The script gives that person the harness's authenticator, opens `/confirm` with the page's own query and types the six digits the authenticator shows. It waits for the landing page's heading, then prints the address.

   - An Admin of one workspace lands on `/people/members`.
   - An Editor or a Viewer lands on `/ask/new-question`.
   - The operator lands on `/console/workspaces/every-workspace`.
   - A person in several workspaces meets the workspace picker, and a person in none meets *No Workspace Yet*.

3. **Locate by role and accessible name.** Read the page, then act on the names it gives:

   ```bash
   .claude/skills/verify/scripts/browse.sh 4610 snapshot -c
   .claude/skills/verify/scripts/browse.sh 4610 find role link click --name "Groups"
   .claude/skills/verify/scripts/browse.sh 4610 find role button click --name "Invite a Person"
   .claude/skills/verify/scripts/browse.sh 4610 wait --fn "location.pathname === '/people/groups'"
   ```

   `snapshot -c` prints the accessibility tree with refs. A name matches as a case-insensitive substring unless the command adds `--exact`. Add it where one name sits inside another on the same page. Never locate by CSS class, coordinates or tab order. Wait on a condition, never for a fixed time.

   Move between pages as a person does. The rail is the `navigation` named *Areas*. The menu is the `navigation` named for the open area. The breadcrumb is the `navigation` named *Breadcrumb*. To open a page by its address, run `.claude/skills/verify/scripts/browse.sh 4610 open http://localhost:4610<path>`.

## Evidence

Save each artifact in the `evidence` directory launch.sh prints, `/tmp/better-answers-verify/<port>/evidence/` unless `VERIFY_HOME` is set. Name it for the feature file and the page, such as `control-centre-members.png` and `control-centre-members.aria.txt`.

```bash
.claude/skills/verify/scripts/browse.sh 4610 screenshot /tmp/better-answers-verify/4610/evidence/control-centre-members.png
.claude/skills/verify/scripts/browse.sh 4610 snapshot > /tmp/better-answers-verify/4610/evidence/control-centre-members.aria.txt
```

Save the full `snapshot` as evidence. `snapshot -c` leaves out every part of the page that holds no control, such as a status or an empty list's words, so it cannot prove an end state.

- Capture each action and the state it leaves, not only the last screen. Take a snapshot before and after an action that changes something.
- Prove a write from a second view. Reload the page, or open the page that lists what was written, and read it there.
- Check a side effect the page cannot show through a harness read, such as `GET /emails?to=<address>` for a sent email or `GET /commit-authors` for a commit.
- Beside each artifact, report the feature file, the page's address and the role signed in.
- Report a page the drive cannot reach as `verified-unreachable`, with the prerequisite it lacks and the command it tried. Never report one entry point as proven through another.

## Cleanup

```bash
.claude/skills/verify/scripts/cleanup.sh 4610
```

It closes the session's browser, sends SIGTERM to the pid launch.sh recorded, waits up to 30 s, then sends SIGKILL, and confirms the port is free. If another process holds the port, it names that pid and exits 1. It signals the recorded pid only while that pid still runs `tests/serve.ts`, and it never kills by process name. On SIGTERM the server stops its own Postgres and object store containers. After a SIGKILL, Testcontainers' Ryuk container removes them once the process is gone. It deletes the pid file and keeps `server.log`, `build.log` and `evidence/`. Run it after the last drive, and after every failed launch or drive.

## Two drives side by side

Launch each on its own port. Each instance has its own Postgres and object store, each drive provisions its own workspace and mints its own addresses, and each browser session is named for its port, so neither drive sees the other's state.

```bash
.claude/skills/verify/scripts/launch.sh 4610
.claude/skills/verify/scripts/launch.sh 4611 --no-build
```

Build once. A second build while an instance serves `apps/web/dist` rewrites the files under it, so launch.sh refuses to build while another instance launched from the same checkout runs.
