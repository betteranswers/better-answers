import path from "node:path";

import { mergeConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

import base from "./vitest.config.ts";

/**
 * Vitest's longest-first order runs the worker-spawning file before the quick one that kills a
 * static mutant.
 */
class FailedThenShortest extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const results = (spec: TestSpecification) =>
      this.ctx.cache.getFileTestResults(
        `${spec.project.name}:${path.relative(this.ctx.config.root, spec.moduleId)}`,
      );
    const failed = (spec: TestSpecification) => Number(results(spec)?.failed === true);
    const duration = (spec: TestSpecification) => results(spec)?.duration ?? 0;
    const grouped = await super.sort(files);
    return grouped.toSorted((a, b) => failed(b) - failed(a) || duration(a) - duration(b));
  }
}

export default mergeConfig(base, { test: { sequence: { sequencer: FailedThenShortest } } });
