import path from "node:path";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const TEST_DIRECTORIES: ReadonlySet<string> = new Set(["e2e", "test", "tests"]);

const TEST_FILE = /(^test_|[._](test|spec)\.)/;

export const isTestPath = (file: string): boolean => {
  const segments = file.split("/");
  const name = segments.at(-1) ?? "";
  return segments.some((segment) => TEST_DIRECTORIES.has(segment)) || TEST_FILE.test(name);
};
