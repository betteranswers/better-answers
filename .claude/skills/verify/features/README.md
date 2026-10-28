# better-answers verification map

This directory is the maintained source for verifying what a person sees in better-answers. It has one file for each area of `apps/web/src/shared/navigation.ts` and one for the pages outside the shell. Every page that navigation list names appears, by its address, in exactly one file. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.claude/skills/verify/scripts/launch.sh <port>` and require `.claude/skills/verify/scripts/doctor.sh <port>` to print `worth driving`.
- Use `http://localhost:<port>`, never `127.0.0.1`.
- Each recipe provisions its own workspace through `.claude/skills/verify/scripts/harness.sh`, and the harness mints each person's address. Nothing is seeded before a recipe runs.
- Sign in with `.claude/skills/verify/scripts/sign-in.sh <port> <email> [path]`. It also switches from one person to another.
- Never drive an instance this run did not launch.

## Driving conventions

- Run every browser command as `.claude/skills/verify/scripts/browse.sh <port> <agent-browser command>`, written out in full. A worktree-isolated agent's hook refuses a command assembled from a shell variable or a `$(...)`.
- Start every recipe from a fresh workspace unless its preconditions say otherwise.
- Locate by role and accessible name, or by a field's label. Never by CSS class, coordinates or tab order.
- Treat every command as literal. Keep quoted names and flags unchanged, and put the instance's port where a recipe says `<port>`.
- Wait on a condition with `browse.sh <port> wait --fn` or `browse.sh <port> wait --text`, never for a fixed time.
- A page whose navigation entry says `built: false` is not built yet. The menu leaves it out, and its address draws the not-found page with a link to the role's home. Its recipe proves exactly that.

## Proof and skip reporting

- Capture the action and the state it leaves, not only the last screen.
- Save a screenshot and an accessibility snapshot for each page in the `evidence` directory launch.sh prints, named `<feature file>-<page>`.
- Prove a write from a second view, such as a reload or the page that lists what was written.
- Record the feature file, the page's address and the role signed in with every artifact.
- Report a page the drive cannot reach as `verified-unreachable`, with the command it tried and the prerequisite it lacks.
- Never report a page as proven through another page's drive.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing what a person can do there. It then uses exactly four H2 sections, in this order.

1. `Sub-features` lists one short ID for each page or behaviour, with its address.
2. `How to get to it (user POV)` lists every way a person reaches the area's pages.
3. `Driving it with agent-browser` starts with `Preconditions:` and uses labelled bullets that pair each action with its exact command and the result a person sees.
4. `Gotchas` lists traps that waste or invalidate a run.

Keep implementation detail out of the map. Name only what a person reaches, the stable handles, the state a recipe needs, the commands and what proves the page works.

## Features

- [Ask](./ask.md) covers asking a new question, the asker's own questions and connecting Claude.
- [Knowledge](./knowledge.md) covers search, guides, the knowledge base and Knowledge's curation pages.
- [Inbox](./inbox.md) covers the suggestions waiting on the signed-in person.
- [Control Centre](./control-centre.md) covers an Admin's pages for suggestions, sources, models, questions, people, personal data and system.
- [Console](./console.md) covers the operator's pages across every workspace.
- [Outside the shell](./outside-the-shell.md) covers sign-in, the second-factor steps, the account page, choosing a workspace, accepting an invitation and Claude's consent page.
