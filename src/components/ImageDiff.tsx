import { useEffect, useState } from "react";

import { commitFileBlobs } from "../lib/ipc";
import type { CommitFileBlobs } from "../types";

interface Props {
  repoPath: string;
  hash: string;
  filePath: string;
  oldPath: string | null;
  oldSize: number | null;
  newSize: number | null;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ImageDiff({
  repoPath,
  hash,
  filePath,
  oldPath,
  oldSize,
  newSize,
}: Props) {
  const [blobs, setBlobs] = useState<CommitFileBlobs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlobs(null);
    setError(null);
    (async () => {
      try {
        const b = await commitFileBlobs(repoPath, hash, filePath, oldPath);
        if (!cancelled) setBlobs(b);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoPath, hash, filePath, oldPath]);

  if (error) {
    return <div className="image-diff-error">Error: {error}</div>;
  }
  if (!blobs) {
    return <div className="image-diff-loading">Loading image…</div>;
  }

  if (blobs.isLfs) {
    return (
      <div className="binary-info">
        <div className="binary-info-title">Git LFS file</div>
        <div className="binary-info-meta">
          {formatSize(oldSize)} → {formatSize(newSize)}
        </div>
        <div className="binary-info-hint">
          The actual image is stored in Git LFS. gitwink doesn't fetch LFS
          objects in v0.1, so there's nothing to preview.
        </div>
      </div>
    );
  }

  const mime = MIME[blobs.extension] ?? "application/octet-stream";
  const oldSrc = blobs.oldBase64
    ? `data:${mime};base64,${blobs.oldBase64}`
    : null;
  const newSrc = blobs.newBase64
    ? `data:${mime};base64,${blobs.newBase64}`
    : null;

  return (
    <div className="image-diff">
      <div className="image-diff-side">
        <div className="image-diff-label">Before · {formatSize(oldSize)}</div>
        <div className="image-diff-frame image-diff-frame-old">
          {oldSrc ? (
            <img src={oldSrc} alt="before" />
          ) : (
            <div className="image-diff-empty">(file did not exist)</div>
          )}
        </div>
      </div>
      <div className="image-diff-side">
        <div className="image-diff-label">After · {formatSize(newSize)}</div>
        <div className="image-diff-frame image-diff-frame-new">
          {newSrc ? (
            <img src={newSrc} alt="after" />
          ) : (
            <div className="image-diff-empty">(deleted)</div>
          )}
        </div>
      </div>
    </div>
  );
}
