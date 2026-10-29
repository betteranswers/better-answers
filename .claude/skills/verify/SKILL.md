---
name: verify
description: This skill should be used when asked to "verify this on the running app", "drive the people page", "reproduce this web bug live", "check the page in a browser", "launch the app", or "run the doctor", or when a playbook names the driver skill for a change to a page, to what a page reads from the api, or to sign-in and consent. It drives better-answers' served app in a real browser as a person does, with a feature file for every page.
---

# Verify the served app

Drive the SPA's built pages through the api that serves them, in a real browser, as a person does. `features/README.md` lists the recipes. A recipe needs the instance, the harness and the sign-in below.

## Launch

Docker must be running. Install the browser driver once with `npm install -g agent-browser && agent-browser install`. A fresh checkout or worktree has no `node_modules`, so run `pnpm install --frozen-lockfile` at its root first.

```bash
.claude/skills/verify/scripts/launch.sh 4610             # builds the SPA, then starts the server
.claude/skills/verify/scripts/launch.sh 4610 --no-build  # serves the build already in apps/web/dist
```

It starts `apps/api/tests/serve.ts` on the port and returns once `/health` answers 200. A cold Docker pulls its images first, so it waits up to 240 s. It refuses a port that any process holds.

## Doctor

```bash
.claude/skills/verify/scripts/doctor.sh 4610
```

It prints `worth driving:` and exits 0, or prints `not worth driving:` with the reason and exits 1. Run it before the first drive and whenever a page looks wrong. Never drive an instance it refused.

## Drive

Build state only through the harness, and act only through the page. Write every command out in full, with literal values: a worktree-isolated agent's hook refuses a command that carries a value computed at runtime.

1. **Build state.** `scripts/harness.sh <port> <METHOD> <path> [json body]` calls `/__harness<path>` and prints the answer. A refusal prints its status and reasons and exits 1. `references/harness.md` lists the routes the recipes call.

   ```bash
   .claude/skills/verify/scripts/harness.sh 4610 POST /workspaces '{"name":"Verify people"}'
   ```

2. **Sign in.** `scripts/sign-in.sh <port> <email> [path]` signs in through the product's own page, through the second-factor step, and switches from one person to another. It prints a line that ends with the page's address.

   With no path, a new Admin of one workspace lands on `/people/members`, an Editor or a Viewer of one on `/ask/new-question`, and a person in several workspaces on the workspace picker. With the path `/console`, the operator lands on `/console/workspaces/every-workspace`.

3. **Drive the page.** `scripts/browse.sh <port> <agent-browser command>` runs agent-browser in the session `verify-<port>`.

   ```bash
   .claude/skills/verify/scripts/browse.sh 4610 snapshot
   .claude/skills/verify/scripts/browse.sh 4610 find role link click --name "Groups"
   .claude/skills/verify/scripts/browse.sh 4610 wait --fn "location.pathname === '/people/groups'"
   ```

   Locate by role and accessible name, or by a field's label, never by CSS class, coordinates or tab order. A name matches as a case-insensitive substring unless the command adds `--exact`. Wait on a condition, never for a fixed time. `open <url>` returns before the page's data arrives, so `wait` for a text the loaded page draws before the next `find`.

## Evidence

Save, for each page a recipe ends on, a screenshot and a full snapshot in `/tmp/better-answers-verify/<port>/evidence/`, named for the feature file and the last segment of the page's address, such as `control-centre-members` for `/people/members`.

```bash
.claude/skills/verify/scripts/browse.sh 4610 screenshot /tmp/better-answers-verify/4610/evidence/control-centre-members.png
.claude/skills/verify/scripts/browse.sh 4610 snapshot > /tmp/better-answers-verify/4610/evidence/control-centre-members.aria.txt
```

Prove a write from a second view: reload, or open the page that lists what was written. Report a page the drive cannot reach as `verified-unreachable`, with the command tried and the prerequisite it lacks. Never report a page as proven through another page's drive.

## Cleanup

```bash
.claude/skills/verify/scripts/cleanup.sh 4610
```

It closes the session's browser and stops the server it launched, then confirms the port is free. It keeps `server.log`, `build.log` and `evidence/`. Run it after the last drive and after every failed launch or drive.

## Two drives side by side

Launch each on its own port, and build once: launch the second with `--no-build`. launch.sh refuses to build while another instance of the same checkout runs.
