---
extends: session-pickup
when: Picking up a prior session's work that grows into many delegates or pull requests.
---

# Session pickup

- **After** "The pickup playbook ends here.", when the remaining work outgrows one coordinator (about ten delegates in flight at once, or a queue of pull requests to verify and land), route it to the bundled Orchestrate playbook, so its ledger, liveness probe and standing orders hold the run.
