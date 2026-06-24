import { useEffect, useMemo, useRef, useState } from "react";
import type { Highlighter } from "shiki";

import { parseDiff, type DiffSide } from "../lib/diff";
import { getHighlighter, highlightLine, langForPath } from "../lib/highlight";
import { DiffMinimap, type MinimapSegment } from "./DiffMinimap";

interface Props {
  text: string;
  /** File path so we can detect the language for Shiki. Optional — falls
   * back to plain monospace when missing or unknown. */
  filePath?: string;
  /** When true, the two columns scroll vertically as one (default). When
   * false they scroll independently — the overview rail then shows both
   * viewports and offers a re-align. */
  locked: boolean;
}

function isDarkScheme(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

// Persisted old/new split — fraction of width given to the left (old)
// column. Clamped so neither side can be dragged to nothing.
const SPLIT_KEY = "gitwink.diffSplit";
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;
function loadSplit(): number {
  if (typeof window === "undefined") return 0.5;
  const v = Number(window.localStorage.getItem(SPLIT_KEY));
  return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : 0.5;
}
function saveSplit(v: number): void {
  try {
    window.localStorage.setItem(SPLIT_KEY, String(v));
  } catch {}
}

export function SideBySideDiff({ text, filePath, locked }: Props) {
  // Memoized: dragging the splitter calls setSplit on every pointer move,
  // which re-renders — without this, the whole diff would reparse each frame.
  const { hunks } = useMemo(() => parseDiff(text), [text]);
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const colsRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  // Overview-rail marks. Positions are fractions of the total visual-row
  // count (each hunk = 1 header row + its line rows). Consecutive changed
  // rows of the same kind coalesce into one bar so a 200-line block shows as
  // a single tall mark, not 200 hairlines. Row-fraction (rather than measured
  // pixels) is cheap and accurate enough to locate a change — exact in "Full"
  // mode where there's a single hunk header.
  const segments = useMemo<MinimapSegment[]>(() => {
    const total = hunks.reduce((n, h) => n + 1 + h.rows.length, 0);
    if (total === 0) return [];
    const segs: MinimapSegment[] = [];
    let cur: { start: number; end: number; type: MinimapSegment["type"] } | null =
      null;
    const flush = () => {
      if (!cur) return;
      segs.push({
        topPct: (cur.start / total) * 100,
        heightPct: ((cur.end - cur.start) / total) * 100,
        type: cur.type,
      });
      cur = null;
    };
    let idx = 0;
    for (const h of hunks) {
      idx++; // hunk header occupies one visual row
      for (const r of h.rows) {
        const hasDel = r.left.type === "delete";
        const hasAdd = r.right.type === "add";
        if (hasDel || hasAdd) {
          const t: MinimapSegment["type"] =
            hasDel && hasAdd ? "change" : hasAdd ? "add" : "delete";
          if (cur && cur.end === idx && cur.type === t) cur.end = idx + 1;
          else {
            flush();
            cur = { start: idx, end: idx + 1, type: t };
          }
        } else {
          flush();
        }
        idx++;
      }
    }
    flush();
    return segs;
  }, [hunks]);

  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [dark, setDark] = useState(isDarkScheme);
  const [split, setSplit] = useState(loadSplit);
  // Mirror for the pointer handlers (avoids a stale split in the closure).
  const splitRef = useRef(split);
  splitRef.current = split;

  const lang = filePath ? langForPath(filePath) : null;

  // Lazy-load Shiki on first mount that has a known language. Skipped
  // entirely for unknown extensions — saves a multi-MB download.
  useEffect(() => {
    if (!lang) return;
    let cancelled = false;
    void getHighlighter().then((hl) => {
      if (!cancelled) setHighlighter(hl);
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // React to OS theme changes while the window is open.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDark(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Sync scroll between the two columns — GitHub / GitLens pattern. Horizontal
  // is always mirrored; vertical only when `locked` (the default), so locked
  // mode reads as one synchronized side-by-side while unlocked lets each side
  // roam. On (re)locking we snap the right column to the left so they realign
  // immediately rather than waiting for the next scroll.
  useEffect(() => {
    const l = leftRef.current;
    const r = rightRef.current;
    if (!l || !r) return;
    if (locked) r.scrollTop = l.scrollTop;
    let syncing = false;
    function mirror(src: HTMLDivElement, dst: HTMLDivElement) {
      if (syncing) return;
      syncing = true;
      dst.scrollLeft = src.scrollLeft;
      if (locked) dst.scrollTop = src.scrollTop;
      syncing = false;
    }
    const onL = () => mirror(l, r);
    const onR = () => mirror(r, l);
    l.addEventListener("scroll", onL, { passive: true });
    r.addEventListener("scroll", onR, { passive: true });
    return () => {
      l.removeEventListener("scroll", onL);
      r.removeEventListener("scroll", onR);
    };
  }, [hunks.length, locked]);

  // Column resizer — drag the divider to rebalance old vs new, double-click
  // to reset to 50/50. Pointer capture keeps the drag alive past the thin
  // handle and over the scrolling columns. We persist only on release (not
  // every move), and recover the drag flag on cancel / lost-capture so a
  // gone pointer can't keep resizing on the next hover.
  function onResizerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onResizerMove(e: React.PointerEvent) {
    if (!draggingRef.current || !colsRef.current) return;
    const rect = colsRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const r = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(r)) return;
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r)));
  }
  function finishDrag(e: React.PointerEvent) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    saveSplit(splitRef.current);
  }

  if (hunks.length === 0) {
    return <div className="sbs-empty">No textual diff.</div>;
  }

  return (
    <div className="sbs">
      <div
        className="sbs-cols"
        ref={colsRef}
        style={{ gridTemplateColumns: `${split}fr 8px ${1 - split}fr` }}
      >
        <div className="sbs-col" ref={leftRef}>
          <div className="sbs-col-inner">
            {hunks.map((h, hi) => (
              <div key={hi}>
                <div className="sbs-hunk-header">{h.header}</div>
                {h.rows.map((r, ri) => (
                  <Line
                    key={ri}
                    side={r.left}
                    kind="left"
                    highlighter={highlighter}
                    lang={lang}
                    dark={dark}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div
          className="sbs-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize old/new columns"
          title="Drag to resize · double-click to reset"
          onPointerDown={onResizerDown}
          onPointerMove={onResizerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onDoubleClick={() => {
            setSplit(0.5);
            saveSplit(0.5);
          }}
        />
        <div className="sbs-col" ref={rightRef}>
          <div className="sbs-col-inner">
            {hunks.map((h, hi) => (
              <div key={hi}>
                <div className="sbs-hunk-header sbs-hunk-header-blank">&nbsp;</div>
                {h.rows.map((r, ri) => (
                  <Line
                    key={ri}
                    side={r.right}
                    kind="right"
                    highlighter={highlighter}
                    lang={lang}
                    dark={dark}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {segments.length > 0 && (
        <DiffMinimap
          segments={segments}
          leftRef={leftRef}
          rightRef={rightRef}
          locked={locked}
        />
      )}
    </div>
  );
}

interface LineProps {
  side: DiffSide;
  kind: "left" | "right";
  highlighter: Highlighter | null;
  lang: ReturnType<typeof langForPath>;
  dark: boolean;
}

function Line({ side, kind, highlighter, lang, dark }: LineProps) {
  const sign =
    side.type === "delete" ? "-" : side.type === "add" ? "+" : " ";

  const highlighted =
    highlighter && lang
      ? highlightLine(highlighter, side.text || " ", lang, dark)
      : null;

  return (
    <div
      className={`sbs-line sbs-${kind} ${side.type ?? "blank"}`}
      data-line-num={side.lineNum ?? ""}
      data-side={kind}
    >
      <span className="sbs-num">{side.lineNum ?? ""}</span>
      <span className="sbs-sign">{sign}</span>
      {highlighted ? (
        <span
          className="sbs-text sbs-text-shiki"
          // Shiki output is trusted — we built it locally from our diff text.
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <span className="sbs-text">{side.text || " "}</span>
      )}
    </div>
  );
}
