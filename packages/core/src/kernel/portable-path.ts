/**
 * A relative path of plain segments: no character below U+0020 or DEL, and no empty, `.` or `..`
 * segment. Not a traversal guard: `..` escapes neither a git tree nor a bucket prefix. Isolation
 * is the prefix each door derives from the Principal.
 */
export const isPortablePath = (candidate: string): boolean =>
  !candidate.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }) &&
  candidate.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
