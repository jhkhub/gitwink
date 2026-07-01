// Compact relative-time token for timeline rows, shared by both the
// single-repo and all-repos timelines so the ladder never diverges between
// them. Approximate above days on purpose — the exact datetime lives in each
// row's hover tooltip (formatFullTime, still local to each timeline).
//
// Ladder: s → m → h → d → w → mo → y. The w/mo/y rungs keep "All time" and
// file-history views from rendering an unbounded "730d"; they read "12w",
// "8mo", "2y" instead.
export function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86_400);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
