import { afterEach, assert, beforeEach, vi } from "vitest";

export type SavedFile = {
  readonly name: string;
  readonly type: string;
  readonly bytes: () => Promise<Uint8Array>;
  readonly text: () => Promise<string>;
};

/** jsdom cannot save files, so this records each anchor click with the blob it links to. */
export const downloadsWatched = (): readonly SavedFile[] => {
  const saved: SavedFile[] = [];
  const blobs = new Map<string, Blob>();

  beforeEach(() => {
    saved.length = 0;
    blobs.clear();
    Object.assign(URL, {
      createObjectURL: (blob: Blob): string => {
        const url = `blob:saved/${blobs.size}`;
        blobs.set(url, blob);
        return url;
      },
      revokeObjectURL: (): void => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      const blob = blobs.get(this.href);
      assert(blob !== undefined, "the anchor links to a blob the page never created");
      saved.push({
        name: this.download,
        type: blob.type,
        bytes: async () => new Uint8Array(await blob.arrayBuffer()),
        text: () => blob.text(),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  return saved;
};
