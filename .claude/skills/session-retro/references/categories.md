# The seven categories

Each category asks one question of the session. The question names where the evidence usually shows, and the answer names where the change would go in this repository.

## Navigation

Did the agent take long to find a file or a fact? Look for searches that came up empty, files read and dropped, and the same question asked of several tools. The change is usually a pointer: one line in `AGENTS.md`, a doc another file links to, or a skill's description. `AGENTS.md` reaches every agent in this repository, so a pointer there must earn its place.

## Automated checks

Did the agent make a mistake a check could have caught? Read the repository's own checks before proposing one: the `check` and `check:gates` scripts in the root `package.json`, `.oxlintrc.json`, `lefthook.yml` and `.github/workflows/check.yml`. A check that exists but was not wired in, or failed without anyone noticing, is the finding, not a new check.

## Coding standards

Did review miss a mistake? Review here is `ce-code-review`, whose project-standards reviewer reads `CODING_STANDARDS.md` and the standards file beside each directory, such as `apps/api/CODING_STANDARDS.md`. First decide what kind of mistake it was:
- **Mechanical:** a fixed pattern, a banned call, an import shape or a file's place. It gets a check, not a rule: a lint rule under `packages/devtools/lint-rules/` or a gate. Propose it as an issue for that check, as `docs/solutions/architecture-patterns/adr-0045-coding-rule-is-one-imperative.md` requires of a rule nothing enforces.
- **Judgement:** something no check could hold. It gets a rule in `CODING_STANDARDS.md`, written as one imperative.

## Global AGENTS.md

Does a steering file carry an instruction that belongs somewhere else? The steering files are this repository's `AGENTS.md` and `CLAUDE.md`, and the owner's global `~/.claude/CLAUDE.md`. Every agent reads them on every turn, so an instruction there that a standard, a check or a skill could carry costs context for nothing.

## Tool economy

Did a call cost more than it should have? The digest's slowest calls, costliest requests, repeated calls and subagents show where. Look at the MCP tools and scripts the session leaned on, and at subagents that read far more than they returned. Some costs already have a known cause, so check `docs/solutions/integration-issues/` before proposing a fix.

## No-ops

Is there a steering line that changed nothing? Look for instructions the agent followed to no effect, or that a stronger rule elsewhere already covers. Removing a no-op is a finding, and it saves context on every turn.

## Information access

Was something the agent needed out of reach? Examples are a log it could not read, a service it could not query, or a setting it had to guess. The change gives the agent read access, or tells it where the information is.

## Two notes from upstream

**Review carries the standards.** The agent writing code works under the most context pressure: it explores, writes and debugs. The reviewer receives a diff and needs no exploration. So a standard is held at review, not by loading more instructions into the implementer.

**Every file has a job.** `AGENTS.md` and `CLAUDE.md` reach every agent, so they hold little beyond pointers. `CODING_STANDARDS.md` is read at review. A doc is a reference another file points to; look for an existing one before writing a new one. A skill's description reaches every agent, so a skill suits material an agent should find by itself, or a command the owner invokes.
