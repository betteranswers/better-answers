# Third-party notices for `.claude/skills/`

Four skills here come from https://github.com/jspiro/skills, which is under the MIT licence: `code-comments`, `complexity-gate`, `mutation-testing` and `repo-quality-sweep`. Each was copied from that repository's `skills/<name>/` folder. `skills-lock.json` names the source of each one.

`code-comments` and `repo-quality-sweep` carry the owner's edits. The other two match upstream.

The notice sits in this file, not in each skill's folder. A licence file inside a folder would change that folder's hash in `skills-lock.json`.

The text below is the upstream `LICENSE`, read on 24/09/2026 at commit `5fd16c00ce674cadbe7819514ec78cedd8915eb3`.

```text
MIT License

Copyright (c) 2026 Matt Pocock
Copyright (c) 2026 Jono Spiro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `pixel-perfect`

`pixel-perfect` is a plugin, not a single skill. It comes from https://github.com/Factory-AI/factory-plugins, folder `plugins/pixel-perfect/`, on the branch `add-impeccable-design-skills` at commit `e6ad78444fc6175c2b68e24c371445b2626ee050`, read on 06/10/2026. That branch is not merged, and the repository's marketplace does not list the plugin, so there is no release to pin. It is under the Apache License 2.0. Parts of it derive from Impeccable by Paul Bakaus and from Anthropic's `frontend-design` skill, both under the Apache License 2.0, as its `NOTICE.md` records.

Upstream ships it as a Factory Droid plugin, with its manifest at `.factory-plugin/plugin.json`. Here the same manifest sits at `.claude-plugin/plugin.json`, so Claude Code loads the folder as `pixel-perfect@skills-dir` and its skills take the `pixel-perfect:` prefix. That move is the only change. Every other file matches upstream at that commit.

Its `LICENSE` and `NOTICE.md` sit inside its folder, because the Apache License 2.0 requires both to travel with the files. The rule above about keeping licence files out of a skill's folder protects hashes in `skills-lock.json`. The skills CLI does not install this plugin, so that rule does not apply to it.

## `ce-skill-work` and the skill-design guide

`ce-skill-work` comes from https://github.com/EveryInc/compound-engineering-plugin, the Compound Engineering plugin, which is under the MIT licence. It was copied from that repository's `.agents/skills/ce-skill-work/` folder at version 3.30.3 (tag `compound-engineering-v3.30.3`, commit `752b0bc275aec95a4d0417655266632415cdc56f`). Two documents came with it, from the same repository's `docs/solutions/skill-design/`: `portable-agent-skill-authoring.md` and `skill-gates-state-conditions-not-prescribed-git-commands.md`, now under this repository's `docs/solutions/skill-design/`. The skills CLI does not install them, so `skills-lock.json` does not name them.

All three carry the owner's edits. Each reference to the plugin's own layout, test runner, eval drivers and release inventory was translated to this repository or removed. The learnings they cite by name stay upstream and are linked at that tag. The plugin's own pull request numbers are marked as the plugin's.

The text below is the upstream `LICENSE`, read on 06/10/2026 from the plugin's 3.30.3 release.

```text
MIT License

Copyright (c) 2025 Every

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `survey-architecture`

`survey-architecture` is adapted from https://github.com/mattpocock/skills, Matt Pocock's skills, which are under the MIT licence. It draws on two of that repository's skills at version 1.2.3 (commit `8b78b531ab965735c5dc74f6f7a219e1e37326df`): `skills/engineering/improve-codebase-architecture/`, its `SKILL.md` and `HTML-REPORT.md`, and `DEEPENING.md` from `skills/engineering/codebase-design/`. It was written from them by hand rather than installed, so `skills-lock.json` does not name it.

It carries the owner's edits throughout:
- The grilling loop, the edits to the glossary and decision docs, and the report in the temp directory were dropped. The architecture review that follows the report owns those steps.
- Upstream's design vocabulary, from its `codebase-design` skill, gave way to this repository's `CODING_STANDARDS.md` and decision docs.
- The test guidance was rewritten to this repository's rule that every store the platform runs is tested for real.
- Picking areas from GitNexus, rebuilding each proposal from first principles and drawing with the `diagram-design` plugin were added.

The text below is the upstream `LICENSE`, read on 06/10/2026 from the plugin's 1.2.3 release.

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## `session-retro`

`session-retro` is adapted from https://github.com/mattpocock/skills, Matt Pocock's skills, which are under the MIT licence. It was written by hand from `skills/engineering/retro/SKILL.md` at commit `a7d038f6bf7f01b516408e95e2fb56e0b338fa6f`, so `skills-lock.json` does not name it. That skill is not in the 1.2.3 release the section above cites.

It carries the owner's edits throughout:
- Upstream's call to its `writing-for-agents` skill gave way to this repository's authoring standard.
- The seven categories keep upstream's questions and name this repository's steering files, checks and reviewer as their targets.
- The bundled script that reads a session's log, the ranking rule and the filing of kept findings as Linear issues were added.

The upstream `LICENSE` is the same text as in the section above, read on 06/10/2026 at that commit.
