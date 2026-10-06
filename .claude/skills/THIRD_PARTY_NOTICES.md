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
