import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import {
  changedFiles,
  fileDiff,
  openFileHistory,
  takePendingDiffOpen,
  WHOLE_FILE_CONTEXT,
  type DiffOpenPayload,
} from "../lib/ipc";
import { getDiffSelectionRange, refLineWithFile } from "../lib/smartcopy";
import type { ChangedFile } from "../types";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { ImageDiff } from "./ImageDiff";
import { SideBySideDiff } from "./SideBySideDiff";

const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

function extOf(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1).toLowerCase() : "";
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Above this combined (old+new) size, "Full" context is disabled — git
 *  would otherwise emit a multi-MB patch that floods IPC + the parser + the
 *  DOM. The backend also caps the emitted patch as a second line of defense. */
const FULL_MAX_BYTES = 1_500_000;

/** Header context-toggle steps. "Full" expands git's context past any real
 * file length, so the same side-by-side view renders the whole file with
 * changes still tinted — no separate read-only editor. */
const CONTEXT_OPTIONS: { value: number; label: string; title: string }[] = [
  { value: 3, label: "±3", title: "Default — 3 lines of context around each change" },
  { value: 25, label: "±25", title: "Expanded — 25 lines of context" },
  {
    value: WHOLE_FILE_CONTEXT,
    label: "Full",
    title: "Whole file, with changes highlighted",
  },
];

/** Vertical scroll lock for the side-by-side view. Locked (default) scrolls
 * both columns as one; unlocked lets the old/new sides roam independently.
 * Persisted so the choice sticks across files and sessions. */
const SCROLL_LOCK_KEY = "gitwink.diffScrollLock";
function loadScrollLock(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(SCROLL_LOCK_KEY) !== "0";
}

