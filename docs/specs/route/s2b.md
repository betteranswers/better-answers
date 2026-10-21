# S2b · Ask returns approved answers, cited, or refuses

**Destination.** A person asks in Claude or on Ask and gets every `Answer` that fits, word for word, or *related knowledge*, or the refusal sentence. Every model call goes through the model client. Each question is a *Questions asked* record that takes feedback. A reader reads their own on Ask › Your questions, and an Admin reads every record in Control Centre › Questions.

**Done when.**

- Ask › Your questions lists only the reader's own questions, within the list budget in its browser spec.
- Both record pages show each concept's trust as it is now, and Questions asked shows refusals as one group.
- An `ask` whose walk times out records that the map was unavailable.
- The owner reads the plan's AE1, AE2 and AE14 as a pass on production, under [the production readings of ask](../../operations/readings.md#the-production-readings-of-ask).
- [The reuse reading](../../operations/readings.md#the-reuse-reading) and [the decision reading](../../operations/readings.md#the-decision-reading) are recorded, with the judge backend the first customer's workspace runs and why.

**Rests on.** ADR 0016, the answer contract, its verdicts and the judge. ADR 0017, the record and its feedback. ADR 0030, `ask`'s own-transaction road and its spend. ADR 0037, each page's budget. ADR 0046 and ADR 0047, where the pages sit. ADR 0049, the model client and a decision model's threshold.

Words: *answer*, *related knowledge*, *judge*, *decision model*, *model client*, *spending limit*, *Questions asked*, *feedback*.

**Builds on.**

- `packages/core/src/answering/` and `packages/core/src/llm/` hold the judge, the drafter, the record, the model client and spend (#747, #749, #753, #758).
- `apps/api/src/trpc/ask.ts` and the MCP entries carry `ask` (#717, #756).
- `apps/web/src/features/ask/` holds New question (#759), and `apps/web/src/features/questions/` holds Questions asked and Answer tests (#751, #752).
- `packages/core/test/recall.ts` reports [recall at ten on the synthetic sets](../../operations/readings.md#recall-at-ten-on-the-synthetic-sets). `packages/core/test/readings/` holds the owner's readings (#755, #757).
- `packages/core/src/answering/records.ts` reads a reader's own records (`ask.yourQuestions`, `ask.yourRecord`), and `apps/web/src/features/ask/your-questions-page.tsx` holds Ask › Your questions, its list budget in `apps/web/e2e/ask-your-questions.spec.ts` (U19 of the [plan](../../plans/2026-10-11-2309-feat-s2b-ask-plan.md)).
- Both record pages word each concept's trust now, and the record keeps trust at the time (BA-181).

**Must carry.**

- **The judge's follow-up.** An expired reservation is settled, with the root fix in BA-186. A Deprecated or Draft `Answer` is never a judge candidate (BA-182).
- **Refusals in one group.** A refusal carries no concepts, so the grouping by collection and its seeded tests go (BA-180).
- **The map's state on the record.** A record says whether the map was live, and an older record reads as unknown (BA-158).
- **A fresh map.** The rebuild and a bundle import analyse the map's tables, so the walk does not time out (BA-151).
- **The readings.** The owner reads the reuse set on Claude Sonnet 5.5, the first judging model choice, and on Claude Haiku 5.5, then on the decision backend. A cheaper backend that holds on the hard negatives may replace Sonnet 5.5 (the plan's U14, U15).
- **A decision model's threshold.** An ops command stores it per provider and model before any workspace runs that backend, and `set-model-choice` refuses a decision model without one (BA-184).

**The owner's choice from the readings (21/10/2026).** Phew's workspace judges with Claude Sonnet 5.5 at its default effort, and no decision model has a threshold. On the reuse set Sonnet 5.5 took 28 of 32 fits and no hard negative or unrelated `Answer`. Clef and Clef-flash took unrelated `Answer`s at every threshold that kept their fits (§ [the decision reading](../../operations/readings.md#the-decision-reading)). Claude Haiku 5.5 at its default effort matched Sonnet 5.5 at about a fifteenth of the cost, but 34 questions cannot tell the two apart, so it waits for a larger set.

**Open for the plan.** How an `Answer`'s unbounded text fits a host's tool-result limit, after the U6b reading (BA-171). Whether `ask` reaches each collection's `Answer`s when none is named, a ranking change that ends `ask`'s first ten equalling `find`'s (BA-177).

**Seams.** The core slice interface for the judge and the map's state, the api harness for both transports, and the browser suite for both record pages. The model client's wire fake keeps `check` off a real model.
