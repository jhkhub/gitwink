import type { CommitSummary } from "../types";

interface Props {
  commit: CommitSummary;
}

function bodyOf(message: string, summary: string): string {
  const m = (message || "").trim();
  if (!m) return "";
  // The first line is the summary; everything after the first blank line
  // is the body. Some repos use a single-line message — then there's no body.
  const firstNewline = m.indexOf("\n");
  if (firstNewline === -1) return "";
  const tail = m.slice(firstNewline + 1).replace(/^\s*\n/, "").trimEnd();
  // If the "body" is just an echo of the summary, suppress it.
  if (tail === summary.trim()) return "";
  return tail;
}

export function CommitDetail({ commit }: Props) {
  const body = bodyOf(commit.message, commit.summary);
  return (
    <div className="commit-detail">
      <div className="commit-detail-summary">{commit.summary}</div>
      {body && <pre className="commit-detail-body">{body}</pre>}
      <div className="commit-detail-meta">
        <code className="commit-detail-hash" title={commit.hash}>
          {commit.shortHash}
        </code>
        <span className="commit-detail-author">
          {commit.author}
          {commit.email && (
            <span className="commit-detail-email"> &lt;{commit.email}&gt;</span>
          )}
        </span>
      </div>
    </div>
  );
}
