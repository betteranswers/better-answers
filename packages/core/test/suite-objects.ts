import { afterAll, beforeAll } from "vitest";

import { closeObjects } from "../src/store/objects/index.ts";
import { type ObjectStore, openObjectStore } from "./warm-objects.ts";

export type { ObjectStore };

export const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

export const objectStoreForSuite = (): (() => ObjectStore) => {
  let store: ObjectStore | undefined;

  beforeAll(async () => {
    store = await openObjectStore();
  });

  afterAll(async () => {
    if (store === undefined) return;
    closeObjects(store.door);
    await store.stop();
  });

  return () => {
    if (store === undefined) throw new Error("the suite's object store was read before it started");
    return store;
  };
};
