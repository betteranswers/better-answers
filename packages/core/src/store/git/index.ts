export {
  openGit,
  initRepository,
  head,
  withRepositoryLock,
  withRepositoryLockAs,
  tryRepositoryLockAs,
} from "./door.ts";
export type { GitDoor, GitRootRefusal } from "./door.ts";
export { PLATFORM_BOT, ANY_HEAD, commit } from "./commit.ts";
export type { CommitAuthor, CommitRequest, Committed, CommitRefusal } from "./commit.ts";
export { commitsAfter, historyNaming, readCommit, fileAt, fileAtHead } from "./history.ts";
export type { HistoryNaming, CommitRead } from "./history.ts";
export { ERASED_DOMAIN, rewriteHistory } from "./rewrite.ts";
export type { Needles, Pseudonymisation, HistoryRewritten } from "./rewrite.ts";
