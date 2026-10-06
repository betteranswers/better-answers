---
name: session-retro
description: Reads a Claude Code session's log through a bundled digest and reports what in the agent's environment cost time or went wrong — navigation, checks, standards, steering files, tool cost, missing information — most severe first, then files each finding the owner keeps as a Linear Triage issue. Use after a session that ran slower or went wrong, from a fresh session. Use `ce-compound` to record a solved problem. Invoked as `/session-retro`, optionally followed by a session id, id prefix or description.
disable-model-invocation: true
---

# Session retro

The retro produces a ranked report, in chat, of what in the agent's environment cost one session time or led it wrong. The owner chooses which findings to keep, and each kept finding becomes one Linear Triage issue, so the next session does not pay the same cost. The run is done when every kept finding is filed, or left in chat with the reason its filing failed.

The environment is what shapes any session in this repository: steering files, checks, standards, tools and the information an agent can reach. The code the session wrote is not the subject. `ce-compound` records a solved problem, and the plans record decisions.

Invoking this skill authorizes reading session logs, code and docs, running the bundled script and searching Linear. Its one write outside chat is filing the findings the owner keeps. It edits nothing in the tree.

Each reference below is read at the step that names it. A read made earlier does not count.

## 1. Choose the session

The log is read through `scripts/session.py` in this skill's directory, run from the repository root. Session logs run to tens of megabytes, so never open one directly: read the digest, and open single records with the script's `show` mode.

```bash
python3 .claude/skills/session-retro/scripts/session.py digest [<session>]
python3 .claude/skills/session-retro/scripts/session.py list
python3 .claude/skills/session-retro/scripts/session.py show <session> [--agent <agent-id>] <line>
```

- **A session was named.** An id or id prefix goes straight to `digest`. For a description or a date, run `list` and match it against the titles and dates. If several match, show them and ask which.
- **No session was named.** `digest` with no argument reads the current session and stops at this retro's own invocation. When it reports no calls, which is the case in a fresh session, run `list` and ask which session to read.
- **The current session is large.** It is large when the digest reports a compaction, or a request above about 400,000 input tokens. Advise running the retro again on this session's id from a fresh session, because a retro inside a large session can trigger its own compaction. The owner chooses whether to continue.
- **The script exits non-zero.** Report what it said and stop. That is the case when the host is not Claude Code or no session matches.

## 2. Find the causes

Read `references/categories.md` from this skill's directory now.

Read the digest whole. Open the records behind anything that looks like a cause. Time spent waiting on the owner is not agent cost, and the digest totals it on its own line.

For each cause:
- Look under each of the seven categories. Say which one the cause belongs to.
- Ground it in the log. Name the record that shows it: the session id, the agent id when the record is a subagent's, and the line.
- Check whether it is already known. A doc in `docs/solutions/` may explain it, and an open Linear issue may already track the same cause; point at either instead of offering the finding again. Leave out any finding already filed from this session: an issue in any state whose Notes carry this session's id.

## 3. Report

Rank the findings, most severe first:
1. **Correctness or safety.** A check that exists and was not run, a standard broken in code that shipped, or a secret passed in a call.
2. **Measured cost.** Wall time and tokens lost, times how often the cause recurred in the session.
3. **One-offs.**

Give each finding:
- its category;
- the cause, in a sentence;
- the record that shows it;
- the change it proposes, and where that change would go;
- a grade. **Change** means the log shows the cause directly. **Verify** means it is likely but needs a check. **Consider** means it is worth weighing.

## 4. File what the owner keeps

Ask the owner which findings to keep. If they keep none, the run is done.

File each kept finding as one issue, following the rule for a finding put off for later in `docs/agents/issue-tracker.md`:
- The rank sets the priority: correctness or safety is High, measured cost is Medium, a one-off is Low.
- The Notes carry this session's id, so a later retro can tell what was filed.
- The evidence is the record's pointer and a paraphrase of what it shows. The repository is public, and an issue's text travels into plans and pull requests. Never quote raw tool output or prompt text.
- A finding about a secret names the kind of credential and the line, never its value or any part of it, and its proposed change includes rotating the credential.
- A finding about the owner's global `~/.claude/CLAUDE.md` is filed only when the owner keeps it, and its target is named as outside this repository.

When a filing fails, leave the finding in the chat report with the error. End by listing the issues filed.
