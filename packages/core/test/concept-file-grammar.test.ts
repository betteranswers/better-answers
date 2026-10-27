import { inspect } from "node:util";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  contentHashOf,
  parseConceptFile,
  renderConceptFile,
  type Frontmatter,
} from "../src/concepts/index.ts";

describe("a concept file read back", () => {
  it("reads a quoted key, and a list of strings", () => {
    expect([
      parseConceptFile('---\n"title": "x"\n---\n\nbody\n'),
      parseConceptFile('---\n"tags":\n  - "a"\n---\n\nbody\n'),
    ]).toEqual([
      { ok: true, value: { frontmatter: { title: "x" }, body: "body\n" } },
      { ok: true, value: { frontmatter: { tags: ["a"] }, body: "body\n" } },
    ]);
  });

  it("reads back exactly what the renderer wrote, in every shape", () => {
    const frontmatter: Frontmatter = {
      title: 'Say "hello": a title',
      type: "Policy",
      count: 3,
      ratio: 0.5,
      live: true,
      gone: null,
      tags: ["a: b", "  - c"],
      none: [],
      sources: [
        { resource: "/sources/handbook.pdf", title: "Handbook", locator: "p.4" },
        { resource: "https://x.test/y", locator: null, pages: 2, checked: false },
      ],
      "odd: key": "value",
    };
    const body = "# Heading\n\nA line.  \r\nAnother.\n\n\n";

    const read = parseConceptFile(renderConceptFile(frontmatter, body));

    expect(read).toEqual({
      ok: true,
      value: { frontmatter, body: "# Heading\n\nA line.\nAnother.\n" },
    });
    assert(read.ok, `the file was refused: ${inspect(read)}`);
    expect(contentHashOf(read.value.frontmatter, read.value.body, "k/a.md")).toBe(
      contentHashOf(frontmatter, body, "k/a.md"),
    );
  });

  it.each([
    ["no fences at all", "title: bare\n\nbody\n"],
    ["a blank line above the fence", '\n---\n"title": "x"\n---\n\nbody\n'],
    ["a bare YAML key", '---\ntitle: bare\n"type": "Policy"\n---\n\nbody\n'],
    ["no blank line after the fence", '---\n"title": "x"\n---\nbody\n'],
    ["a list mixing strings and entries", '---\n"tags":\n  - "a"\n  - "k": 1\n---\n\n'],
    ["an object where a scalar goes", '---\n"title": {"a": 1}\n---\n\n'],
    ["an item outside a list", '---\n  - "a"\n---\n\n'],

    ["a key written twice", '---\n"title": "one"\n"title": "two"\n---\n\n'],
    ["a __proto__ key written twice", '---\n"__proto__": "one"\n"__proto__": "two"\n---\n\n'],
    [
      "one entry repeating a key",
      '---\n"sources":\n  - "resource": "/s/a.pdf"\n    "colour": "red"\n    "colour": "blue"\n---\n\n',
    ],
    [
      "one entry repeating __proto__",
      '---\n"sources":\n  - "resource": "/s/a.pdf"\n    "__proto__": "a"\n    "__proto__": "b"\n---\n\n',
    ],

    ["a valueless key before another", '---\n"tags":\n"title": "x"\n---\n\n'],
    ["a valueless key closing the frontmatter", '---\n"title": "x"\n"tags":\n---\n\n'],

    ["junk before a quoted key", '---\n x"title": "x"\n---\n\nbody\n'],
    ["a numeric list item", '---\n"tags":\n  - 1\n---\n\nbody\n'],
    ["no opening fence", '"title": "x"\n---\n\nbody\n'],
  ])("refuses a file with %s", (_shape, file) => {
    expect(parseConceptFile(file)).toEqual({ ok: false, error: "malformed" });
  });

  it.each([
    ["a constructor key", "constructor", ' "x"', "x"],
    ["a __proto__ string", "__proto__", ' "x"', "x"],
    ["a __proto__ null", "__proto__", " null", null],
    ["a __proto__ list", "__proto__", '\n  - "a"', ["a"]],
  ])("keeps %s and writes it back", (_shape, key, text, value) => {
    const file = `---\n"title": "T"\n"type": "Policy"\n${JSON.stringify(key)}:${text}\n---\n\nbody\n`;

    const read = parseConceptFile(file);

    assert(read.ok, `the file was refused: ${inspect(read)}`);
    const { frontmatter, body } = read.value;
    expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
    expect(Object.entries(frontmatter)).toEqual([
      ["title", "T"],
      ["type", "Policy"],
      [key, value],
    ]);
    expect(renderConceptFile(frontmatter, body)).toBe(file);
  });

  it("keeps a __proto__ field inside a sources entry", () => {
    const file =
      '---\n"title": "T"\n"type": "Policy"\n"sources":\n  - "resource": "/s/a.pdf"\n    "__proto__": "x"\n---\n\nbody\n';

    const read = parseConceptFile(file);

    assert(read.ok, `the file was refused: ${inspect(read)}`);
    const [entry] = z.array(z.unknown()).parse(read.value.frontmatter["sources"]);
    assert(typeof entry === "object", "the sources list holds an entry");
    assert(entry !== null, "the sources entry is an object");
    expect(Object.entries(entry)).toEqual([
      ["resource", "/s/a.pdf"],
      ["__proto__", "x"],
    ]);
    expect(renderConceptFile(read.value.frontmatter, read.value.body)).toBe(file);
  });
});
