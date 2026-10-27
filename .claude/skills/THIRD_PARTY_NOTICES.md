# Third-party notices for `.claude/skills/`

One skill here comes from https://github.com/jspiro/skills, which is under the MIT licence: `mutation-testing`. It was copied from that repository's `skills/mutation-testing/` folder. `skills-lock.json` names its source.

It carries the owner's edits.

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

Upstream ships it as a Factory Droid plugin, with its manifest at `.factory-plugin/plugin.json`. Here the same manifest sits at `.claude-plugin/plugin.json`, so Claude Code loads the folder as `pixel-perfect@skills-dir` and its skills take the `pixel-perfect:` prefix. Four skills carry the owner's edits: `animate`, `colorize` and `typeset` read the project's `.pixel-perfect.md` first, and `frontend-design` works within the project's design system. Every other file matches upstream at that commit.

Its `LICENSE` and `NOTICE.md` sit inside its folder, because the Apache License 2.0 requires both to travel with the files.

## `survey-architecture`

`survey-architecture` is adapted from https://github.com/mattpocock/skills, Matt Pocock's skills, which are under the MIT licence. It draws on two of that repository's skills at version 1.2.3 (commit `8b78b531ab965735c5dc74f6f7a219e1e37326df`): `skills/engineering/improve-codebase-architecture/`, its `SKILL.md` and `HTML-REPORT.md`, and `DEEPENING.md` from `skills/engineering/codebase-design/`. It was written from them by hand rather than installed, so `skills-lock.json` does not name it.

It carries the owner's edits throughout:
- The grilling loop, the edits to the glossary and decision docs, and the report in the temp directory were dropped. The architecture review that follows the report owns those steps.
- Upstream's design vocabulary, from its `codebase-design` skill, gave way to this repository's decision docs.
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

## `addyosmani/agent-skills`

`ci-cd-and-automation` comes from https://github.com/addyosmani/agent-skills, folder `skills/ci-cd-and-automation/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `aeac41d4d005999432bb7312f7ff06383a91d59d`.

```text
MIT License

Copyright (c) 2025 Addy Osmani

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

## `softaworks/agent-toolkit`

`c4-architecture` comes from https://github.com/softaworks/agent-toolkit, folder `skills/c4-architecture/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `3027f20f3181758385a1bb8c022d4041dfb4de84`.

```text
MIT License

Copyright (c) 2026 Leonardo Flores

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

## `affaan-m/ecc`

`docker-patterns` comes from https://github.com/affaan-m/ecc, folder `skills/docker-patterns/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `25278e7d7b6cf6e6a4e7a6c8e10f14ff22f0eb5b`.

```text
MIT License

Copyright (c) 2026 Affaan Mustafa

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

## `github/awesome-copilot`

`multi-stage-dockerfile` comes from https://github.com/github/awesome-copilot, folder `skills/multi-stage-dockerfile/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `98b45a78d3ed316e78f005b60594d5c4a50588e3`.

```text
MIT License

Copyright GitHub, Inc.

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

## `pproenca/dot-skills`

`knip-deadcode` comes from https://github.com/pproenca/dot-skills, folder `skills/.experimental/knip-deadcode/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `cf93c57cac89d6fc3e4194686000411567f5caf3`.

```text
MIT License

Copyright (c) 2025

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

## `whamp/skills`

`ban-type-assertions` comes from https://github.com/whamp/skills, folder `engineering/ban-type-assertions/`, under the MIT licence. It is committed as installed, with no edits. `skills-lock.json` names its source and the hash of its folder.

The text below is the upstream `LICENSE`, read on 27/10/2026 at commit `c392ebf25e650873e4cd2c31d9e2cad32941e4bc`.

```text
MIT License

Copyright (c) 2026 Will Hampson

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
