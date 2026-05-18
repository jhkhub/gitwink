import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { Timeline } from "./components/Timeline";
import {
  discoverRepos,
  listRecentCommitsCached,
  listRepos,
  onScanComplete,
  onScanProgress,
  onTimelineRepoFill,
} from "./lib/ipc";
import type { CommitSummary } from "./types";
import "./styles.css";

const TIMELINE_MAX = 50;

function startDrag(e: React.MouseEvent) {
  if (e.buttons !== 1) return;
  void getCurrentWindow().startDragging();
}

function mergeCommits(
  prev: CommitSummary[],
  incoming: CommitSummary[],
): CommitSummary[] {
  const map = new Map<string, CommitSummary>();
  for (const c of prev) map.set(`${c.repoPath}:${c.hash}`, c);
  for (const c of incoming) map.set(`${c.repoPath}:${c.hash}`, c);
  return Array.from(map.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, TIMELINE_MAX);
}

function App() {
  const [repoCount, setRepoCount] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);

  useEffect(() => {
    let mounted = true;
    let unP: UnlistenFn | undefined;
    let unC: UnlistenFn | undefined;
    let unF: UnlistenFn | undefined;

    (async () => {
      // 1. Paint cached commits immediately.
      try {
        const cached = await listRecentCommitsCached();
        if (mounted) setCommits(cached);
      } catch {
        // First run.
      }

      // 2. Cached repo count for the header.
      try {
        const repos = await listRepos();
        if (mounted) setRepoCount(repos.length);
      } catch {
        // First run.
      }

      // 3. Subscribe before kicking off discovery.
      unP = await onScanProgress((p) => {
        if (mounted) setRepoCount(p.found);
      });
      unC = await onScanComplete((p) => {
        if (!mounted) return;
        setRepoCount(p.count);
        setScanning(false);
      });
      // 4. Stream per-repo commits into the timeline as discovery runs.
      unF = await onTimelineRepoFill((p) => {
        if (!mounted) return;
        setCommits((prev) => mergeCommits(prev ?? [], p.commits));
      });

      // 5. Kick off the scan.
      setScanning(true);
      void discoverRepos().catch(() => {
        if (mounted) setScanning(false);
      });
    })();

    return () => {
      mounted = false;
      unP?.();
      unC?.();
      unF?.();
    };
  }, []);

  let status: string;
  if (repoCount == null) {
    status = "Loading…";
  } else if (scanning) {
    status = `Scanning… ${repoCount} ${repoCount === 1 ? "repo" : "repos"}`;
  } else {
    status = `${repoCount} ${repoCount === 1 ? "repository" : "repositories"}`;
  }

  return (
    <main className="panel">
      <header className="panel-header" onMouseDown={startDrag}>
        <h1>gitwink</h1>
        <span className="panel-status">{status}</span>
      </header>
      <section className="panel-body">
        {commits == null ? (
          <p className="panel-empty">Loading commits…</p>
        ) : (
          <Timeline commits={commits} />
        )}
      </section>
    </main>
  );
}

export default App;
