/**
 * The shape of a name a store can hand back: relative, separated by `/`, and every segment
 * a plain name.
 *
 * Two of the four stores name what they hold this way, and **neither name is a filesystem
 * path at the point it is written** — a bundle path reaches `update-index --cacheinfo`,
 * which writes into git's object graph and not onto a disk, and an object key is an opaque
 * string S3 never interprets. So this is not a traversal guard, and reading it as one is
 * the mistake to avoid: `..` escapes neither a git tree nor a bucket prefix, and a door
 * that leaned on this for isolation would be leaning on the wrong thing. Isolation is the
 * prefix each door derives from the Principal it was called with.
 *
 * What this is about is everything that happens to such a name *afterwards*. A bundle's
 * tree is exported and read by any OKF tool, which is a promise ADR 0012 makes; the nightly
 * mirror copies the object store onto a filesystem, where a dot segment, an empty segment
 * and a leading separator all mean something they did not mean in the bucket; and a control
 * character is a character git's own listings quote, which puts an escape between a reader
 * and the name. A name that survives none of that is one the platform can store and then
 * cannot hand back, so a door refuses it at the door rather than writing it.
 *
 * It lives in the kernel because both doors need it and ADR 0029 rule 2 forbids a store
 * file importing another store file, leaving `kernel` — which everything may import — as
 * the one place they can share it. The rule written out twice instead is how Dust's
 * `retries.ts` came to be 39 lines in one package and 115 in another, which is the failure
 * that ADR's copy discipline is written against.
 *
 * Each door keeps its own further conditions where they belong. The object door's listing
 * prefix, which may be empty and may carry the separator that asks for one folder's worth,
 * is the object door's and is not this.
 */
export const isPortablePath = (candidate: string): boolean =>
  // No control character: a tab or a newline in a name is a name no OKF tool reads back and
  // a line git's own listings would have to quote — and the git door's reader takes
  // NUL-delimited listings for exactly the characters git does quote, so this is what keeps
  // the two ends of that door agreeing on what a path can be.
  !candidate.split("").some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  }) &&
  // One line for four refusals, because they are all the same refusal: a segment that names
  // nothing. An empty name has no segment to read; a leading or trailing separator, and a
  // doubled one, each make a segment empty; and `.` and `..` are the two segments that name
  // a place rather than a thing. A name with no separator in it at all is one segment, which
  // is why this also answers for the simple case.
  candidate.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
