// Shared types mirrored between Rust (commands.rs) and the frontend.
// Keep this file in lock-step with the serde structs on the Rust side.

export interface Repo {
  path: string;
  name: string;
}

export interface ScanProgress {
  root: string;
  found: number;
}

export interface ScanComplete {
  count: number;
}

export interface TimelineRepoFill {
  commits: CommitSummary[];
}

export interface CommitSummary {
  repoPath: string;
  repoName: string;
  hash: string;
  shortHash: string;
  summary: string;
  author: string;
  email: string;
  timestamp: number;
  /** Branch hint when the commit is NOT on the user's currently checked-out branch. */
  branchLabel: string | null;
  isMerge: boolean;
  isTagged: boolean;
  /** Parent commit SHAs in order. Used by the DAG lane drawer. */
  parents: string[];
  /** Full commit message (summary + body). */
  message: string;
}

export interface BranchInfo {
  name: string;
  tipHash: string;
  isHead: boolean;
  commitCount: number;
  lastActivity: number;
}

export type WindowDays = 1 | 3 | 7 | 30 | "all";

export interface AuthorTally {
  name: string;
  count: number;
  lastActivity: number;
}

export type ChangedFileStatus =
  | "modified"
  | "new"
  | "renamed"
  | "deleted"
  | "copied"
  | "typechange";

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  insertions: number;
  deletions: number;
  status: ChangedFileStatus;
  isBinary: boolean;
  oldSize: number | null;
  newSize: number | null;
}

export interface CommitFileBlobs {
  oldBase64: string | null;
  newBase64: string | null;
  extension: string;
  isLfs: boolean;
}
