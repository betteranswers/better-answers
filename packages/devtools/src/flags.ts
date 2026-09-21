export const flagValues = (argv: readonly string[]): ReadonlyMap<string, string> | undefined => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined) return undefined;
    values.set(flag.slice(2), value);
  }
  return values;
};
