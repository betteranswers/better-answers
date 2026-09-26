import { describe, expect, it } from "vitest";

import {
  containerState,
  holdAContainer,
  removeContainers,
  untilContainerGone,
} from "./held-containers.ts";

// Ryuk's own timer is ten seconds; a shorter one only shortens the wait for what it clears.
const QUICK_RYUK = { TESTCONTAINERS_RYUK_RECONNECTION_TIMEOUT: "1s" };

const CLEARED_WITHIN_MS = 20_000;

describe("a test process's Ryuk", () => {
  it("clears a killed process's container while another process still runs", async () => {
    const live = holdAContainer(QUICK_RYUK);
    const held: string[] = [];
    try {
      held.push(await live.container);

      // Started after the first holds its container, so an unpatched testcontainers would join
      // the first's Ryuk and its session.
      const killed = holdAContainer(QUICK_RYUK);
      try {
        held.push(await killed.container);
      } finally {
        killed.process.kill("SIGKILL");
      }
      const [liveContainer = "", killedContainer = ""] = held;

      expect(await untilContainerGone(killedContainer, CLEARED_WITHIN_MS)).toBe(true);
      expect(containerState(liveContainer)).toBe("running");
    } finally {
      live.process.kill("SIGKILL");
      removeContainers(held);
    }
  });
});