export function DiffApp() {
  const [ctx, setCtx] = useState<DiffOpenPayload | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  // Unified-diff context lines for the selected file. 3 = default hunk
  // view; the header toggle bumps it to expand context or show the whole
  // file. Persists across file switches so "Full" stays on if chosen.
  const [context, setContext] = useState<number>(3);
  // Which (repo,hash) the loaded `files` metadata belongs to, so the
  // text-diff effect never fetches using a previous commit's metadata.
  const [filesCtx, setFilesCtx] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const [scrollLocked, setScrollLocked] = useState(loadScrollLock);

  function toggleScrollLock() {
    setScrollLocked((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(SCROLL_LOCK_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    let un: UnlistenFn | undefined;
    let cancelled = false;

    (async () => {
      try {
        const pending = await takePendingDiffOpen();
        if (!cancelled && pending) {
          setCtx(pending);
          setSelectedFile(pending.filePath);
        }
      } catch {}

      try {
        const u = await listen<DiffOpenPayload>("diff://open", (e) => {
          setCtx(e.payload);
          setSelectedFile(e.payload.filePath);
        });
        // Unmounted before listen resolved → unsubscribe immediately so the
        // handler can't fire on a dead component.
        if (cancelled) u();
        else un = u;
      } catch {
        /* listener registration failed — nothing to unsubscribe */
      }
    })();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        void getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKey);

    return () => {
      cancelled = true;
      un?.();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const key = `${ctx.repoPath}:${ctx.hash}`;
    let cancelled = false;
    // Clear stale metadata up front so selectedFileMeta can't resolve against
    // the previous commit's files while this loads.
    setFiles([]);
    setFilesCtx(null);
    (async () => {
      try {
        const fs = await changedFiles(ctx.repoPath, ctx.hash);
        if (!cancelled) {
          setFiles(fs);
          setFilesCtx(key);
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
          setFilesCtx(key);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx?.repoPath, ctx?.hash]);

  const selectedFileMeta: ChangedFile | undefined =
    selectedFile != null
      ? files.find((f) => f.path === selectedFile)
      : undefined;

  const isImage =
    !!selectedFile && IMAGE_EXT.has(extOf(selectedFile));
  const isBinary = selectedFileMeta?.isBinary === true;
  const isFullTooBig =
    !!selectedFileMeta &&
    (selectedFileMeta.oldSize ?? 0) + (selectedFileMeta.newSize ?? 0) >
      FULL_MAX_BYTES;

  // What we actually fetch/show. A carried-over "Full" is clamped to expanded
  // on a large file WITHOUT losing the user's choice (it returns when they
  // view a smaller file). Deriving it — rather than setContext(25) in an
  // effect — avoids the one-frame Full request the demotion used to let slip.
  const effectiveContext =
    context === WHOLE_FILE_CONTEXT && isFullTooBig ? 25 : context;

  // Reset to the default context when a different commit is opened. Keyed on
  // repoPath+hash because all-repos identity is repoPath:hash (two repos can
  // share a commit hash).
  useEffect(() => {
    setContext(3);
  }, [ctx?.repoPath, ctx?.hash]);

  // Only fetch text diff if it's worth rendering.
  useEffect(() => {
    if (!ctx || !selectedFile) return;
    // Wait until `files` metadata for THIS commit has loaded — otherwise we'd
    // fetch a (possibly Full-context) text diff for a file we don't yet know
    // is binary or oversized.
    if (filesCtx !== `${ctx.repoPath}:${ctx.hash}`) {
      setDiffText(null);
      return;
    }
    if (isImage || isBinary) {
      setDiffText("");
      return;
    }
    // Metadata loaded for this commit but the selected path isn't in it
    // (changedFiles failed or omitted it) — don't fire a text diff (least of
    // all a Full one) for a file we can't size-check.
    if (!selectedFileMeta) {
      setDiffText("");
      return;
    }
    let cancelled = false;
    setDiffText(null);
    (async () => {
      try {
        const txt = await fileDiff(
          ctx.repoPath,
          ctx.hash,
          selectedFile,
          effectiveContext,
        );
        if (!cancelled) setDiffText(txt);
      } catch (e) {
        if (!cancelled) setDiffText(`Error: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    ctx?.repoPath,
    ctx?.hash,
    selectedFile,
    isImage,
    isBinary,
    effectiveContext,
    filesCtx,
    selectedFileMeta,
  ]);

  function onShellContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    // Custom menu belongs to the diff content only — right-clicking the
    // header or file sidebar shows nothing (native menu stays suppressed).
    if (!target.closest(".diff-main")) return;
    if (!ctx) return;
    const selection = window.getSelection()?.toString() ?? "";
    const range = getDiffSelectionRange();
    const items: MenuItem[] = [];

    if (selection) {
      items.push({
        label: "Copy",
        onClick: () => void writeText(selection),
      });
      if (selectedFile) {
        items.push({
          label: "Copy with reference",
          onClick: () => {
            const ref = refLineWithFile(
              ctx.repoName,
              ctx.shortHash,
              selectedFile,
              range?.start ?? null,
              range?.end ?? null,
            );
            void writeText(`${ref}\n${selection}`);
          },
        });
      }
      items.push({ divider: true });
    }

    if (selectedFile) {
      items.push({
        label: "Copy file path",
        onClick: () => void writeText(selectedFile),
      });
    }
    items.push({
      label: "Copy short hash",
      onClick: () => void writeText(ctx.shortHash),
    });
    items.push({
      label: "Copy full hash",
      onClick: () => void writeText(ctx.hash),
    });

    if (items.length === 0) return;
    setContextMenu({ x: e.clientX, y: e.clientY, items });
  }

  if (!ctx) {
    return <div className="diff-loading">Waiting for a file…</div>;
  }

  return (
    <div className="diff-shell" onContextMenu={onShellContextMenu}>
      <header className="diff-header">
        <div className="diff-header-left">
          <div className="diff-header-summary">{ctx.summary}</div>
          <div className="diff-header-meta">
            <span>{ctx.repoName}</span>
            <code className="diff-header-hash" title={ctx.hash}>
              {ctx.shortHash}
            </code>
          </div>
        </div>
        {selectedFile && !isImage && !isBinary && (
          <div className="diff-header-tools">
            <div
              className="diff-context-toggle"
              role="group"
              aria-label="Diff context"
            >
              {CONTEXT_OPTIONS.map((o) => {
                const disabled =
                  o.value === WHOLE_FILE_CONTEXT && isFullTooBig;
                return (
                  <button
                    key={o.value}
                    type="button"
                    className={
                      "diff-context-btn" +
                      (effectiveContext === o.value ? " active" : "")
                    }
                    disabled={disabled}
                    onClick={() => setContext(o.value)}
                    title={
                      disabled ? "File too large for full context" : o.title
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className={"diff-sync-btn" + (scrollLocked ? " active" : "")}
              onClick={toggleScrollLock}
              aria-pressed={scrollLocked}
              title={
                scrollLocked
                  ? "Scroll sync on — old & new move together. Click to unlock for independent scroll."
                  : "Scroll sync off — sides scroll independently. Click to lock."
              }
            >
              ⇅ Sync
            </button>
          </div>
        )}
      </header>
      <div className="diff-body">
        <aside className="diff-sidebar">
          {files.length === 0 ? (
            <div className="diff-sidebar-empty">Loading files…</div>
          ) : (
            files.map((f) => {
              const isSel = f.path === selectedFile;
              const slash = f.path.lastIndexOf("/");
              const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
              const name = slash >= 0 ? f.path.slice(slash + 1) : f.path;
              return (
                <div
                  key={f.path}
                  className={"diff-file-wrap" + (isSel ? " active" : "")}
                >
                  <button
                    className={"diff-file" + (isSel ? " active" : "")}
                    onClick={() => setSelectedFile(f.path)}
                    title={f.path}
                  >
                    <div className="diff-file-line">
                      <span className="diff-file-name">{name}</span>
                      {f.isBinary && (
                        <span className="changed-file-bin" title="Binary file">
                          bin
                        </span>
                      )}
                      <span className="diff-file-stat">
                        {f.isBinary ? (
                          <span className="diff-file-binsize">
                            {formatSize(f.newSize ?? f.oldSize)}
                          </span>
                        ) : (
                          <>
                            <span className="changed-file-plus">
                              +{f.insertions}
                            </span>
                            <span className="changed-file-minus">
                              −{f.deletions}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    {dir && <div className="diff-file-dir">{dir}</div>}
                  </button>
                  <button
                    className="diff-file-history"
                    title="Show this file's history in the panel"
                    aria-label={`Show history of ${name}`}
                    onClick={() => void openFileHistory(ctx.repoPath, f.path)}
                  >
                    🕘
                  </button>
                </div>
              );
            })
          )}
        </aside>
        <main className="diff-main">
          {!selectedFile ? (
            <div className="diff-loading">Pick a file.</div>
          ) : isImage ? (
            <ImageDiff
              repoPath={ctx.repoPath}
              hash={ctx.hash}
              filePath={selectedFile}
              oldPath={selectedFileMeta?.oldPath ?? null}
              oldSize={selectedFileMeta?.oldSize ?? null}
              newSize={selectedFileMeta?.newSize ?? null}
            />
          ) : isBinary ? (
            <div className="binary-info">
              <div className="binary-info-title">Binary file</div>
              <div className="binary-info-meta">
                {formatSize(selectedFileMeta?.oldSize ?? null)} →{" "}
                {formatSize(selectedFileMeta?.newSize ?? null)}
              </div>
              <div className="binary-info-hint">
                gitwink doesn't render diffs for non-image binaries yet.
              </div>
            </div>
          ) : diffText == null ? (
            <div className="diff-loading">Loading diff…</div>
          ) : (
            <SideBySideDiff
              text={diffText}
              filePath={selectedFile}
              locked={scrollLocked}
            />
          )}
        </main>
      </div>
      {contextMenu && (
        <ContextMenu
          items={contextMenu.items}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
