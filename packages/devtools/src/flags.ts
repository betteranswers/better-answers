/**
 * A repository script's command line as `--flag value` pairs, read once for every script.
 *
 * The scripts under `scripts/` take their arguments as flag–value pairs and nothing else:
 * no positionals, no bare switches, no `--flag=value`. One reading of that shape, so the
 * mutant probe and the mutation summary refuse a malformed line the same way, and a third
 * script does not write its own loop.
 */

/** The pairs, by flag name without its dashes — or nothing, when the line is not all pairs. */
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
