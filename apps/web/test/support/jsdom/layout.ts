import { beforeAll } from "vitest";

const NO_BOX = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

// jsdom has no layout, so Range and Document lack the measuring methods a text editor calls.
beforeAll(() => {
  if (typeof Range === "undefined") return;
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, writable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, writable: true, value: () => NO_BOX },
  });
  Object.defineProperty(Document.prototype, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: () => null,
  });
});
