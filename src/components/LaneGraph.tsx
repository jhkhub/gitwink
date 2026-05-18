import type { LaneGraphData } from "../lib/lanes";

interface Props {
  graph: LaneGraphData;
  /** Centre-y for each commit row in panel-body local coordinates. */
  rowYs: number[];
}

const LANE_WIDTH = 12;
const CIRCLE_R = 3.5;

export function LaneGraph({ graph, rowYs }: Props) {
  const width = Math.max(graph.totalLanes * LANE_WIDTH, LANE_WIDTH);
  const lastY = rowYs.length > 0 ? rowYs[rowYs.length - 1] : 0;
  const height = lastY + 24;

  function cx(lane: number): number {
    return lane * LANE_WIDTH + LANE_WIDTH / 2;
  }
  function cy(idx: number): number {
    return rowYs[idx] ?? 0;
  }

  return (
    <svg
      className="lane-graph"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {graph.edges.map((e, i) => {
        const fromY = cy(e.fromIdx);
        const toY = e.toIdx >= 0 ? cy(e.toIdx) : height;
        const fromX = cx(e.fromLane);
        const toX = cx(e.toLane);
        const d =
          fromX === toX
            ? `M${fromX},${fromY} L${toX},${toY}`
            : `M${fromX},${fromY} C${fromX},${(fromY + toY) / 2} ${toX},${(fromY + toY) / 2} ${toX},${toY}`;
        return (
          <path
            key={i}
            d={d}
            stroke={e.color}
            strokeWidth={1.5}
            fill="none"
            strokeOpacity={0.85}
          />
        );
      })}
      {graph.laneCommits.map((lc, i) => (
        <circle
          key={i}
          cx={cx(lc.lane)}
          cy={cy(i)}
          r={CIRCLE_R}
          fill={lc.color}
          stroke="rgba(0,0,0,0.22)"
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}
