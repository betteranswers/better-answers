import { statSync } from "node:fs";

import { BaseSequencer, type TestSpecification } from "vitest/node";

type Sized = { readonly id: string; readonly size: number };

type Shard = { bytes: number; readonly ids: string[] };

/** Vitest's own deal hashes the paths, so a shard's wall follows the hash and not the files. */
export const dealBySize = (
  files: readonly Sized[],
  count: number,
): readonly (readonly string[])[] => {
  const shards: Shard[] = Array.from({ length: count }, () => ({ bytes: 0, ids: [] }));
  const largestFirst = files.toSorted((a, b) => b.size - a.size || a.id.localeCompare(b.id));
  for (const { id, size } of largestFirst) {
    const lightest = shards.reduce((least, one) => (one.bytes < least.bytes ? one : least));
    lightest.bytes += size;
    lightest.ids.push(id);
  }
  return shards.map((one) => one.ids);
};

export class BySize extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
    const sized = files.map((spec) => ({ id: spec.moduleId, size: statSync(spec.moduleId).size }));
    const mine = new Set(dealBySize(sized, count)[index - 1]);
    return files.filter((spec) => mine.has(spec.moduleId));
  }
}
