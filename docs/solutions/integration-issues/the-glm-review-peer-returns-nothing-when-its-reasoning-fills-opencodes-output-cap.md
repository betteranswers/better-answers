---
title: "The GLM review peer returns nothing when its reasoning fills OpenCode's 32,000-token output cap"
date: 2026-10-04
category: integration-issues
module: .compound-engineering
problem_type: integration_issue
component: development-workflow
severity: medium
symptoms:
  - "A cross-model peer (OpenCode to OpenRouter, openrouter/z-ai/glm-5.3) writes no artifact, most often /ce-doc-review's adversarial and whole-doc lenses"
  - "OpenCode's store shows finish length with reasoning between 31,998 and 34,954 tokens and 0 to 2 output tokens in a single step"
  - "One run ended with finish stop after 34,500 reasoning tokens and no text"
  - "Failing steps ran 128 to 413 seconds, so the review read as timed out or out of reasoning budget"
  - "OpenCode attaches a doc-review brief of 53 to 56 KB truncated, with the note 'Output capped at 50 KB. Showing lines 1-471. Use offset=472 to continue.'"
root_cause: config_error
resolution_type: config_change
framework_version: "opencode 1.18.33"
related_components:
  - tooling
tags:
  - opencode
  - openrouter
  - glm
  - cross-model-review
  - ce-doc-review
  - ce-code-review
  - reasoning-effort
  - output-token-cap
  - compound-engineering
retire_when: "OpenCode's default output cap no longer cuts a reasoning model short, or the compound-engineering plugin's opencode route passes the brief on stdin instead of --file"
---

# The GLM review peer returns nothing when its reasoning fills OpenCode's 32,000-token output cap

## Problem

The second-model review peer (OpenCode 1.18.33, through OpenRouter, to `openrouter/z-ai/glm-5.3`) often returned no artifact. `/ce-doc-review`'s adversarial and whole-document peers failed most often; `/ce-code-review`'s adversarial peer mostly succeeded. The model spent its whole output allowance on reasoning in one step and never wrote the JSON the skill waits for.

## Symptoms

- The skill reported no artifact for a peer: `peer-job-runner: no artifact at …/whole-doc-opencode.json`, then `job …: done (worker exited 0)`.
- Review runs reported the model using its reasoning budget or timing out, and returned nothing.
- OpenCode's own store (`~/.local/share/opencode/opencode.db`, the `message` table's JSON `tokens` and `finish`) shows the pattern. Of 73 GLM sessions between 30/09/2026 and 04/10/2026, 12 steps ended `finish: length` after 31,998 to 34,954 reasoning tokens and 0 to 2 output tokens, each in a single step; seven of them stopped at exactly 32,000. One more ended `finish: stop` after 34,500 reasoning tokens with no text. Those steps took 128 to 413 seconds.
- 11 of the 12 sessions with a `length` failure had a brief that arrived truncated: the user message carries `Output capped at 50 KB. Showing lines 1-471. Use offset=472 to continue.`

## What Didn't Work

- **Looking at OpenRouter.** Restricting the OpenRouter account to GLM-5.3 did not help, because the cap is OpenCode's, not OpenRouter's or the model's. OpenCode's model list gave GLM-5.3's output limit as 131,072 tokens on 04/10/2026 (`opencode models openrouter --verbose`).
- **`cross_model_effort: medium`.** The plugin's scripts accept `medium` for the opencode route (`ce-code-review/scripts/cross-model-adversarial-review.sh:346`, `ce-doc-review/scripts/cross-model-doc-review.sh:336`), but OpenCode defines only `low`, `high` and `max` variants for GLM-5.3, so `medium` maps to nothing.
- **OpenCode's `tool_output.max_bytes` config key.** Its v2 config documents `tool_output: { max_lines, max_bytes }` with defaults of 2,000 lines and 51,200 bytes. In 1.18.33, a 129 KB file attached with `--file` was still capped at 50 KB with `OPENCODE_CONFIG_CONTENT='{"tool_output":{"max_bytes":524288,"max_lines":20000}}'` (tested on 04/10/2026).
- **Using a Claude model as the peer.** From a Claude Code session the skills exclude the host's own family, so a `claude` peer (Fable, Sonnet or Opus) is not selected as the cross-model pass. Doc review's in-process reviewers already spread across Claude tiers.

