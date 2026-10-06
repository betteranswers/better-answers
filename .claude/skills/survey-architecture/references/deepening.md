# The test note

Each proposal says how the reshaped module would be tested, and which existing tests it would replace. The review needs this to judge cost: a shape that cannot be tested through its interface is the wrong shape (`CODING_STANDARDS.md`, *Design a deep module behind a small interface*).

## Sort the module's dependencies

The kind of each dependency decides how the reshaped module is tested across its seam.

- **In-process.** Pure computation and in-memory state, with no I/O. The modules can always merge, and the result is tested directly through its new interface.
- **A store this platform runs.** Postgres, the object store, a workspace's git repository and the map. Tests run against the real store, never a stand-in (*Run every store the platform runs, for real*). The seam stays inside the module, with no port at its interface for the store.
- **A service someone else runs.** An LLM provider or a SaaS API. The module takes the service as a parameter behind that service's own adapter. Tests pass an in-memory adapter, and production passes the real one. That makes two adapters, so the seam is real (*Introduce a seam only where something already varies*).

Never propose a port with one adapter, and never mock this repository's own code (*Never mock our own code*).

## Replace the old tests

- Once tests exist at the reshaped module's interface, the tests on the old shallow modules are deleted, not kept beside them.
- New tests assert what the module returns, stores or sends across its interface (*Test through the interface a caller crosses*).
- A test that must change when only the implementation changes is testing past the interface.

The note names the tests that would go, the tests that would replace them, and any dependency of the third kind that needs an adapter it does not yet have.
