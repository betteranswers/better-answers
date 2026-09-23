import fs from "node:fs";
import path from "node:path";

// One pin, read from the manifest that declares it, so the tier's floor and the throwaway
// tools cannot drift apart.
export const workerPython = (checkout) => {
  const manifest = path.join(checkout, "apps", "worker", "pyproject.toml");
  const found = /^requires-python\s*=\s*"[^"]*?(\d+\.\d+)/m.exec(fs.readFileSync(manifest, "utf8"));
  if (found === null) throw new Error(`${manifest} names no requires-python`);
  return found[1];
};
