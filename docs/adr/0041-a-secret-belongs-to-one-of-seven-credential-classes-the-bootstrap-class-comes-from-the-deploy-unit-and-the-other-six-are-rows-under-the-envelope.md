---
status: accepted
date: 2026-09-21
---

# A secret belongs to one of seven credential classes: the bootstrap class comes from the deploy unit, and the other six are rows under the envelope read through a credentials provider

**Where this came from.** This decision predates this record. Where and when it was taken is not written down anywhere; what is known is that it was held in the constitution's credential-class rule and that ADR 0013 and ADR 0030 were already reading the class list off it. It sat there as rule text with nothing checking it and nothing able to: the six classes below the bootstrap one are unbuilt, so there is no code for a gate to read and no change to a diff that would show one. The coding-rules audit of 21 September 2026 (T-184) sorted it as a decision rather than a rule and moved it here, unchanged. Nothing below is new. The credential-class rule keeps the sentences that bind a change — the seam, and that classes are never mixed in one scope — and points here for the taxonomy.

**The seven classes**, named as the credential-class rule named them: **bootstrap**, **ingestion**, **acting**, **agent**, **LLM provider**, **repository**, **object store**. That rule glossed two of them — bootstrap as what the deploy unit must give the process before it can reach anything, agent as a share agent's binding-scoped token — and what each of the seven is for and where it is read is tabulated in `docs/operations/SECRETS.md` § *The classes*, which is where that detail is written today. This record fixes the list and the shape and does not copy the table; which record owns a class's gloss has never been settled and is not settled here.

**Two conflicts this record does not settle.** Both predate it, and both were found by the audit that moved the sentence (T-184). Choosing either way is a new decision, and moving a sentence is not the moment to take one, so each is recorded here unresolved and named to the owner.

1. **What *acting* means.** `docs/operations/SECRETS.md` glosses it as "writing back into a connected system as the user, approval-gated"; ADR 0030 says the class "is for acts on our own estate and for the ingestion side; it is never a credential for writing into a customer's other systems". Those cannot both be right.
2. **Whether all six are really rows.** The credential-class rule said the six below bootstrap are rows under the envelope, read through the provider. `SECRETS.md`'s *where it is read* column does not agree for three of them: the **object store**'s write-and-list pair comes "from env" and its admin credential "from escrow only", the **repository**'s keys are "root-only on the host, mounted read-only into the service that needs it", and the **agent** token is "checked in the app before any body is read". Either the rule generalised past the estate or the estate has drifted from the rule; this record does not decide which.

Whichever way either goes is an amendment here and to the record that loses.

**The bootstrap class is read from the environment; nothing else is.** It is read once, by the typed config module of its tier — `apps/api/src/config.ts` and `apps/worker/src/better_answers_worker/config.py` — and nowhere else: never from the environment at a call site, and never logged. That is the seam, and it is the half of this decision that binds a change, so it stays a rule — the credential-class rule — with each tier's own rules file naming the module that owns it.

**The other six are rows under the envelope**, reached through a **credentials provider** that no task has built: until it exists no code reads one, and the first slice that needs one builds it. Those are the credential-class rule's words and the whole of them. What that provider must do is fixed here and not left to the slice that builds it — tokens stored hashed behind a lookup prefix, expiring and revocable, one rotation path per class, and every access decision audited. That list is the rule's own words and the whole of what it required; which ledger or log an access decision is audited to, it did not say, and this record does not choose one.

**Classes are never mixed in one scope.** The credential-class rule said exactly that and gave no reason, and none is supplied here. The sentence binds a change, so it stays in that rule with the seam rather than moving to this record.

## Considered options

- **Keep the list in the credential-class rule.** Rejected, and this is the change. The list is unchecked, unbuilt and invisible to a diff — a specification wearing a rule tag, the pattern T-078 found in the web tier's UX rule's latency numbers (ADR 0037) and T-183 in the `neo4j` clause the tenant-table refusal rule carried (ADR 0032). A reader hitting a rule reasonably expects something to run it.

**What was never written down, and is not supplied here.** *Why* a taxonomy of seven rather than one class is recorded nowhere — not in the credential-class rule, not in ADR 0013, not in ADR 0030, not in `docs/operations/SECRETS.md`, all of which state the classes and none of which argue for them. This record does not invent a reason, because a reason invented at the moment of moving a sentence is a new decision wearing the clothes of an old one. A reader who needs that reason should treat it as open.

## Consequences

- The credential-class rule keeps the seam and the never-mixed sentence, and cites this ADR for the class list.
- **Six citations moved with the decision, in the commit that moved it.** ADR 0013 (two, in the body and the record-families consequence) and ADR 0030 (one) each read the class list off the credential-class rule and are amended on 2026-09-21 to cite this record, their citations struck in the index's convention; `docs/operations/SECRETS.md` line 11 (the class list) and line 35 (the hashed, expiring, audited token shape) and `CONTEXT.md`'s *agent token* entry are repointed here outright, being documents rather than decision records. Nothing any of them says about a credential changes. `SECRETS.md` line 7 keeps its citation of the credential-class rule, because the bootstrap seam it cites did not move.
- A class added, renamed or removed is an amendment here, and the records that cite a class follow it.
- **The provider is not built, and that deferral is the credential-class rule's own**, not a choice taken here: no task has built it, no code reads a non-bootstrap credential, and the first slice that needs one builds it to the shape above — this record being what it builds against. No record shows the alternative was ever weighed, so none is claimed.
- **Two conflicts are open and recorded above** — what *acting* means (SECRETS.md against ADR 0030), and whether all six really are rows under the envelope (SECRETS.md's *where it is read* against the credential-class rule). T-184 found both and settled neither; each is a decision of its own.
