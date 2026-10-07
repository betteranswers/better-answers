---
title: "Better Answers is open core under Apache-2.0, and the hosted service is the product"
date: 2026-09-05
module: repository
problem_type: architecture_pattern
component: licensing
severity: medium
applies_when:
  - "Adding a dependency or lifting third-party code"
  - "Writing an ops document, or any public file that could name the estate's addresses or edge policy"
  - "Proposing a paid-only feature or an enterprise-licensed directory"
  - "Handling a pull request or a contribution from outside the maintainers"
tags:
  - adr-0027
  - licence
  - open-core
  - copyleft
  - lift
  - third-party-notices
---

# Better Answers is open core under Apache-2.0, and the hosted service is the product

## The decision

The repository is public under the Apache License 2.0, one licence over the whole tree (`LICENSE`, `NOTICE`). There is no `ee/` directory and no paid gate in the code. What a customer pays for is the hosted service: the running estate, support, the data-processor role and its DPIA, and any per-customer purchase.

- Copyleft is run-only. Third-party code is lifted or depended on only under MIT, BSD, ISC, Apache-2.0 or the PostgreSQL licence.
- GPL and AGPL software, such as Garage, runs unmodified as a separate process over a network protocol, never linked, vendored or copied. Nothing under an enterprise-licensed directory is read, not even for its shape.
- The estate's own configuration is not published. The ops documents in `docs/operations/` are public halves naming credential classes, contracts and the deployment shape. The gitignored `.planning/estate/` holds the addresses and the edge-policy placement.
- No public file names a hostname's Access posture, a rate-limit placement, a firewall rule, a bucket name or an escrow holder. The rule binds operational files, not the ADRs. The compose files, Dockerfiles, wizard, workflows and backup and restore scripts stay public in full.
- The licence posture binds as this decision's own text; `CODING_STANDARDS.md` carries no licence family. The per-lift file is the api's rule *Test every lift by contract, never by trust*, in `apps/api/CODING_STANDARDS.md`: a `THIRD_PARTY_NOTICES.md` and a contract test in every directory under `lifts/`, as in `apps/api/lifts/better-auth-cimd-node/`.
- There is no root `THIRD_PARTY_NOTICES.md` aggregate and no `check` licence step.
- The public face is read-only. Issues are open, outside pull requests are closed with a fixed note, and `SECURITY.md` names one address for vulnerability reports.

## Why

- The product's one claim no competitor makes, *open format you own*, is whole only when the customer can leave with the bundle and run the thing that reads it.
- The share agent and the customer-hosted worker are sold to people who will read the source first.
- A public repository gets bigger runners, unlimited Actions minutes and code scanning for nothing, and the tree was clean before any product code, the cheapest moment for a one-way flip.
- Apache-2.0 over MIT for §3's patent grant and §6's reservation of the name *Better Answers*, which has no registered trade mark.
- The flip is one-way through git history, so the estate's configuration had to stay out before it. The ADRs keep which hostnames sit outside the access wall, a fact one request establishes.
- The posture is a decision, so the owner retired it from the standards; what a lift can be checked for is the lift-contract rule's.

## Rejected

- Closed: it costs the tagline's claim, the share agent's buyers and the free CI and scanning.
- Source-available (a Business or Functional Source Licence): it costs the word *open* and hands every customer's legal team a bespoke licence. Reachable later as a re-licence, not the other way.
- Open later: the cost of open without its benefits, and a date that drifts.
- MIT: no patent grant and no trade-mark reservation.
- AGPL-3.0: an IT manager refuses the share agent, to guard against a competitor that does not exist yet.
- An `ee/` directory for paid features: it doubles every seam, and there is no feature to gate that is not also what makes the product usable.
- Opening only the share agent and the OKF tooling: two repositories and two release trains.
- Outside contributions under a DCO or a CLA: the review load is the problem, and every merged outside line is a provenance question.

## History

The full record, with its two amendments (ticket 79's Q10, applied by T-001, and T-078): `docs/archive/adr/0027-open-core-under-apache-2-0.md`.