- **Falling back to another peer (session history).** On 01/10/2026 a code review whose peer returned no usable artifact looked for `codex`, `grok` and `cursor-agent`. None is installed, so the in-process adversarial reviewer covered the lens. The failures were taken as one-offs and never diagnosed.
- **A separate cause with the same symptom (session history).** Between 02/10/2026 and 03/10/2026 peers failed because OpenRouter credit had run out (HTTP 402; OpenCode's store records "This request would exceed your available credits"). That also returns nothing, so check the credit before reading the token counts. The doc review that showed the reasoning failure ran after the top-up.

## Solution

Two changes, one in the repository and one on the machine.

**In the repository:** name the reasoning effort in `.compound-engineering/config.yaml:13`:

```yaml
cross_model_model: openrouter/z-ai/glm-5.3
cross_model_effort: high
```

The scripts turn this into `--variant high` (`cross-model-adversarial-review.sh:92-110` resolves the override, `:287-296` builds the argv). Check what they will run without calling the model:

```sh
S=~/.claude/plugins/cache/compound-engineering-plugin/compound-engineering/<version>/skills
CROSS_MODEL_EFFORT_OVERRIDE=high CROSS_MODEL_MODEL_OVERRIDE_TARGET=opencode \
CROSS_MODEL_MODEL_OVERRIDE=openrouter/z-ai/glm-5.3 \
  bash "$S/ce-doc-review/scripts/cross-model-doc-review.sh" --emit-adapter opencode | tr '\0' ' '
# … opencode run … --model openrouter/z-ai/glm-5.3 --variant high
```

**On the machine:** four settings in the `env` block of `~/.claude/settings.json`, which apply from the next Claude Code session. `docs/agents/code-review.md:18` names them.

| Setting | Value | Default it replaces |
| --- | --- | --- |
| `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` | `64000` | OpenCode's 32,000 output cap, which reasoning counts against |
| `CROSS_MODEL_IDLE_SECS` | `900` | the script's 480 s idle window (`cross-model-adversarial-review.sh:578`, `cross-model-doc-review.sh:589`) |
| `CROSS_MODEL_HARD_SECS` | `1800` | the script's 1,200 s hard cap (`:579`, `:590`) |
| `CE_PEER_IDLE_SECS` | `900` | the job runner's 240 s idle window (`peer-job-runner.py:312`) |

The runner passes its environment through to the worker (`peer-job-runner.py:302`), so these reach the scripts and OpenCode.

**The proof.** One whole-document brief that had failed twice at the default effort, each time past 32,000 reasoning tokens, was rebuilt from OpenCode's store and run again at `--variant high`. It finished in 153 seconds with 19,845 reasoning and 1,606 output tokens, and returned four schema-valid findings.

**Still to do upstream (not filed as of 04/10/2026).** The plugin's four OpenCode call sites pass the brief as `--file "$PROMPT_FILE"`: `ce-code-review/scripts/cross-model-adversarial-review.sh:291`, `ce-doc-review/scripts/cross-model-doc-review.sh:290`, `ce-work/scripts/cross-model-work.sh:165` and `ce-pov/scripts/cross-model-pov.sh:254`. OpenCode attaches a file through its read tool, which caps it at 50 KB, and doc-review briefs run 53 to 56 KB. Piping the brief on stdin instead delivered a 129 KB file whole, in one message, with no cap (tested on 04/10/2026). The scripts' `run_timeout_cmd` already takes a stdin file as its first argument (`cross-model-adversarial-review.sh:763-764`, `cross-model-doc-review.sh:739-740`), and the claude route uses it (`cross-model-doc-review.sh:1071`). The opencode route passes `""`, which means `/dev/null` (`cross-model-doc-review.sh:1082`, `cross-model-adversarial-review.sh:1114-1116`). The fix is to pass `"$PROMPT_FILE"` there and drop `--file` from the argv. It belongs in EveryInc/compound-engineering-plugin; an edit to the plugin cache is lost on the next plugin update.

## Why This Works

OpenCode sets each request's `maxOutputTokens` to the smaller of the model's output limit and its own cap, which is 32,000 unless `OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX` says otherwise (OpenCode's `session/llm/request.ts`, `ProviderTransform.maxOutputTokens(model, flags.outputTokenMax)`, read through its docs on 04/10/2026). OpenRouter counts reasoning tokens against that maximum. With no `--variant`, OpenCode sends no reasoning effort, and GLM-5.3 reasons with no bound of its own. On a long document with no tools to call, the whole review happens in one step, so the model's reasoning reaches the cap before it writes a single output token, and the step ends `length` with nothing to parse.

Naming `high` bounds the reasoning, which is the actual fix. The raised cap is a safety net for the run that still reasons long, and the longer idle and hard windows stop the scripts and the runner killing that run, because OpenCode's `--format json` stream emits nothing while a step is reasoning.

The truncated brief adds a step: the model reads the rest of the file with an offset (the temporary directory is allowed by `OPENCODE_PERMISSION` in `~/.claude/settings.json`), then reasons over the whole document at once. Code review's peer rarely failed because it spreads its reasoning across many tool steps that read the repository.

## Prevention

- **Name an effort for any reasoning model behind OpenCode.** Check the model's real variants first: `opencode models openrouter --verbose` lists them under `variants`. A value the scripts accept may not exist for the model.
- **Diagnose a silent peer from OpenCode's store, not from the skill's report.** The skill only says no artifact arrived. This query shows each step's tokens and finish reason:

  ```sh
  sqlite3 -readonly -json ~/.local/share/opencode/opencode.db \
    "select session_id, data from message where json_extract(data,'$.role')='assistant'
     order by time_created desc limit 20" |
  python3 -c "import json,sys; [print(r['session_id'][-8:], (d:=json.loads(r['data'])).get('finish'), d.get('variant'), d.get('tokens')) for r in json.load(sys.stdin)]"
  ```

  `finish: length` with `output` near 0 and `reasoning` at the cap is this failure.
- **Reproduce a failed peer from the store.** The user message's text parts hold the brief that was sent (the `part` table, joined on `message_id`). Re-run it with `opencode run` and compare variants before changing any setting.
- **Three traps when running `opencode run` by hand:**
  - It reads stdin when stdin is not a terminal, so a background run with an open stdin hangs before it creates a session. Add `</dev/null`.
  - `--file` takes several values, so a message placed after it is read as a file path (`Error: File not found: <your message>`). Put the message before `--file`.
  - A `--file` outside `--dir` asks for `external_directory` permission, and a non-interactive run hangs waiting for the answer.
- **Changing the model or the plugin version?** Re-check the effort's variant name against the new model, and check whether the plugin now passes the brief on stdin; if it does, the truncation note above no longer applies.

## Related

- `docs/agents/code-review.md`: the cross-model pass, its effort, and the machine settings this doc explains.
- `.compound-engineering/config.yaml`: the peer, the model and the effort.
