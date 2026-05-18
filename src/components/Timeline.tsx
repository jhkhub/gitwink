import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { colorForBranch } from "../lib/colors";
import { computeLanes } from "../lib/lanes";
import type { BranchInfo, CommitSummary } from "../types";
import { openDiff } from "../lib/ipc";
import { ChangedFiles } from "./ChangedFiles";
import { CommitDetail } from "./CommitDetail";
import { LaneGraph } from "./LaneGraph";

interface Props {
  commits: CommitSummary[];
  mode: "all" | "single";
  /** In "all" mode, clicking the repo cell jumps to single-repo mode. */
  onSelectRepo?: (repoPath: string) => void;
  /** Single-repo mode: list of branches so we can color by branch identity. */
  branches?: BranchInfo[];
}

function timeAgo(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86_400)}d`;
}

function marker(c: CommitSummary): { glyph: string; cls: string; title: string } {
  if (c.isTagged) return { glyph: "★", cls: "marker-tag", title: "Tagged commit" };
  if (c.isMerge) return { glyph: "◆", cls: "marker-merge", title: "Merge commit" };
  return { glyph: "●", cls: "marker-dot", title: "Commit" };
}

export function Timeline({ commits, mode, onSelectRepo, branches }: Props) {
  const [selected, setSelected] = useState(0);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [rowYs, setRowYs] = useState<number[]>([]);

  rowRefs.current.length = commits.length;

  useEffect(() => {
    if (selected > commits.length - 1) setSelected(Math.max(0, commits.length - 1));
  }, [commits.length, selected]);

  // Reset expansion when the commit list itself changes (e.g. filter swap).
  useEffect(() => {
    setExpandedHash(null);
  }, [commits]);

  const toggleExpand = useCallback(
    (hash: string) => {
      setExpandedHash((cur) => (cur === hash ? null : hash));
    },
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        setSelected((s) => Math.min(s + 1, commits.length - 1));
        e.preventDefault();
      } else if (e.key === "k" || e.key === "ArrowUp") {
        setSelected((s) => Math.max(s - 1, 0));
        e.preventDefault();
      } else if (e.key === "Enter") {
        const c = commits[selected];
        if (c) toggleExpand(c.hash);
        e.preventDefault();
      } else if (e.key === "Escape" && expandedHash != null) {
        setExpandedHash(null);
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commits, selected, toggleExpand, expandedHash]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLLIElement>(
      `[data-row="${selected}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Measure each commit row's vertical center for the lane SVG. Re-runs on
  // every relevant change (commits, expansion, mode) so the DAG stays
  // aligned even after an inline expansion pushes later rows down.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ys: number[] = [];
    for (let i = 0; i < rowRefs.current.length; i++) {
      const el = rowRefs.current[i];
      if (el) {
        ys[i] = el.offsetTop + el.offsetHeight / 2;
      }
    }
    setRowYs(ys);
  }, [commits, expandedHash, mode]);

  const showRepo = mode === "all";
  const headBranch = branches?.find((b) => b.isHead)?.name ?? null;

  const laneGraph = useMemo(() => {
    if (mode !== "single") return null;
    return computeLanes(commits, (c) =>
      colorForBranch(c.branchLabel ?? headBranch),
    );
  }, [commits, mode, headBranch]);

  if (commits.length === 0) {
    return <p className="panel-empty">No commits match.</p>;
  }

  return (
    <ul className={"timeline timeline-" + mode} ref={listRef}>
      {laneGraph && rowYs.length === commits.length && (
        <LaneGraph graph={laneGraph} rowYs={rowYs} />
      )}
      {commits.map((c, i) => {
        const m = marker(c);
        return (
          <Fragment key={`${c.repoPath}:${c.hash}`}>
            <li
              data-row={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className={
                "timeline-row" +
                (i === selected ? " selected" : "") +
                (expandedHash === c.hash ? " expanded" : "")
              }
              onClick={() => {
                setSelected(i);
                toggleExpand(c.hash);
              }}
            >
              {mode === "single" ? (
                <span className="timeline-lane-spacer" aria-hidden="true" />
              ) : (
                <span className={"timeline-marker " + m.cls} title={m.title}>
                  {m.glyph}
                </span>
              )}
              <span className="timeline-time">{timeAgo(c.timestamp)}</span>
              {showRepo && (
                <span
                  className={
                    "timeline-repo" +
                    (onSelectRepo ? " timeline-repo-clickable" : "")
                  }
                  title={`${c.repoPath} (click to filter)`}
                  onClick={(e) => {
                    if (!onSelectRepo) return;
                    e.stopPropagation();
                    onSelectRepo(c.repoPath);
                  }}
                >
                  {c.repoName}
                </span>
              )}
              <span className="timeline-summary" title={c.summary}>
                {c.branchLabel && (
                  <span className="timeline-branch">[{c.branchLabel}]</span>
                )}
                {c.summary}
              </span>
              <span className="timeline-author" title={c.email}>
                {c.author}
              </span>
            </li>
            {expandedHash === c.hash && (
              <li className="timeline-expansion" onClick={(e) => e.stopPropagation()}>
                <CommitDetail commit={c} />
                <ChangedFiles
                  repoPath={c.repoPath}
                  hash={c.hash}
                  onOpenDiff={(f) => {
                    void openDiff(
                      c.repoPath,
                      c.repoName,
                      c.hash,
                      c.shortHash,
                      c.summary,
                      f.path,
                    );
                  }}
                />
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}
