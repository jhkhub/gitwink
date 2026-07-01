import type { ChangedFileStatus } from "../types";

/** Status → badge label + CSS class (the `.badge-*` rules live in styles.css).
 *  Shared by the timeline's ChangedFiles list and the diff window's file
 *  sidebar so a file's NEW/MOD/REN/DEL status reads the same in both. */
export const FILE_STATUS_BADGES: Record<
  ChangedFileStatus,
  { label: string; cls: string }
> = {
  new: { label: "NEW", cls: "badge-new" },
  modified: { label: "MOD", cls: "badge-mod" },
  renamed: { label: "REN", cls: "badge-ren" },
  deleted: { label: "DEL", cls: "badge-del" },
  copied: { label: "CP", cls: "badge-cp" },
  typechange: { label: "TYPE", cls: "badge-type" },
};
